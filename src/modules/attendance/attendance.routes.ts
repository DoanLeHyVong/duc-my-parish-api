import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  AcademicStatus,
  ActivityType,
  AttendanceEventType,
  AttendanceSessionStatus,
  AttendanceState,
  Prisma,

  ScheduleExceptionType
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import { authenticate } from "../../middleware/auth.js";
import { authorize, isTeacherScope, Permission } from "../../middleware/authorize.js";
import {
  correctionSchema,
  exceptionSchema,
  generateSchema,
  idParamsSchema,
  lifecycleSchema,
  listSchema,
  revisionSchema,
  saveSchema,
  templateSchema,
  templateUpdateSchema
} from "./attendance.schemas.js";

export const adminAttendanceRouter = Router();
export const teacherAttendanceRouter = Router();
adminAttendanceRouter.use(authenticate, authorize(Permission.APPGLV_MANAGE));
teacherAttendanceRouter.use(authenticate, authorize(Permission.APPGLV_TEACH));

const sessionInclude = {
  catechismClass: { include: { academicYear: true } },
  records: { orderBy: [{ fullNameSnapshot: "asc" }, { saintNameSnapshot: "asc" }] },
  events: { orderBy: { createdAt: "desc" }, include: { actor: { select: { id: true, displayName: true } } } },
  auditEntries: { orderBy: { createdAt: "desc" }, include: { actor: { select: { id: true, displayName: true } } } }
} satisfies Prisma.AttendanceSessionInclude;

type SessionDetail = Prisma.AttendanceSessionGetPayload<{ include: typeof sessionInclude }>;

const conflict = (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details);
const notFound = (entity: string) => new ApiError(404, "NOT_FOUND", `Không tìm thấy ${entity}.`);

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function savePayloadFingerprint(input: { revision: number; records: Array<{ studentId: string; state: string }> }): string {
  const records = [...input.records].sort((left, right) => left.studentId.localeCompare(right.studentId));
  return createHash("sha256").update(JSON.stringify({ revision: input.revision, records })).digest("hex");
}

function validateEventReplay(
  event: { sessionId: string; type: AttendanceEventType; details: Prisma.JsonValue | null } | null,
  sessionId: string,
  type: AttendanceEventType,
  payloadFingerprint?: string
) {
  const details = event?.details;
  const storedFingerprint = details && typeof details === "object" && !Array.isArray(details)
    ? details.payloadFingerprint
    : undefined;
  if (!event || event.sessionId !== sessionId || event.type !== type || (payloadFingerprint && storedFingerprint !== payloadFingerprint)) {
    throw conflict("REQUEST_ID_REUSED", "Mã yêu cầu đã được dùng cho thao tác hoặc dữ liệu khác.");
  }
}

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function occurrenceInstant(day: string, minute: number, utcOffsetMinutes: number): Date {
  const start = toDateOnly(day).getTime();
  return new Date(start + (minute - utcOffsetMinutes) * 60_000);
}

function plusMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function serializeSession(item: SessionDetail, isAdmin: boolean) {
  const counts = item.records.reduce(
    (result, record) => {
      result.total += 1;
      if (record.state === AttendanceState.PRESENT) result.present += 1;
      else if (record.state === AttendanceState.ABSENT) result.absent += 1;
      else result.notMarked += 1;
      return result;
    },
    { total: 0, present: 0, absent: 0, notMarked: 0 }
  );
  const now = Date.now();
  const insideWindow = now >= item.windowOpensAt.getTime() && now <= item.windowClosesAt.getTime();
  const { auditEntries, events, ...visibleItem } = item;
  return {
    ...visibleItem,
    ...(isAdmin ? { auditEntries } : {}),
    events: isAdmin
      ? events
      : events.map(({ details: _details, ...event }) => event),
    counts,
    insideWindow,
    canEdit: item.status === AttendanceSessionStatus.OPEN && !item.isCancelled && (isAdmin || insideWindow)
  };
}

async function openClass(id: string) {
  const item = await prisma.catechismClass.findUnique({ where: { id }, include: { academicYear: true } });
  if (!item) throw notFound("Lớp");
  if (item.status !== AcademicStatus.OPEN || item.academicYear.status !== AcademicStatus.OPEN) {
    throw conflict("ATTENDANCE_SCOPE_CLOSED", "Lớp hoặc Năm học đã đóng.");
  }
  return item;
}

