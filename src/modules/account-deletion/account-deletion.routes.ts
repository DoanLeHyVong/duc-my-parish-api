import { randomUUID } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { AccountDeletionEventType, AccountDeletionStatus, Prisma, RoleCode } from "../../generated/prisma/client.js";
import { getEnv } from "../../config/env.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { authorizeRole } from "../../middleware/authorize.js";
import {
  adminRequestListSchema,
  deletionRequestParamsSchema,
  ownRequestListSchema,
  type RetentionCategory,
  submitDeletionRequestSchema,
  transitionDeletionRequestSchema
} from "./account-deletion.schemas.js";

export const accountDeletionRouter = Router();
export const adminAccountDeletionRouter = Router();
const env = getEnv();
const submissionLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (request) => request.auth!.userId,
  message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Có quá nhiều lần xác minh mật khẩu thất bại. Vui lòng thử lại sau." } }
});

const identityInclude = {
  select: {
    id: true,
    username: true,
    displayName: true,
    isActive: true,
    deletedAt: true,
    roleAssignments: { include: { role: true } },
  },
} as const;
const requestInclude = {
  requester: identityInclude,
  events: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: { actor: identityInclude },
  },
} satisfies Prisma.AccountDeletionRequestInclude;

function primaryRole(assignments: Array<{ role: { code: RoleCode } }>): RoleCode {
  const codes = assignments.map((assignment) => assignment.role.code);
  return [RoleCode.SUPER_ADMIN, RoleCode.APPGLV_ADMIN, RoleCode.TEACHER, RoleCode.PARISH_ADMIN]
    .find((role) => codes.includes(role)) ?? codes[0] ?? RoleCode.TEACHER;
}

function serializeIdentity<T extends { roleAssignments: Array<{ role: { code: RoleCode } }> }>(identity: T) {
  const { roleAssignments, ...rest } = identity;
  return { ...rest, role: primaryRole(roleAssignments), roles: roleAssignments.map((assignment) => assignment.role.code) };
}

function serializeRequest<T extends { requester: Parameters<typeof serializeIdentity>[0]; events: Array<{ actor: Parameters<typeof serializeIdentity>[0] }> }>(item: T) {
  return {
    ...item,
    requester: serializeIdentity(item.requester),
    events: item.events.map((event) => ({ ...event, actor: serializeIdentity(event.actor) })),
  };
}

const transitions: Record<string, { from: AccountDeletionStatus; to: AccountDeletionStatus; event: AccountDeletionEventType }> = {
  START_REVIEW: { from: AccountDeletionStatus.SUBMITTED, to: AccountDeletionStatus.IN_REVIEW, event: AccountDeletionEventType.REVIEW_STARTED },
  VERIFY: { from: AccountDeletionStatus.IN_REVIEW, to: AccountDeletionStatus.VERIFIED, event: AccountDeletionEventType.VERIFIED },
  APPROVE: { from: AccountDeletionStatus.VERIFIED, to: AccountDeletionStatus.APPROVED, event: AccountDeletionEventType.APPROVED },
};

function conflict(code: string, message: string, details?: unknown): ApiError {
  return new ApiError(409, code, message, details);
}

