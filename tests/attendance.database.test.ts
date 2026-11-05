import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getEnv } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { ActivityType, AttendanceSessionStatus, AttendanceState, RoleCode } from "../src/generated/prisma/client.js";

const app = createApp();
let adminToken: string;
let teacherToken: string;
let adminId: string;
let teacherId: string;
let classId: string;
let otherClassId: string;
let students: Array<{ id: string; saintName: string; fullName: string }>;

async function cleanDatabase() {
  if (getEnv().DATABASE_NAME !== "appglv_unified_test") throw new Error("Attendance tests refuse to clear a database other than appglv_unified_test.");
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

const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const teacher = () => ({ Authorization: `Bearer ${teacherToken}` });

beforeEach(async () => {
  await cleanDatabase();
  const passwordHash = await hashPassword("Test@Attendance123!");
  const adminUser = await prisma.user.create({ data: { username: "attendance.admin", displayName: "Admin Test", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } });
  const teacherUser = await prisma.user.create({ data: { username: "attendance.teacher", displayName: "Teacher Test", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } });
  adminId = adminUser.id;
  teacherId = teacherUser.id;
  adminToken = signAccessToken({ sub: adminUser.id, av: adminUser.authVersion });
  teacherToken = signAccessToken({ sub: teacherUser.id, av: teacherUser.authVersion });
  const year = await prisma.academicYear.create({ data: { name: "2030–2031" } });
  const firstClass = await prisma.catechismClass.create({ data: { name: "Thêm Sức", academicYearId: year.id } });
  const secondClass = await prisma.catechismClass.create({ data: { name: "Bao Đồng", academicYearId: year.id } });
  classId = firstClass.id;
  otherClassId = secondClass.id;
  students = await Promise.all([
    prisma.student.create({ data: { saintName: "Maria", fullName: "Nguyễn Hoàng An" } }),
    prisma.student.create({ data: { saintName: "Giuse", fullName: "Trần Minh Khôi" } })
  ]);
  for (const student of students) {
    await prisma.enrollment.create({ data: { studentId: student.id, classId, academicYearId: year.id, currentKey: `${student.id}:${year.id}` } });
  }
  await prisma.teacherAssignment.create({ data: { teacherId, classId, currentKey: `${teacherId}:${classId}` } });
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

async function createSession(options: {
  classId?: string;
  status?: AttendanceSessionStatus;
  states?: AttendanceState[];
  window?: "open" | "past";
  occursAt?: Date;
}) {
  const occursAt = options.occursAt ?? new Date();
  const openWindow = options.window !== "past";
  const roster = options.classId && options.classId !== classId ? [] : students;
  return prisma.attendanceSession.create({
    data: {
      classId: options.classId ?? classId,
      activityType: ActivityType.CATECHISM_LESSON,
      occursAt,
      windowOpensAt: new Date(Date.now() - (openWindow ? 60 : 120) * 60_000),
      windowClosesAt: new Date(Date.now() + (openWindow ? 60 : -60) * 60_000),
      status: options.status ?? AttendanceSessionStatus.OPEN,
      records: {
        create: roster.map((student, index) => ({
          studentId: student.id,
          saintNameSnapshot: student.saintName,
          fullNameSnapshot: student.fullName,
          state: options.states?.[index] ?? AttendanceState.NOT_MARKED
        }))
      },
      events: { create: { type: "GENERATED", actorId: adminId } }
    },
    include: { records: true }
  });
}

describe("attendance management with MariaDB", () => {
  it("generates duplicate-resistant per-Class sessions with snapshot rosters", async () => {
    const day = "2030-01-08";
    const template = await request(app).post("/api/v1/admin/attendance/templates").set(admin()).send({
      classId,
      activityType: "CATECHISM_LESSON",
      weekday: new Date(`${day}T00:00:00Z`).getUTCDay(),
      occurrenceMinute: 600,
      utcOffsetMinutes: 420,
      windowOpenOffsetMinutes: -60,
      windowCloseOffsetMinutes: 60,
      effectiveStart: day,
      effectiveEnd: day
    });
    expect(template.status).toBe(201);
    const first = await request(app).post(`/api/v1/admin/attendance/templates/${template.body.data.id}/generate`).set(admin()).send({ fromDate: day, toDate: day });
    const replay = await request(app).post(`/api/v1/admin/attendance/templates/${template.body.data.id}/generate`).set(admin()).send({ fromDate: day, toDate: day });
    expect(first.body.data).toEqual({ created: 1, existing: 0 });
    expect(replay.body.data).toEqual({ created: 0, existing: 1 });
    const session = await prisma.attendanceSession.findFirstOrThrow({ include: { records: true } });
    expect(session.records).toHaveLength(2);
    expect(session.records.every((record) => record.state === AttendanceState.NOT_MARKED)).toBe(true);
  });

  it("applies cancel, move, and add exceptions only to future untouched sessions", async () => {
    const cancelSession = await createSession({ occursAt: new Date(Date.now() + 3_600_000) });
    const moveSession = await createSession({ occursAt: new Date(Date.now() + 7_200_000) });
    const cancel = await request(app).post("/api/v1/admin/attendance/exceptions").set(admin()).send({ type: "CANCEL", sessionId: cancelSession.id, note: "Giáo xứ nghỉ lễ" });
    const newOccursAt = new Date(Date.now() + 10_800_000);
    const move = await request(app).post("/api/v1/admin/attendance/exceptions").set(admin()).send({ type: "MOVE", sessionId: moveSession.id, occursAt: newOccursAt.toISOString(), windowOpensAt: new Date(newOccursAt.getTime() - 3_600_000).toISOString(), windowClosesAt: new Date(newOccursAt.getTime() + 3_600_000).toISOString() });
    const addOccursAt = new Date(Date.now() + 14_400_000);
    const add = await request(app).post("/api/v1/admin/attendance/exceptions").set(admin()).send({ type: "ADD", classId, activityType: "CATECHISM_LESSON", occursAt: addOccursAt.toISOString(), windowOpensAt: new Date(addOccursAt.getTime() - 3_600_000).toISOString(), windowClosesAt: new Date(addOccursAt.getTime() + 3_600_000).toISOString() });
    expect([cancel.status, move.status, add.status]).toEqual([201, 201, 201]);
    expect((await prisma.attendanceSession.findUniqueOrThrow({ where: { id: cancelSession.id } })).isCancelled).toBe(true);
    expect((await prisma.attendanceSession.findUniqueOrThrow({ where: { id: moveSession.id } })).occursAt.toISOString()).toBe(newOccursAt.toISOString());
    const addedSession = await prisma.attendanceSession.findUniqueOrThrow({
      where: { id: add.body.data.session.id },
      include: { records: true }
    });
    expect(addedSession.records.map((record) => record.studentId).sort()).toEqual(students.map((student) => student.id).sort());
    expect(addedSession.records.every((record) => record.state === AttendanceState.NOT_MARKED)).toBe(true);
    expect(await prisma.scheduleException.count()).toBe(3);
    await prisma.attendanceSession.update({ where: { id: moveSession.id }, data: { hasUserMutation: true } });
    expect((await request(app).post("/api/v1/admin/attendance/exceptions").set(admin()).send({ type: "CANCEL", sessionId: moveSession.id })).status).toBe(409);
  });

  it("saves scoped attendance idempotently and rejects stale, foreign, and expired writes", async () => {
    const session = await createSession({});
    const payload = { requestId: "save-request-1", revision: 0, records: [{ studentId: students[0].id, state: "PRESENT" }] };
    const saved = await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/save`).set(teacher()).send(payload);
    const replay = await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/save`).set(teacher()).send(payload);
    expect(saved.status).toBe(200);
    expect(saved.body.data.counts).toMatchObject({ present: 1, notMarked: 1 });
    expect(replay.body.data.revision).toBe(1);
    expect(await prisma.attendanceEvent.count({ where: { requestId: payload.requestId } })).toBe(1);
    const changedReplay = await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/save`).set(teacher()).send({
      ...payload,
      records: [{ studentId: students[0].id, state: "ABSENT" }]
    });
    expect(changedReplay.body.error.code).toBe("REQUEST_ID_REUSED");
    expect((await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/save`).set(teacher()).send({ ...payload, requestId: "save-request-2" })).status).toBe(409);
    const outsider = await prisma.student.create({ data: { saintName: "Phêrô", fullName: "Ngoài Roster" } });
    expect((await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/save`).set(teacher()).send({ requestId: "save-request-3", revision: 1, records: [{ studentId: outsider.id, state: "ABSENT" }] })).status).toBe(409);
    const expired = await createSession({ window: "past", occursAt: new Date(Date.now() + 20_000) });
    expect((await request(app).post(`/api/v1/teacher/attendance/sessions/${expired.id}/save`).set(teacher()).send({ requestId: "save-request-4", revision: 0, records: [{ studentId: students[0].id, state: "PRESENT" }] })).status).toBe(409);
  });

  it("submits only a fully marked Open session and replays one logical transition", async () => {
    const pending = await createSession({});
    expect((await request(app).post(`/api/v1/teacher/attendance/sessions/${pending.id}/submit`).set(teacher()).send({ requestId: "submit-pending", revision: 0 })).body.error.code).toBe("ATTENDANCE_SUBMIT_POLICY_PENDING");
    const session = await createSession({});
    const save = await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/save`).set(teacher()).send({ requestId: "submit-save", revision: 0, records: students.map((student, index) => ({ studentId: student.id, state: index ? "ABSENT" : "PRESENT" })) });
    const payload = { requestId: "submit-request", revision: save.body.data.revision };
    const submitted = await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/submit`).set(teacher()).send(payload);
    const replay = await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/submit`).set(teacher()).send(payload);
    const wrongOperation = await request(app).post(`/api/v1/teacher/attendance/sessions/${session.id}/submit`).set(teacher()).send({ requestId: "submit-save", revision: save.body.data.revision });
    expect(submitted.body.data.status).toBe("SUBMITTED");
    expect(replay.body.data.status).toBe("SUBMITTED");
    expect(wrongOperation.body.error.code).toBe("REQUEST_ID_REUSED");
    expect(await prisma.attendanceEvent.count({ where: { type: "SUBMITTED", sessionId: session.id } })).toBe(1);
  });

  it("allows Admin save and submit outside the Teacher window while preserving lifecycle guards", async () => {
    const session = await createSession({ window: "past" });
    const saved = await request(app).post(`/api/v1/admin/attendance/sessions/${session.id}/save`).set(admin()).send({
      requestId: "admin-save-request",
      revision: 0,
      records: students.map((student) => ({ studentId: student.id, state: "PRESENT" }))
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.revision).toBe(1);

    const submitted = await request(app).post(`/api/v1/admin/attendance/sessions/${session.id}/submit`).set(admin()).send({
      requestId: "admin-submit-request",
      revision: 1
    });
    expect(submitted.body.data.status).toBe("SUBMITTED");
    const secondSubmit = await request(app).post(`/api/v1/admin/attendance/sessions/${session.id}/submit`).set(admin()).send({
      requestId: "admin-submit-other",
      revision: 2
    });
    expect(secondSubmit.status).toBe(409);
    expect(await prisma.attendanceEvent.count({ where: { sessionId: session.id, type: "SUBMITTED" } })).toBe(1);
  });

  it("updates only the active schedule revision and rejects overlapping templates", async () => {
    const payload = {
      classId,
      activityType: "CATECHISM_LESSON",
      weekday: 2,
      occurrenceMinute: 600,
      utcOffsetMinutes: 420,
      windowOpenOffsetMinutes: -60,
      windowCloseOffsetMinutes: 60,
      effectiveStart: "2030-01-01",
      effectiveEnd: "2030-06-30"
    };
    const created = await request(app).post("/api/v1/admin/attendance/templates").set(admin()).send(payload);
    const updatedPayload = { ...payload, classId: undefined, revision: 0, effectiveEnd: "2030-07-31" };
    const updated = await request(app).patch(`/api/v1/admin/attendance/templates/${created.body.data.id}`).set(admin()).send(updatedPayload);
    expect(updated.status).toBe(200);
    expect(updated.body.data.revision).toBe(1);
    expect((await request(app).patch(`/api/v1/admin/attendance/templates/${created.body.data.id}`).set(admin()).send(updatedPayload)).body.error.code).toBe("STALE_REVISION");

    const overlap = await request(app).post("/api/v1/admin/attendance/templates").set(admin()).send({
      ...payload,
      effectiveStart: "2030-07-01",
      effectiveEnd: "2030-12-31"
    });
    expect(overlap.body.error.code).toBe("SCHEDULE_DUPLICATE");

    const deactivated = await request(app).post(`/api/v1/admin/attendance/templates/${created.body.data.id}/deactivate`).set(admin()).send({ revision: 1 });
    expect(deactivated.status).toBe(200);
    const inactiveUpdate = await request(app).patch(`/api/v1/admin/attendance/templates/${created.body.data.id}`).set(admin()).send({ ...updatedPayload, revision: 2 });
    expect(inactiveUpdate.body.error.code).toBe("STALE_REVISION");

    const second = await request(app).post("/api/v1/admin/attendance/templates").set(admin()).send({
      ...payload,
      effectiveStart: "2031-01-01",
      effectiveEnd: "2031-06-30"
    });
    const duplicatePatch = await request(app).patch(`/api/v1/admin/attendance/templates/${second.body.data.id}`).set(admin()).send({
      ...updatedPayload,
      revision: 0
    });
    expect(duplicatePatch.body.error.code).toBe("SCHEDULE_DUPLICATE");
  });

  it("rejects invalid dates, offset-less instants, past exceptions, and oversized generation ranges", async () => {
    const invalidTemplate = await request(app).post("/api/v1/admin/attendance/templates").set(admin()).send({
      classId,
      activityType: "CATECHISM_LESSON",
      weekday: 2,
      occurrenceMinute: 600,
      utcOffsetMinutes: 420,
      windowOpenOffsetMinutes: -60,
      windowCloseOffsetMinutes: 60,
      effectiveStart: "2030-02-30",
      effectiveEnd: "2030-03-01"
    });
    expect(invalidTemplate.status).toBe(422);

    const offsetless = await request(app).post("/api/v1/admin/attendance/exceptions").set(admin()).send({
      type: "ADD",
      classId,
      activityType: "CATECHISM_LESSON",
      occursAt: "2030-03-01T10:00:00",
      windowOpensAt: "2030-03-01T09:00:00",
      windowClosesAt: "2030-03-01T11:00:00"
    });
    expect(offsetless.status).toBe(422);

    const past = new Date(Date.now() - 3_600_000).toISOString();
    const pastAdd = await request(app).post("/api/v1/admin/attendance/exceptions").set(admin()).send({
      type: "ADD",
      classId,
      activityType: "CATECHISM_LESSON",
      occursAt: past,
      windowOpensAt: new Date(Date.now() - 7_200_000).toISOString(),
      windowClosesAt: new Date(Date.now() - 1_800_000).toISOString()
    });
    expect(pastAdd.status).toBe(422);

    const template = await prisma.scheduleTemplate.create({
      data: {
        classId,
        createdById: adminId,
        activityType: ActivityType.CATECHISM_LESSON,
        weekday: 2,
        occurrenceMinute: 600,
        utcOffsetMinutes: 420,
        windowOpenOffsetMinutes: -60,
        windowCloseOffsetMinutes: 60,
        effectiveStart: new Date("2030-01-01T00:00:00Z"),
        effectiveEnd: new Date("2032-01-01T00:00:00Z")
      }
    });
    const oversized = await request(app).post(`/api/v1/admin/attendance/templates/${template.id}/generate`).set(admin()).send({ fromDate: "2030-01-01", toDate: "2032-01-01" });
    expect(oversized.status).toBe(422);
  });

  it("allows only Admin finalization and reasoned correction with immutable audit", async () => {
    const session = await createSession({ status: AttendanceSessionStatus.SUBMITTED, states: [AttendanceState.PRESENT, AttendanceState.ABSENT] });
    expect((await request(app).post(`/api/v1/admin/attendance/sessions/${session.id}/finalize`).set(teacher()).send({ requestId: "finalize-denied", revision: 0 })).status).toBe(403);
    const finalized = await request(app).post(`/api/v1/admin/attendance/sessions/${session.id}/finalize`).set(admin()).send({ requestId: "finalize-request", revision: 0 });
    expect(finalized.body.data.status).toBe("FINALIZED");
    const recordId = session.records[0].id;
    expect((await request(app).post(`/api/v1/admin/attendance/records/${recordId}/correct`).set(admin()).send({ requestId: "correct-invalid", state: "ABSENT", reason: "" })).status).toBe(422);
    const corrected = await request(app).post(`/api/v1/admin/attendance/records/${recordId}/correct`).set(admin()).send({ requestId: "correct-request", state: "ABSENT", reason: "Gia đình báo lại sau Thánh lễ" });
    expect(corrected.body.data.state).toBe("ABSENT");
    const audit = await prisma.attendanceAuditEntry.findUniqueOrThrow({ where: { requestId: "correct-request" } });
    const changedReplay = await request(app).post(`/api/v1/admin/attendance/records/${recordId}/correct`).set(admin()).send({ requestId: "correct-request", state: "PRESENT", reason: "Nội dung khác" });
    expect(changedReplay.status).toBe(409);
    expect(changedReplay.body.error.code).toBe("REQUEST_ID_REUSED");
    const changedReasonOnly = await request(app).post(`/api/v1/admin/attendance/records/${recordId}/correct`).set(admin()).send({ requestId: "correct-request", state: "ABSENT", reason: "Lý do khác" });
    expect(changedReasonOnly.status).toBe(409);
    expect(changedReasonOnly.body.error.code).toBe("REQUEST_ID_REUSED");
    expect(audit).toMatchObject({ beforeState: AttendanceState.PRESENT, afterState: AttendanceState.ABSENT, actorId: adminId });
    expect((await prisma.attendanceSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe(AttendanceSessionStatus.FINALIZED);
    const teacherView = await request(app).get(`/api/v1/teacher/attendance/sessions/${session.id}`).set(teacher());
    expect(teacherView.body.data.auditEntries).toBeUndefined();
    expect(teacherView.body.data.events.find((event: { type: string }) => event.type === "CORRECTED").details).toBeUndefined();
  });

  it("bounds history and absence reads to the Teacher's current assignment", async () => {
    const assigned = await createSession({ states: [AttendanceState.ABSENT, AttendanceState.PRESENT] });
    await createSession({ classId: otherClassId, occursAt: new Date(Date.now() + 86_400_000) });
    const sessions = await request(app).get("/api/v1/teacher/attendance/history?limit=10").set(teacher());
    const absences = await request(app).get("/api/v1/teacher/attendance/absences?limit=10").set(teacher());
    expect(sessions.body.data.items.map((item: { id: string }) => item.id)).toEqual([assigned.id]);
    expect(absences.body.data.items).toHaveLength(1);
    await prisma.teacherAssignment.update({ where: { currentKey: `${teacherId}:${classId}` }, data: { currentKey: null, endedAt: new Date() } });
    expect((await request(app).get(`/api/v1/teacher/attendance/sessions/${assigned.id}`).set(teacher())).status).toBe(403);
    expect((await request(app).get("/api/v1/teacher/attendance/history?limit=10").set(teacher())).body.data.total).toBe(0);
  });
});