async function requireTeacherAssignment(teacherId: string, classId: string) {
  const assignment = await prisma.teacherAssignment.findUnique({ where: { currentKey: `${teacherId}:${classId}` } });
  if (!assignment) throw new ApiError(403, "FORBIDDEN", "Bạn không được phân công vào Lớp này.");
}

async function requireTeacherWrite(tx: Prisma.TransactionClient, teacherId: string, session: { classId: string; status: AttendanceSessionStatus; isCancelled: boolean; windowOpensAt: Date; windowClosesAt: Date }) {
  const assignment = await tx.teacherAssignment.findUnique({ where: { currentKey: `${teacherId}:${session.classId}` } });
  if (!assignment) throw new ApiError(403, "FORBIDDEN", "Bạn không được phân công vào Lớp này.");
  if (session.status !== AttendanceSessionStatus.OPEN || session.isCancelled) {
    throw conflict("ATTENDANCE_READ_ONLY", "Phiên điểm danh không còn cho phép Giáo lý viên chỉnh sửa.");
  }
  const now = Date.now();
  if (now < session.windowOpensAt.getTime() || now > session.windowClosesAt.getTime()) {
    throw conflict("ATTENDANCE_WINDOW_CLOSED", "Đã ngoài thời gian điểm danh. Vui lòng liên hệ Admin nếu cần chỉnh sửa.");
  }
}

async function readSession(id: string, request: Request): Promise<SessionDetail> {
  const item = await prisma.attendanceSession.findUnique({ where: { id }, include: sessionInclude });
  if (!item) throw notFound("Phiên điểm danh");
  if (isTeacherScope(request)) await requireTeacherAssignment(request.auth!.userId, item.classId);
  return item;
}

async function rejectOverlappingTemplate(input: {
  classId: string;
  activityType: ActivityType;
  weekday: number;
  occurrenceMinute: number;
  effectiveStart: string;
  effectiveEnd: string;
}, excludeId?: string) {
  const overlap = await prisma.scheduleTemplate.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      classId: input.classId,
      activityType: input.activityType,
      weekday: input.weekday,
      occurrenceMinute: input.occurrenceMinute,
      isActive: true,
      effectiveStart: { lte: toDateOnly(input.effectiveEnd) },
      effectiveEnd: { gte: toDateOnly(input.effectiveStart) }
    },
    select: { id: true }
  });
  if (overlap) throw conflict("SCHEDULE_DUPLICATE", "Lịch hoạt động đang trùng khoảng hiệu lực cho Lớp.");
}

adminAttendanceRouter.get("/templates", asyncHandler(async (request, response) => {
  const query = listSchema.parse(request.query);
  const where: Prisma.ScheduleTemplateWhereInput = {
    ...(query.classId ? { classId: query.classId } : {}),
    ...(query.activityType ? { activityType: query.activityType } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.scheduleTemplate.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: "desc" }, include: { catechismClass: { include: { academicYear: true } } } }),
    prisma.scheduleTemplate.count({ where })
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}));

adminAttendanceRouter.post("/templates", asyncHandler(async (request, response) => {
  const input = templateSchema.parse(request.body);
  await openClass(input.classId);
  await rejectOverlappingTemplate(input);
  try {
    const item = await prisma.scheduleTemplate.create({
      data: {
        ...input,
        effectiveStart: toDateOnly(input.effectiveStart),
        effectiveEnd: toDateOnly(input.effectiveEnd),
        createdById: request.auth!.userId
      },
      include: { catechismClass: { include: { academicYear: true } } }
    });
    response.status(201).json({ data: item });
  } catch (error) {
    if (isUniqueError(error)) throw conflict("SCHEDULE_DUPLICATE", "Lịch này đã tồn tại cho Lớp.");
    throw error;
  }
}));