async function linkedRetentionCategories(tx: Prisma.TransactionClient, userId: string): Promise<RetentionCategory[]> {
  const [assignments, schedules, attendanceRecords, attendanceEvents, attendanceAudits, submitted, finalized, imports, importEvents, gradeAudits, rules, results] = await Promise.all([
    tx.teacherAssignment.count({ where: { teacherId: userId } }),
    tx.scheduleTemplate.count({ where: { createdById: userId } }),
    tx.attendanceRecord.count({ where: { updatedById: userId } }),
    tx.attendanceEvent.count({ where: { actorId: userId } }),
    tx.attendanceAuditEntry.count({ where: { actorId: userId } }),
    tx.attendanceSession.count({ where: { submittedById: userId } }),
    tx.attendanceSession.count({ where: { finalizedById: userId } }),
    tx.studentImportBatch.count({ where: { actorId: userId } }),
    tx.studentImportEvent.count({ where: { actorId: userId } }),
    tx.gradeAuditEntry.count({ where: { actorId: userId } }),
    tx.classificationRuleVersion.count({ where: { publishedById: userId } }),
    tx.classificationResult.count({ where: { actorId: userId } })
  ]);
  const exceptions = await tx.scheduleException.count({ where: { createdById: userId } });
  const categories: RetentionCategory[] = ["ACCOUNT_DELETION_AUDIT"];
  if (assignments) categories.push("TEACHER_ASSIGNMENTS");
  if (schedules || exceptions) categories.push("SCHEDULE_ADMINISTRATION");
  if (attendanceRecords || attendanceEvents || attendanceAudits || submitted || finalized) categories.push("ATTENDANCE_HISTORY");
  if (imports || importEvents) categories.push("IMPORT_HISTORY");
  if (gradeAudits) categories.push("GRADE_HISTORY");
  if (rules || results) categories.push("CLASSIFICATION_HISTORY");
  return categories.sort();
}

accountDeletionRouter.use(authenticate);

accountDeletionRouter.post("/requests", submissionLimiter, asyncHandler(async (request, response) => {
  const input = submitDeletionRequestSchema.parse(request.body);
  const userId = request.auth!.userId;
  const existingReplay = await prisma.accountDeletionRequest.findUnique({ where: { requestKey: input.requestKey }, include: requestInclude });
  if (existingReplay) {
    if (existingReplay.requesterId !== userId) throw conflict("REQUEST_KEY_CONFLICT", "Mã yêu cầu đã được sử dụng.");
    const replayUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(input.currentPassword, replayUser.passwordHash))) {
      throw new ApiError(422, "CURRENT_PASSWORD_INVALID", "Mật khẩu hiện tại không đúng.");
    }
    response.json({ data: serializeRequest(existingReplay) });
    return;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ApiError(422, "CURRENT_PASSWORD_INVALID", "Mật khẩu hiện tại không đúng.");
  }
  try {
    const created = await prisma.accountDeletionRequest.create({
      data: {
        requestKey: input.requestKey,
        requesterId: userId,
        activeRequesterId: userId,
        events: { create: { actorId: userId, type: AccountDeletionEventType.SUBMITTED, toStatus: AccountDeletionStatus.SUBMITTED } }
      },
      include: requestInclude
    });
    response.status(201).json({ data: serializeRequest(created) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.accountDeletionRequest.findUnique({ where: { requestKey: input.requestKey }, include: requestInclude });
      if (replay?.requesterId === userId) {
        response.json({ data: serializeRequest(replay) });
        return;
      }
      if (replay) throw conflict("REQUEST_KEY_CONFLICT", "Mã yêu cầu đã được sử dụng.");
      const active = await prisma.accountDeletionRequest.findUnique({ where: { activeRequesterId: userId }, include: requestInclude });
      if (active) throw conflict("ACTIVE_DELETION_REQUEST_EXISTS", "Tài khoản đã có một yêu cầu đang được xử lý.", { requestId: active.id, status: active.status });
    }
    throw error;
  }
}));

