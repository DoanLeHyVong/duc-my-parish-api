import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getEnv } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { AccountDeletionStatus, ActivityType, GradeRoundingMethod, RoleCode } from "../src/generated/prisma/client.js";

const app = createApp();
const password = "Delete@Test123!";
let adminToken: string;
let adminId: string;
let teacherToken: string;
let teacherId: string;

async function cleanDatabase() {
  if (getEnv().DATABASE_NAME !== "appglv_unified_test") throw new Error("Account-deletion tests refuse to clear a database other than appglv_unified_test.");
  await prisma.accountDeletionEvent.deleteMany();
  await prisma.accountDeletionRequest.deleteMany();
  await prisma.classificationResult.deleteMany();
  await prisma.classificationRuleBand.deleteMany();
  await prisma.classificationRuleWeight.deleteMany();
  await prisma.classificationRuleVersion.deleteMany();
  await prisma.gradeAuditEntry.deleteMany();
  await prisma.gradeRecord.deleteMany();
  await prisma.gradeColumn.deleteMany();
  await prisma.studentImportEvent.deleteMany();
  await prisma.studentImportRow.deleteMany();
  await prisma.studentImportBatch.deleteMany();
  await prisma.scheduleException.deleteMany();
  await prisma.attendanceAuditEntry.deleteMany();
  await prisma.attendanceEvent.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.scheduleTemplate.deleteMany();
  await prisma.teacherAssignment.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.student.deleteMany();
  await prisma.semester.deleteMany();
  await prisma.catechismClass.deleteMany();
  await prisma.academicYear.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.userRoleAssignment.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await cleanDatabase();
  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.create({ data: { username: "deletion.admin", displayName: "Deletion Admin", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } });
  const teacher = await prisma.user.create({ data: { username: "deletion.teacher", displayName: "Deletion Teacher", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } });
  adminId = admin.id;
  teacherId = teacher.id;
  adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
});

afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function submit(token = teacherToken, requestKey = "delete-request-0001") {
  return request(app).post("/api/v1/account-deletion/requests").set(auth(token)).send({ requestKey, currentPassword: password, confirmation: "XÓA TÀI KHOẢN" });
}

async function transition(id: string, revision: number, action: string, reason = "Đã kiểm tra đúng quy trình", extra: object = {}) {
  return request(app).post(`/api/v1/admin/account-deletion/requests/${id}/transitions`).set(auth(adminToken)).send({ action, revision, reason, ...extra });
}