adminAttendanceRouter.patch("/templates/:id", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = templateUpdateSchema.parse(request.body);
  const current = await prisma.scheduleTemplate.findUnique({ where: { id } });
  if (!current) throw notFound("Lịch hoạt động");
  await openClass(current.classId);
  if (!current.isActive || current.revision !== input.revision) throw conflict("STALE_REVISION", "Lịch vừa thay đổi. Vui lòng tải lại.");
  await rejectOverlappingTemplate({ classId: current.classId, ...input }, id);
  const { revision, effectiveStart, effectiveEnd, ...fields } = input;
  let updated;
  try {
    updated = await prisma.scheduleTemplate.updateMany({
      where: { id, revision, isActive: true },
      data: { ...fields, effectiveStart: toDateOnly(effectiveStart), effectiveEnd: toDateOnly(effectiveEnd), revision: { increment: 1 } }
    });
  } catch (error) {
    if (isUniqueError(error)) throw conflict("SCHEDULE_DUPLICATE", "Lịch này đã tồn tại cho Lớp.");
    throw error;
  }
  if (updated.count !== 1) throw conflict("STALE_REVISION", "Lịch vừa thay đổi. Vui lòng tải lại.");
  response.json({ data: await prisma.scheduleTemplate.findUniqueOrThrow({ where: { id }, include: { catechismClass: true } }) });
}));

adminAttendanceRouter.post("/templates/:id/deactivate", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const { revision } = revisionSchema.parse(request.body);
  const updated = await prisma.scheduleTemplate.updateMany({ where: { id, revision, isActive: true }, data: { isActive: false, revision: { increment: 1 } } });
  if (updated.count !== 1) throw conflict("STALE_REVISION", "Lịch không tồn tại, đã ngừng hoặc vừa thay đổi.");
  response.json({ data: await prisma.scheduleTemplate.findUniqueOrThrow({ where: { id } }) });
}));

async function generateTemplateSessions(templateId: string, fromDate: string, toDate: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.scheduleTemplate.findUnique({ where: { id: templateId }, include: { catechismClass: { include: { academicYear: true, enrollments: { where: { endedAt: null }, include: { student: true } } } } } });
    if (!template) throw notFound("Lịch hoạt động");
    if (!template.isActive || template.catechismClass.status !== AcademicStatus.OPEN || template.catechismClass.academicYear.status !== AcademicStatus.OPEN) {
      throw conflict("ATTENDANCE_SCOPE_CLOSED", "Lịch, Lớp hoặc Năm học đã đóng.");
    }
    const startKey = [fromDate, dateKey(template.effectiveStart)].sort()[1]!;
    const endKey = [toDate, dateKey(template.effectiveEnd)].sort()[0]!;
    if (endKey < startKey) return { created: 0, existing: 0 };
    let created = 0;
    let existing = 0;
    for (let day = toDateOnly(startKey); day <= toDateOnly(endKey); day = new Date(day.getTime() + 86_400_000)) {
      if (day.getUTCDay() !== template.weekday) continue;
      const occursAt = occurrenceInstant(dateKey(day), template.occurrenceMinute, template.utcOffsetMinutes);
      const key = { classId: template.classId, activityType: template.activityType, occursAt };
      if (await tx.attendanceSession.findUnique({ where: { classId_activityType_occursAt: key } })) {
        existing += 1;
        continue;
      }
      await tx.attendanceSession.create({
        data: {
          ...key,
          scheduleTemplateId: template.id,
          windowOpensAt: plusMinutes(occursAt, template.windowOpenOffsetMinutes),
          windowClosesAt: plusMinutes(occursAt, template.windowCloseOffsetMinutes),
          records: { create: template.catechismClass.enrollments.map((entry) => ({ studentId: entry.studentId, saintNameSnapshot: entry.student.saintName, fullNameSnapshot: entry.student.fullName })) },
          events: { create: { type: AttendanceEventType.GENERATED, actorId, details: { templateId: template.id } } }
        }
      });
      created += 1;
    }
    return { created, existing };
  });
}

adminAttendanceRouter.post("/templates/:id/generate", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = generateSchema.parse(request.body);
  try {
    response.json({ data: await generateTemplateSessions(id, input.fromDate, input.toDate, request.auth!.userId) });
  } catch (error) {
    if (isUniqueError(error)) {
      response.json({ data: await generateTemplateSessions(id, input.fromDate, input.toDate, request.auth!.userId) });
      return;
    }
    throw error;
  }
}));