accountDeletionRouter.get("/requests", asyncHandler(async (request, response) => {
  const query = ownRequestListSchema.parse(request.query);
  const where = { requesterId: request.auth!.userId };
  const [items, total] = await prisma.$transaction([
    prisma.accountDeletionRequest.findMany({ where, include: requestInclude, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.accountDeletionRequest.count({ where })
  ]);
  response.json({ data: { items: items.map(serializeRequest), total, page: query.page, limit: query.limit } });
}));

accountDeletionRouter.get("/requests/:id", asyncHandler(async (request, response) => {
  const { id } = deletionRequestParamsSchema.parse(request.params);
  const item = await prisma.accountDeletionRequest.findFirst({ where: { id, requesterId: request.auth!.userId }, include: requestInclude });
  if (!item) throw new ApiError(404, "DELETION_REQUEST_NOT_FOUND", "Không tìm thấy yêu cầu xóa tài khoản.");
  response.json({ data: serializeRequest(item) });
}));

adminAccountDeletionRouter.use(authenticate, authorizeRole(RoleCode.SUPER_ADMIN));

adminAccountDeletionRouter.get("/requests", asyncHandler(async (request, response) => {
  const query = adminRequestListSchema.parse(request.query);
  const where = query.status ? { status: query.status } : {};
  const [items, total] = await prisma.$transaction([
    prisma.accountDeletionRequest.findMany({ where, include: requestInclude, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.accountDeletionRequest.count({ where })
  ]);
  response.json({ data: { items: items.map(serializeRequest), total, page: query.page, limit: query.limit } });
}));

adminAccountDeletionRouter.get("/requests/:id", asyncHandler(async (request, response) => {
  const { id } = deletionRequestParamsSchema.parse(request.params);
  const item = await prisma.accountDeletionRequest.findUnique({ where: { id }, include: requestInclude });
  if (!item) throw new ApiError(404, "DELETION_REQUEST_NOT_FOUND", "Không tìm thấy yêu cầu xóa tài khoản.");
  const requiredRetentionCategories = await prisma.$transaction((tx) => linkedRetentionCategories(tx, item.requesterId));
  response.json({ data: { ...serializeRequest(item), requiredRetentionCategories } });
}));

adminAccountDeletionRouter.post("/requests/:id/transitions", asyncHandler(async (request, response) => {
  const { id } = deletionRequestParamsSchema.parse(request.params);
  const input = transitionDeletionRequestSchema.parse(request.body);
  const actorId = request.auth!.userId;
  const runTransition = () => prisma.$transaction(async (tx) => {
    const current = await tx.accountDeletionRequest.findUnique({ where: { id }, include: { requester: { include: { roleAssignments: { include: { role: true } } } } } });
    if (!current) throw new ApiError(404, "DELETION_REQUEST_NOT_FOUND", "Không tìm thấy yêu cầu xóa tài khoản.");
    if (current.requesterId === actorId) throw new ApiError(403, "SELF_REVIEW_FORBIDDEN", "Không thể tự xác minh, phê duyệt hoặc thực thi yêu cầu của chính mình.");
    if (current.revision !== input.revision) throw conflict("STALE_REVISION", "Yêu cầu vừa thay đổi. Vui lòng tải lại.");

    if (input.action === "EXECUTE") {
      if (current.status !== AccountDeletionStatus.APPROVED) throw conflict("INVALID_DELETION_TRANSITION", "Chỉ yêu cầu đã được phê duyệt mới có thể thực thi.");
      if (current.requester.roleAssignments.some((assignment) => assignment.role.code === RoleCode.SUPER_ADMIN)) {
        const activeAdmins = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT u.id FROM users u
          INNER JOIN user_role_assignments ura ON ura.userId = u.id
          INNER JOIN access_roles ar ON ar.id = ura.roleId
          WHERE ar.code = 'SUPER_ADMIN' AND u.isActive = TRUE AND u.deletedAt IS NULL
          ORDER BY u.id
          FOR UPDATE
        `;
        if (activeAdmins.length <= 1) throw conflict("LAST_SUPER_ADMIN_PROTECTED", "Chưa thể xóa Super Admin cuối cùng khi chưa có phương án kế nhiệm hoặc khôi phục được phê duyệt.");
      }
      const required = await linkedRetentionCategories(tx, current.requesterId);
      const supplied = (input.retentionDecisions ?? []).map((item) => item.category).sort();
      if (required.length !== supplied.length || required.some((category, index) => category !== supplied[index])) {
        throw conflict("RETENTION_POLICY_GATE", "Chưa có căn cứ lưu giữ được ghi nhận cho mọi nhóm dữ liệu liên quan; không thể thực thi.", { requiredCategories: required });
      }
      const passwordHash = await hashPassword(`${randomUUID()}Aa1!`);
      const now = new Date();
      const changed = await tx.accountDeletionRequest.updateMany({
        where: { id, status: AccountDeletionStatus.APPROVED, revision: input.revision },
        data: {
          status: AccountDeletionStatus.EXECUTED,
          revision: { increment: 1 },
          activeRequesterId: null,
          decisionReason: input.reason,
          retentionDecisions: input.retentionDecisions!,
          removedData: ["USERNAME", "DISPLAY_NAME", "PASSWORD_CREDENTIAL", "ACTIVE_SESSIONS"],
          executedAt: now
        }
      });
      if (changed.count !== 1) throw conflict("STALE_REVISION", "Yêu cầu vừa thay đổi. Vui lòng tải lại.");
      await tx.user.update({
        where: { id: current.requesterId },
        data: {
          username: `deleted-${current.requesterId}`,
          displayName: "Tài khoản đã xóa",
          email: null,
          passwordHash,
          isActive: false,
          authVersion: { increment: 1 },
          deletedAt: now
        }
      });
      await tx.authSession.updateMany({ where: { userId: current.requesterId, revokedAt: null }, data: { revokedAt: now } });
      await tx.accountDeletionEvent.create({
        data: {
          requestId: id,
          actorId,
          type: AccountDeletionEventType.EXECUTED,
          fromStatus: AccountDeletionStatus.APPROVED,
          toStatus: AccountDeletionStatus.EXECUTED,
          reason: input.reason,
          metadata: { retentionDecisions: input.retentionDecisions!, removedData: ["USERNAME", "DISPLAY_NAME", "PASSWORD_CREDENTIAL", "ACTIVE_SESSIONS"] }
        }
      });
      return tx.accountDeletionRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    }

    const transition = input.action === "REJECT" && (current.status === AccountDeletionStatus.IN_REVIEW || current.status === AccountDeletionStatus.VERIFIED)
      ? { from: current.status, to: AccountDeletionStatus.REJECTED, event: AccountDeletionEventType.REJECTED }
      : transitions[input.action];
    if (!transition || current.status !== transition.from) throw conflict("INVALID_DELETION_TRANSITION", "Trạng thái hiện tại không cho phép thao tác này.");
    const terminal = transition.to === AccountDeletionStatus.REJECTED;
    const now = new Date();
    const timestamps = transition.to === AccountDeletionStatus.IN_REVIEW ? { inReviewAt: now }
      : transition.to === AccountDeletionStatus.VERIFIED ? { verifiedAt: now }
      : transition.to === AccountDeletionStatus.APPROVED ? { approvedAt: now }
      : transition.to === AccountDeletionStatus.REJECTED ? { rejectedAt: now }
      : {};
    const changed = await tx.accountDeletionRequest.updateMany({
      where: { id, status: transition.from, revision: input.revision },
      data: {
        status: transition.to,
        revision: { increment: 1 },
        decisionReason: input.reason,
        ...(terminal ? { activeRequesterId: null } : {}),
        ...timestamps
      }
    });
    if (changed.count !== 1) throw conflict("STALE_REVISION", "Yêu cầu vừa thay đổi. Vui lòng tải lại.");
    await tx.accountDeletionEvent.create({
      data: { requestId: id, actorId, type: transition.event, fromStatus: transition.from, toStatus: transition.to, reason: input.reason }
    });
    return tx.accountDeletionRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  let updated;
  try {
    updated = await runTransition();
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2010", "P2034"].includes(error.code)) throw error;
    updated = await runTransition();
  }
  response.json({ data: serializeRequest(updated) });
}));