describe("account and data deletion workflow with MariaDB", () => {
  it("requires re-authentication, creates one active request, and makes submission replay safe", async () => {
    const wrong = await request(app).post("/api/v1/account-deletion/requests").set(auth(teacherToken)).send({ requestKey: "delete-wrong-0001", currentPassword: "Wrong@Test123!", confirmation: "XÓA TÀI KHOẢN" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe("CURRENT_PASSWORD_INVALID");
    const created = await submit();
    expect(created.status).toBe(201);
    const invalidReplay = await request(app).post("/api/v1/account-deletion/requests").set(auth(teacherToken)).send({ requestKey: "delete-request-0001", currentPassword: "Wrong@Test123!", confirmation: "XÓA TÀI KHOẢN" });
    expect(invalidReplay.status).toBe(422);
    expect(invalidReplay.body.error.code).toBe("CURRENT_PASSWORD_INVALID");
    const replay = await submit();
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(created.body.data.id);
    const duplicate = await submit(teacherToken, "delete-request-0002");
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ACTIVE_DELETION_REQUEST_EXISTS");
    expect(await prisma.accountDeletionRequest.count()).toBe(1);
    expect(await prisma.accountDeletionEvent.count()).toBe(1);
  });

  it("translates a concurrent cross-user request key race to a stable conflict", async () => {
    const passwordHash = await hashPassword(password);
    const otherTeacher = await prisma.user.create({ data: { username: "deletion.teacher.two", displayName: "Deletion Teacher Two", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } });
    const otherToken = signAccessToken({ sub: otherTeacher.id, av: otherTeacher.authVersion });
    const responses = await Promise.all([
      submit(teacherToken, "shared-delete-request-key"),
      submit(otherToken, "shared-delete-request-key")
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)!.body.error.code).toBe("REQUEST_KEY_CONFLICT");
    expect(await prisma.accountDeletionRequest.count({ where: { requestKey: "shared-delete-request-key" } })).toBe(1);
  });

  it("throttles repeated current-password failures", async () => {
    const responses = [];
    for (let attempt = 0; attempt <= getEnv().AUTH_RATE_LIMIT_MAX; attempt += 1) {
      responses.push(await request(app).post("/api/v1/account-deletion/requests").set(auth(teacherToken)).send({ requestKey: `throttle-${attempt}`, currentPassword: "Wrong@Test123!", confirmation: "XÓA TÀI KHOẢN" }));
    }
    expect(responses.at(-1)!.status).toBe(429);
    expect(responses.at(-1)!.body.error.code).toBe("TOO_MANY_ATTEMPTS");
  }, 20_000);

  it("enforces RBAC, current ownership, valid transitions, reasons, and optimistic revisions", async () => {
    const created = await submit();
    const id = created.body.data.id as string;
    expect((await request(app).get("/api/v1/admin/account-deletion/requests").set(auth(teacherToken))).status).toBe(403);
    expect((await request(app).get(`/api/v1/account-deletion/requests/${id}`).set(auth(adminToken))).status).toBe(404);
    expect((await transition(id, 1, "APPROVE")).body.error.code).toBe("INVALID_DELETION_TRANSITION");
    expect((await transition(id, 1, "START_REVIEW", "x")).status).toBe(422);
    const review = await transition(id, 1, "START_REVIEW");
    expect(review.body.data.status).toBe("IN_REVIEW");
    expect((await transition(id, 1, "VERIFY")).body.error.code).toBe("STALE_REVISION");
  });

  it("blocks execution without complete retention basis, then retires identity and preserves approved history", async () => {
    const year = await prisma.academicYear.create({ data: { name: "Deletion Test Year" } });
    const klass = await prisma.catechismClass.create({ data: { name: "Deletion Test Class", academicYearId: year.id } });
    const semester = await prisma.semester.create({ data: { name: "Deletion Test Semester", academicYearId: year.id } });
    const student = await prisma.student.create({ data: { saintName: "Anrê", fullName: "Học sinh kiểm thử" } });
    const assignment = await prisma.teacherAssignment.create({ data: { teacherId, classId: klass.id, currentKey: `${teacherId}:${klass.id}` } });
    await prisma.scheduleTemplate.create({ data: {
      classId: klass.id, createdById: teacherId, activityType: ActivityType.TUESDAY_MASS,
      weekday: 2, occurrenceMinute: 1020, utcOffsetMinutes: 420, windowOpenOffsetMinutes: -30,
      windowCloseOffsetMinutes: 30, effectiveStart: new Date("2026-01-01T00:00:00.000Z"),
      effectiveEnd: new Date("2026-12-31T00:00:00.000Z")
    } });
    await prisma.attendanceSession.create({ data: {
      classId: klass.id, activityType: ActivityType.TUESDAY_MASS,
      occursAt: new Date("2026-11-03T10:00:00.000Z"), windowOpensAt: new Date("2026-11-03T09:30:00.000Z"),
      windowClosesAt: new Date("2026-11-03T10:30:00.000Z"), submittedById: teacherId
    } });
    await prisma.studentImportBatch.create({ data: {
      actorId: teacherId, classId: klass.id, fileName: "deletion-test.xlsx", fileSize: 128,
      fileSha256: "a".repeat(64), mappingKey: "b".repeat(64), mapping: { saintName: "Tên Thánh", fullName: "Họ tên" }
    } });
    const column = await prisma.gradeColumn.create({ data: {
      classId: klass.id, semesterId: semester.id, name: "Kiểm tra", minimum: "0", maximum: "10", precision: 1
    } });
    const grade = await prisma.gradeRecord.create({ data: {
      studentId: student.id, classId: klass.id, semesterId: semester.id, gradeColumnId: column.id, value: "8"
    } });
    await prisma.gradeAuditEntry.create({ data: {
      gradeRecordId: grade.id, actorId: teacherId, requestId: "deletion-grade-audit", fingerprint: "c".repeat(64),
      afterValue: "8", afterRevision: 0
    } });
    await prisma.classificationRuleVersion.create({ data: {
      classId: klass.id, semesterId: semester.id, version: 1, decimalPlaces: 1,
      roundingMethod: GradeRoundingMethod.HALF_UP, publishedById: teacherId
    } });
    const created = await submit();
    const id = created.body.data.id as string;
    const detail = await request(app).get(`/api/v1/admin/account-deletion/requests/${id}`).set(auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.requiredRetentionCategories).toEqual([
      "ACCOUNT_DELETION_AUDIT", "ATTENDANCE_HISTORY", "CLASSIFICATION_HISTORY", "GRADE_HISTORY",
      "IMPORT_HISTORY", "SCHEDULE_ADMINISTRATION", "TEACHER_ASSIGNMENTS"
    ]);
    expect((await transition(id, 1, "START_REVIEW")).body.data.status).toBe("IN_REVIEW");
    expect((await transition(id, 2, "VERIFY")).body.data.status).toBe("VERIFIED");
    expect((await transition(id, 3, "APPROVE")).body.data.status).toBe("APPROVED");
    const blocked = await transition(id, 4, "EXECUTE", "Thực thi sau khi xác định căn cứ", { retentionDecisions: [{ category: "ACCOUNT_DELETION_AUDIT", basis: "Bằng chứng xử lý yêu cầu xóa đã được phê duyệt lưu giữ." }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("RETENTION_POLICY_GATE");
    expect(blocked.body.error.details.requiredCategories).toEqual(detail.body.data.requiredRetentionCategories);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: teacherId } })).deletedAt).toBeNull();

    const executed = await transition(id, 4, "EXECUTE", "Đã xác định và ghi nhận đầy đủ phạm vi xử lý", { retentionDecisions: [
      { category: "ACCOUNT_DELETION_AUDIT", basis: "Bằng chứng xử lý yêu cầu xóa đã được phê duyệt lưu giữ." },
      { category: "ATTENDANCE_HISTORY", basis: "Bảo toàn lịch sử điểm danh theo căn cứ đã được phê duyệt." },
      { category: "CLASSIFICATION_HISTORY", basis: "Bảo toàn lịch sử xếp loại theo căn cứ đã được phê duyệt." },
      { category: "GRADE_HISTORY", basis: "Bảo toàn lịch sử điểm số theo căn cứ đã được phê duyệt." },
      { category: "IMPORT_HISTORY", basis: "Bảo toàn lịch sử nhập dữ liệu theo căn cứ đã được phê duyệt." },
      { category: "SCHEDULE_ADMINISTRATION", basis: "Bảo toàn lịch sử quản trị lịch theo căn cứ đã được phê duyệt." },
      { category: "TEACHER_ASSIGNMENTS", basis: "Bảo toàn phân công lịch sử đã được phê duyệt cho hồ sơ nghiệp vụ." }
    ] });
    expect(executed.status).toBe(200);
    expect(executed.body.data.status).toBe("EXECUTED");
    const retired = await prisma.user.findUniqueOrThrow({ where: { id: teacherId } });
    expect(retired).toMatchObject({ isActive: false, displayName: "Tài khoản đã xóa" });
    expect(retired.username).toBe(`deleted-${teacherId}`);
    expect(retired.deletedAt).not.toBeNull();
    expect((await request(app).get("/api/v1/auth/me").set(auth(teacherToken))).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/login").send({ username: "deletion.teacher", password })).status).toBe(401);
    expect(await prisma.teacherAssignment.count({ where: { id: assignment.id, teacherId } })).toBe(1);
    expect(await prisma.accountDeletionEvent.count({ where: { requestId: id } })).toBe(5);
    const persistedRequest = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id } });
    expect(persistedRequest.retentionDecisions).toEqual(executed.body.data.retentionDecisions);
    expect(persistedRequest.removedData).toEqual(["USERNAME", "DISPLAY_NAME", "PASSWORD_CREDENTIAL", "ACTIVE_SESSIONS"]);
    const executionEvent = await prisma.accountDeletionEvent.findFirstOrThrow({ where: { requestId: id, type: "EXECUTED" } });
    expect(executionEvent.metadata).toEqual({
      retentionDecisions: executed.body.data.retentionDecisions,
      removedData: ["USERNAME", "DISPLAY_NAME", "PASSWORD_CREDENTIAL", "ACTIVE_SESSIONS"]
    });
  });

  it("records rejection as terminal while leaving authentication active", async () => {
    const created = await submit();
    const id = created.body.data.id as string;
    await transition(id, 1, "START_REVIEW");
    await transition(id, 2, "VERIFY");
    const rejected = await transition(id, 3, "REJECT", "Không thể tiếp tục phê duyệt yêu cầu");
    expect(rejected.body.data.status).toBe("REJECTED");
    expect((await request(app).get("/api/v1/auth/me").set(auth(teacherToken))).status).toBe(200);
    expect((await submit(teacherToken, "delete-request-after-reject")).status).toBe(201);
  });

  it("allows the sole Super Admin to submit and track but never self-review", async () => {
    const created = await submit(adminToken, "admin-delete-request");
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const selfReview = await transition(id, 1, "START_REVIEW");
    expect(selfReview.status).toBe(403);
    expect(selfReview.body.error.code).toBe("SELF_REVIEW_FORBIDDEN");
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id } })).status).toBe(AccountDeletionStatus.SUBMITTED);
    expect((await request(app).get("/api/v1/account-deletion/requests").set(auth(adminToken))).body.data.total).toBe(1);
  });

  it("serializes concurrent Super Admin executions so one administrator remains active", async () => {
    const passwordHash = await hashPassword(password);
    const otherAdmin = await prisma.user.create({ data: { username: "deletion.admin.two", displayName: "Deletion Admin Two", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } });
    const otherAdminToken = signAccessToken({ sub: otherAdmin.id, av: otherAdmin.authVersion });
    const [first, second] = await Promise.all([
      prisma.accountDeletionRequest.create({ data: { requestKey: "admin-race-one", requesterId: adminId, activeRequesterId: adminId, status: AccountDeletionStatus.APPROVED } }),
      prisma.accountDeletionRequest.create({ data: { requestKey: "admin-race-two", requesterId: otherAdmin.id, activeRequesterId: otherAdmin.id, status: AccountDeletionStatus.APPROVED } })
    ]);
    const payload = {
      action: "EXECUTE",
      revision: 1,
      reason: "Đã xác định đầy đủ căn cứ xử lý",
      retentionDecisions: [{ category: "ACCOUNT_DELETION_AUDIT", basis: "Bằng chứng xử lý yêu cầu xóa được lưu giữ." }]
    };
    const responses = await Promise.all([
      request(app).post(`/api/v1/admin/account-deletion/requests/${first.id}/transitions`).set(auth(otherAdminToken)).send(payload),
      request(app).post(`/api/v1/admin/account-deletion/requests/${second.id}/transitions`).set(auth(adminToken)).send(payload)
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)!.body.error.code).toBe("LAST_SUPER_ADMIN_PROTECTED");
    expect(await prisma.user.count({ where: { roleAssignments: { some: { role: { code: RoleCode.SUPER_ADMIN } } }, isActive: true, deletedAt: null } })).toBe(1);
  });

  it("keeps guardian and Student requests on the unauthenticated public channel", async () => {
    expect((await request(app).post("/api/v1/account-deletion/requests").send({ requestKey: "guardian-request", currentPassword: "none", confirmation: "XÓA TÀI KHOẢN" })).status).toBe(401);
    expect((await request(app).post("/api/v1/admin/account-deletion/guardian-requests").set(auth(adminToken)).send({})).status).toBe(404);
    expect(await prisma.accountDeletionRequest.count()).toBe(0);
  });
});