async function createSnapshotSession(tx: Prisma.TransactionClient, input: { classId: string; activityType: ActivityType; occursAt: Date; windowOpensAt: Date; windowClosesAt: Date }, actorId: string) {
  const classItem = await tx.catechismClass.findUnique({ where: { id: input.classId }, include: { academicYear: true, enrollments: { where: { endedAt: null }, include: { student: true } } } });
  if (!classItem) throw notFound("Lớp");
  if (classItem.status !== AcademicStatus.OPEN || classItem.academicYear.status !== AcademicStatus.OPEN) throw conflict("ATTENDANCE_SCOPE_CLOSED", "Lớp hoặc Năm học đã đóng.");
  return tx.attendanceSession.create({
    data: {
      ...input,
      records: { create: classItem.enrollments.map((entry) => ({ studentId: entry.studentId, saintNameSnapshot: entry.student.saintName, fullNameSnapshot: entry.student.fullName })) },
      events: { create: { type: AttendanceEventType.GENERATED, actorId, details: { source: "exception-add" } } }
    }
  });
}

adminAttendanceRouter.post("/exceptions", asyncHandler(async (request, response) => {
  const input = exceptionSchema.parse(request.body);
  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (input.type === ScheduleExceptionType.ADD) {
        const session = await createSnapshotSession(tx, {
          classId: input.classId!, activityType: input.activityType!, occursAt: new Date(input.occursAt!), windowOpensAt: new Date(input.windowOpensAt!), windowClosesAt: new Date(input.windowClosesAt!)
        }, request.auth!.userId);
        const exception = await tx.scheduleException.create({ data: { classId: input.classId!, resultSessionId: session.id, createdById: request.auth!.userId, type: input.type, note: input.note, newOccursAt: session.occursAt } });
        return { exception, session };
      }
      const session = await tx.attendanceSession.findUnique({ where: { id: input.sessionId! }, include: { records: true } });
      if (!session) throw notFound("Phiên điểm danh");
      const untouched = session.status === AttendanceSessionStatus.OPEN && !session.isCancelled && !session.hasUserMutation && session.occursAt > now && session.records.every((record) => record.state === AttendanceState.NOT_MARKED);
      if (!untouched) throw conflict("SESSION_NOT_REGENERATABLE", "Chỉ phiên Open trong tương lai chưa có thao tác điểm danh mới được thay đổi.");
      const previousOccursAt = session.occursAt;
      const data = input.type === ScheduleExceptionType.CANCEL
        ? { isCancelled: true, revision: { increment: 1 } }
        : { occursAt: new Date(input.occursAt!), windowOpensAt: new Date(input.windowOpensAt!), windowClosesAt: new Date(input.windowClosesAt!), revision: { increment: 1 } };
      const changed = await tx.attendanceSession.updateMany({
        where: {
          id: session.id,
          revision: session.revision,
          status: AttendanceSessionStatus.OPEN,
          isCancelled: false,
          hasUserMutation: false,
          occursAt: { gt: now }
        },
        data
      });
      if (changed.count !== 1) throw conflict("SESSION_NOT_REGENERATABLE", "Chỉ phiên Open trong tương lai chưa có thao tác điểm danh mới được thay đổi.");
      const updated = await tx.attendanceSession.findUniqueOrThrow({ where: { id: session.id } });
      await tx.attendanceEvent.create({ data: { sessionId: session.id, actorId: request.auth!.userId, type: AttendanceEventType.SCHEDULE_CHANGED, details: { exceptionType: input.type, previousOccursAt, newOccursAt: updated.occursAt } } });
      const exception = await tx.scheduleException.create({ data: { classId: session.classId, scheduleTemplateId: session.scheduleTemplateId, targetSessionId: session.id, createdById: request.auth!.userId, type: input.type, note: input.note, previousOccursAt, newOccursAt: updated.occursAt } });
      return { exception, session: updated };
    });
    response.status(201).json({ data: result });
  } catch (error) {
    if (isUniqueError(error)) throw conflict("SESSION_DUPLICATE", "Phiên điểm danh đã tồn tại cho Lớp và thời điểm này.");
    throw error;
  }
}));

function sessionWhere(request: Request) {
  const query = listSchema.parse(request.query);
  const where: Prisma.AttendanceSessionWhereInput = {
    ...(query.classId ? { classId: query.classId } : {}),
    ...(query.activityType ? { activityType: query.activityType } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to ? { occursAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    ...(isTeacherScope(request) ? { catechismClass: { assignments: { some: { teacherId: request.auth!.userId, endedAt: null } } } } : {})
  };
  return { query, where };
}

async function listSessions(request: Request, response: Response) {
  const { query, where } = sessionWhere(request);
  const [items, total] = await prisma.$transaction([
    prisma.attendanceSession.findMany({ where, include: sessionInclude, orderBy: { occursAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.attendanceSession.count({ where })
  ]);
  response.json({ data: { items: items.map((item) => serializeSession(item, !isTeacherScope(request))), total, page: query.page, limit: query.limit } });
}

async function getSession(request: Request, response: Response) {
  const { id } = idParamsSchema.parse(request.params);
  const item = await readSession(id, request);
  response.json({ data: serializeSession(item, !isTeacherScope(request)) });
}

async function saveAttendance(request: Request, response: Response) {
  const { id } = idParamsSchema.parse(request.params);
  const input = saveSchema.parse(request.body);
  const payloadFingerprint = savePayloadFingerprint(input);
  const replay = await prisma.attendanceEvent.findUnique({ where: { requestId: input.requestId } });
  if (replay) {
    validateEventReplay(replay, id, AttendanceEventType.SAVED, payloadFingerprint);
    response.json({ data: serializeSession(await readSession(id, request), !isTeacherScope(request)) });
    return;
  }
  try {
    await prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.findUnique({ where: { id } });
      if (!session) throw notFound("Phiên điểm danh");
      if (isTeacherScope(request)) await requireTeacherWrite(tx, request.auth!.userId, session);
      else if (session.status !== AttendanceSessionStatus.OPEN || session.isCancelled) throw conflict("ATTENDANCE_READ_ONLY", "Phiên điểm danh không còn cho phép chỉnh sửa.");
      if (session.revision !== input.revision) throw conflict("STALE_REVISION", "Phiên điểm danh vừa thay đổi. Vui lòng tải lại.");
      const rosterCount = await tx.attendanceRecord.count({ where: { sessionId: id, studentId: { in: input.records.map((record) => record.studentId) } } });
      if (rosterCount !== input.records.length) throw conflict("ROSTER_MISMATCH", "Yêu cầu chứa Học sinh không thuộc roster phiên này.");
      const markedAt = new Date();
      for (const record of input.records) {
        await tx.attendanceRecord.update({
          where: { sessionId_studentId: { sessionId: id, studentId: record.studentId } },
          data: { state: record.state, updatedById: request.auth!.userId, markedAt: record.state === AttendanceState.NOT_MARKED ? null : markedAt }
        });
      }
      const updated = await tx.attendanceSession.updateMany({ where: { id, revision: input.revision, status: AttendanceSessionStatus.OPEN, isCancelled: false }, data: { revision: { increment: 1 }, hasUserMutation: true } });
      if (updated.count !== 1) throw conflict("STALE_REVISION", "Phiên điểm danh vừa thay đổi. Vui lòng tải lại.");
      await tx.attendanceEvent.create({ data: { sessionId: id, actorId: request.auth!.userId, type: AttendanceEventType.SAVED, requestId: input.requestId, details: { records: input.records.length, payloadFingerprint } } });
    });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    validateEventReplay(
      await prisma.attendanceEvent.findUnique({ where: { requestId: input.requestId } }),
      id,
      AttendanceEventType.SAVED,
      payloadFingerprint
    );
  }
  response.json({ data: serializeSession(await readSession(id, request), !isTeacherScope(request)) });
}

async function submitAttendance(request: Request, response: Response) {
  const { id } = idParamsSchema.parse(request.params);
  const input = lifecycleSchema.parse(request.body);
  const replay = await prisma.attendanceEvent.findUnique({ where: { requestId: input.requestId } });
  if (replay) {
    validateEventReplay(replay, id, AttendanceEventType.SUBMITTED);
    response.json({ data: serializeSession(await readSession(id, request), !isTeacherScope(request)) });
    return;
  }
  try {
    await prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.findUnique({ where: { id } });
      if (!session) throw notFound("Phiên điểm danh");
      if (isTeacherScope(request)) await requireTeacherWrite(tx, request.auth!.userId, session);
      else if (session.status !== AttendanceSessionStatus.OPEN || session.isCancelled) throw conflict("ATTENDANCE_READ_ONLY", "Phiên điểm danh không thể gửi.");
      if (session.revision !== input.revision) throw conflict("STALE_REVISION", "Phiên điểm danh vừa thay đổi. Vui lòng tải lại.");
      if (await tx.attendanceRecord.count({ where: { sessionId: id, state: AttendanceState.NOT_MARKED } })) {
        throw conflict("ATTENDANCE_SUBMIT_POLICY_PENDING", "Còn Học sinh Chưa điểm danh. Quy tắc gửi đang chờ Giáo xứ xác nhận.");
      }
      const now = new Date();
      const updated = await tx.attendanceSession.updateMany({ where: { id, revision: input.revision, status: AttendanceSessionStatus.OPEN, isCancelled: false }, data: { status: AttendanceSessionStatus.SUBMITTED, submittedAt: now, submittedById: request.auth!.userId, revision: { increment: 1 }, hasUserMutation: true } });
      if (updated.count !== 1) throw conflict("STALE_REVISION", "Phiên điểm danh vừa thay đổi. Vui lòng tải lại.");
      await tx.attendanceEvent.create({ data: { sessionId: id, actorId: request.auth!.userId, type: AttendanceEventType.SUBMITTED, requestId: input.requestId } });
    });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    validateEventReplay(
      await prisma.attendanceEvent.findUnique({ where: { requestId: input.requestId } }),
      id,
      AttendanceEventType.SUBMITTED
    );
  }
  response.json({ data: serializeSession(await readSession(id, request), !isTeacherScope(request)) });
}

adminAttendanceRouter.post("/sessions/:id/finalize", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = lifecycleSchema.parse(request.body);
  const replay = await prisma.attendanceEvent.findUnique({ where: { requestId: input.requestId } });
  if (replay) validateEventReplay(replay, id, AttendanceEventType.FINALIZED);
  if (!replay) {
    try {
      await prisma.$transaction(async (tx) => {
        const session = await tx.attendanceSession.findUnique({ where: { id } });
        if (!session) throw notFound("Phiên điểm danh");
        if (session.status !== AttendanceSessionStatus.SUBMITTED || session.revision !== input.revision) throw conflict("INVALID_ATTENDANCE_TRANSITION", "Chỉ phiên Đã gửi đúng phiên bản mới có thể chốt.");
        const updated = await tx.attendanceSession.updateMany({ where: { id, revision: input.revision, status: AttendanceSessionStatus.SUBMITTED }, data: { status: AttendanceSessionStatus.FINALIZED, finalizedAt: new Date(), finalizedById: request.auth!.userId, revision: { increment: 1 } } });
        if (updated.count !== 1) throw conflict("STALE_REVISION", "Phiên điểm danh vừa thay đổi. Vui lòng tải lại.");
        await tx.attendanceEvent.create({ data: { sessionId: id, actorId: request.auth!.userId, type: AttendanceEventType.FINALIZED, requestId: input.requestId } });
      });
    } catch (error) {
      if (isWriteConflict(error)) {
        throw conflict("ATTENDANCE_CORRECTION_CONFLICT", "Kết quả vừa được người khác chỉnh sửa. Vui lòng tải lại trước khi tiếp tục.");
      }
      if (!isUniqueError(error)) throw error;
      validateEventReplay(
        await prisma.attendanceEvent.findUnique({ where: { requestId: input.requestId } }),
        id,
        AttendanceEventType.FINALIZED
      );
    }
  }
  response.json({ data: serializeSession(await readSession(id, request), true) });
}));

adminAttendanceRouter.post("/records/:id/correct", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = correctionSchema.parse(request.body);
  const replay = await prisma.attendanceAuditEntry.findUnique({ where: { requestId: input.requestId } });
  const isMatchingReplay = (entry: { recordId: string; afterState: AttendanceState; reason: string }) =>
    entry.recordId === id && entry.afterState === input.state && entry.reason === input.reason;
  if (!replay) {
    try {
      await prisma.$transaction(async (tx) => {
        const record = await tx.attendanceRecord.findUnique({ where: { id }, include: { session: true } });
        if (!record) throw notFound("Kết quả điểm danh");
        if (record.session.status !== AttendanceSessionStatus.FINALIZED) throw conflict("ATTENDANCE_NOT_FINALIZED", "Chỉ kết quả đã chốt mới được chỉnh sửa trực tiếp.");
        if (record.state === input.state) throw conflict("ATTENDANCE_NO_CHANGE", "Trạng thái mới phải khác trạng thái hiện tại.");
        const updated = await tx.attendanceRecord.updateMany({
          where: { id, state: record.state },
          data: { state: input.state, updatedById: request.auth!.userId, markedAt: input.state === AttendanceState.NOT_MARKED ? null : new Date() }
        });
        if (updated.count !== 1) {
          throw conflict("ATTENDANCE_CORRECTION_CONFLICT", "Kết quả vừa được người khác chỉnh sửa. Vui lòng tải lại trước khi tiếp tục.");
        }
        await tx.attendanceSession.update({ where: { id: record.sessionId }, data: { revision: { increment: 1 } } });
        await tx.attendanceAuditEntry.create({ data: { sessionId: record.sessionId, recordId: id, actorId: request.auth!.userId, requestId: input.requestId, beforeState: record.state, afterState: input.state, reason: input.reason } });
        await tx.attendanceEvent.create({ data: { sessionId: record.sessionId, actorId: request.auth!.userId, type: AttendanceEventType.CORRECTED, requestId: input.requestId, details: { recordId: id, beforeState: record.state, afterState: input.state, reason: input.reason } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      const racedReplay = await prisma.attendanceAuditEntry.findUnique({ where: { requestId: input.requestId } });
      if (!racedReplay || !isMatchingReplay(racedReplay)) throw conflict("REQUEST_ID_REUSED", "Mã yêu cầu đã được dùng cho nội dung chỉnh sửa khác.");
    }
  } else if (!isMatchingReplay(replay)) throw conflict("REQUEST_ID_REUSED", "Mã yêu cầu đã được dùng cho nội dung chỉnh sửa khác.");
  const record = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id }, include: { auditEntries: { orderBy: { createdAt: "desc" }, include: { actor: { select: { displayName: true } } } } } });
  response.json({ data: record });
}));

async function listAbsences(request: Request, response: Response) {
  const { query, where: sessionFilter } = sessionWhere(request);
  const where: Prisma.AttendanceRecordWhereInput = { state: AttendanceState.ABSENT, session: sessionFilter };
  const [items, total] = await prisma.$transaction([
    prisma.attendanceRecord.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ session: { occursAt: "desc" } }, { id: "desc" }], include: { session: { include: { catechismClass: true } } } }),
    prisma.attendanceRecord.count({ where })
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}

adminAttendanceRouter.get("/audit", asyncHandler(async (request, response) => {
  const query = listSchema.parse(request.query);
  const where: Prisma.AttendanceAuditEntryWhereInput = {
    ...(query.classId || query.activityType || query.status || query.from || query.to ? { session: sessionWhere(request).where } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.attendanceAuditEntry.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: "desc" }, include: { actor: { select: { displayName: true } }, record: true, session: { include: { catechismClass: true } } } }),
    prisma.attendanceAuditEntry.count({ where })
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}));

for (const router of [adminAttendanceRouter, teacherAttendanceRouter]) {
  router.get("/sessions", asyncHandler(listSessions));
  router.get("/sessions/:id", asyncHandler(getSession));
  router.post("/sessions/:id/save", asyncHandler(saveAttendance));
  router.post("/sessions/:id/submit", asyncHandler(submitAttendance));
  router.get("/history", asyncHandler(listSessions));
  router.get("/absences", asyncHandler(listAbsences));
}


