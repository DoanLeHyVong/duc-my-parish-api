import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RoleCode } from "../src/generated/prisma/client.js";
import { createApp } from "../src/app.js";
import { getEnv } from "../src/config/env.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();
let adminToken: string;
let teacherToken: string;
let classId: string;
let semesterId: string;
let studentId: string;

async function cleanDatabase() {
  if (getEnv().DATABASE_NAME !== "appglv_unified_test") throw new Error("Grade tests refuse to clear a database other than appglv_unified_test.");
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
  const passwordHash = await hashPassword("Test@Grades123!");
  const admin = await prisma.user.create({ data: { username: "grades.admin", displayName: "Admin Grades", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } });
  const teacher = await prisma.user.create({ data: { username: "grades.teacher", displayName: "Teacher Grades", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } });
  adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
  const year = await prisma.academicYear.create({ data: { name: "2026-2027" } });
  semesterId = (await prisma.semester.create({ data: { name: "Học kỳ I", academicYearId: year.id } })).id;
  classId = (await prisma.catechismClass.create({ data: { name: "Thêm Sức", academicYearId: year.id } })).id;
  studentId = (await prisma.student.create({ data: { saintName: "Maria", fullName: "Nguyễn Hoàng An" } })).id;
  await prisma.enrollment.create({ data: { studentId, classId, academicYearId: year.id, currentKey: `${studentId}:${year.id}` } });
});

afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); });
const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const teacher = () => ({ Authorization: `Bearer ${teacherToken}` });

async function column(name: string) {
  const result = await request(app).post("/api/v1/admin/grades/columns").set(admin()).send({ classId, semesterId, name, minimum: "0", maximum: "10", precision: 1 });
  expect(result.status).toBe(201);
  return result.body.data;
}

async function saveGrade(gradeColumnId: string, value: string, requestId: string, revision: number | null = null) {
  return request(app).post("/api/v1/admin/grades/grades").set(admin()).send({ studentId, classId, semesterId, gradeColumnId, value, revision, requestId });
}

async function rule(columns: string[], bands = [{ minimumInclusive: "0", label: "Chưa đạt" }, { minimumInclusive: "5", label: "Đạt" }, { minimumInclusive: "8", label: "Tốt" }], roundingMethod = "HALF_UP", decimalPlaces = 1) {
  const result = await request(app).post("/api/v1/admin/grades/rules").set(admin()).send({ classId, semesterId, decimalPlaces, roundingMethod, weights: columns.map((gradeColumnId) => ({ gradeColumnId, weight: "1" })), bands });
  expect(result.status).toBe(201);
  return result.body.data;
}

describe("grades and classification with MariaDB", () => {
  it("denies every Teacher route and requires explicit configured scope", async () => {
    expect((await request(app).get(`/api/v1/admin/grades/sheet?classId=${classId}&semesterId=${semesterId}`).set(teacher())).status).toBe(403);
    expect((await request(app).post("/api/v1/admin/grades/columns").set(teacher()).send({})).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/grades/results?classId=${classId}`).set(teacher())).status).toBe(403);
    const calculation = await request(app).post("/api/v1/admin/grades/calculate").set(admin()).send({ studentId, classId, semesterId, requestId: "missing-policy-001" });
    expect(calculation.status).toBe(200);
    expect(calculation.body.data).toMatchObject({ status: "NOT_CALCULATED", reasons: [{ code: "MISSING_PUBLISHED_RULE" }] });
    expect(await prisma.classificationResult.count()).toBe(0);
  });

  it("audits one replay-safe optimistic grade revision with before and after values", async () => {
    const item = await column("Bài kiểm tra");
    const duplicate = await request(app).post("/api/v1/admin/grades/columns").set(admin()).send({ classId, semesterId, name: "Bài kiểm tra", minimum: "0", maximum: "10", precision: 1 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_GRADE_COLUMN");
    const body = { studentId, classId, semesterId, gradeColumnId: item.id, value: "7.5", revision: null, requestId: "grade-create-001" };
    const created = await request(app).post("/api/v1/admin/grades/grades").set(admin()).send(body);
    expect(created.status).toBe(200);
    expect((await request(app).post("/api/v1/admin/grades/grades").set(admin()).send(body)).body.data.id).toBe(created.body.data.id);
    const changed = await saveGrade(item.id, "8.0", "grade-update-001", 0);
    expect(changed.status).toBe(200);
    expect(changed.body.data.revision).toBe(1);
    const stale = await saveGrade(item.id, "9.0", "grade-stale-001", 0);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_GRADE");
    const invalid = await saveGrade(item.id, "10.5", "grade-invalid-001", 1);
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("GRADE_OUT_OF_RANGE");
    const audits = await prisma.gradeAuditEntry.findMany({ orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(2);
    expect(audits[0].beforeValue).toBeNull();
    expect(audits[1].beforeValue!.toString()).toBe("7.5");
    expect(audits[1].afterValue.toString()).toBe("8");
    const history = await request(app).get(`/api/v1/admin/grades/audit?classId=${classId}&semesterId=${semesterId}`).set(admin());
    expect(history.status).toBe(200);
    expect(history.body.data.items).toHaveLength(2);
  });

  it("validates DECIMAL(18,6), active enrollment, and committed replay before open scope", async () => {
    for (const minimum of ["1e2", "1234567890123", "1.1234567"]) {
      const invalid = await request(app).post("/api/v1/admin/grades/columns").set(admin()).send({ classId, semesterId, name: `Invalid ${minimum}`, minimum, maximum: "10", precision: 1 });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    }
    const item = await column("Replay");
    const body = { studentId, classId, semesterId, gradeColumnId: item.id, value: "7.0", revision: null, requestId: "grade-replay-closed-001" };
    expect((await request(app).post("/api/v1/admin/grades/grades").set(admin()).send(body)).status).toBe(200);
    await prisma.semester.update({ where: { id: semesterId }, data: { status: "CLOSED", closedAt: new Date() } });
    expect((await request(app).post("/api/v1/admin/grades/grades").set(admin()).send(body)).status).toBe(200);
    await prisma.semester.update({ where: { id: semesterId }, data: { status: "OPEN", closedAt: null } });
    await prisma.enrollment.updateMany({ where: { studentId, classId, endedAt: null }, data: { endedAt: new Date(), currentKey: null } });
    const sheet = await request(app).get(`/api/v1/admin/grades/sheet?classId=${classId}&semesterId=${semesterId}`).set(admin());
    expect(sheet.body.data.students).toHaveLength(0);
    expect(sheet.body.data.grades).toHaveLength(0);
    expect((await saveGrade(item.id, "8.0", "ended-grade-001", 0)).body.error.code).toBe("STUDENT_NOT_ENROLLED");
    expect((await request(app).post("/api/v1/admin/grades/calculate").set(admin()).send({ studentId, classId, semesterId, requestId: "ended-calc-001" })).body.error.code).toBe("STUDENT_NOT_ENROLLED");
  });

  it("guards Grade Column PATCH for stale, duplicate, and Draft rule usage", async () => {
    const first = await column("First");
    const second = await column("Second");
    const changed = await request(app).patch(`/api/v1/admin/grades/columns/${first.id}`).set(admin()).send({ revision: 0, name: "Renamed", minimum: "0", maximum: "20", precision: 2 });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ name: "Renamed", revision: 1 });
    const stale = await request(app).patch(`/api/v1/admin/grades/columns/${first.id}`).set(admin()).send({ revision: 0, name: "Stale", minimum: "0", maximum: "20", precision: 2 });
    expect(stale.body.error.code).toBe("STALE_GRADE_COLUMN");
    const duplicate = await request(app).patch(`/api/v1/admin/grades/columns/${first.id}`).set(admin()).send({ revision: 1, name: second.name, minimum: "0", maximum: "20", precision: 2 });
    expect(duplicate.body.error.code).toBe("DUPLICATE_GRADE_COLUMN");
    await rule([first.id], [{ minimumInclusive: "0", label: "Any" }]);
    const inUse = await request(app).patch(`/api/v1/admin/grades/columns/${first.id}`).set(admin()).send({ revision: 1, name: "Blocked", minimum: "0", maximum: "20", precision: 2 });
    expect(inUse.body.error.code).toBe("GRADE_COLUMN_IN_USE");
  });

  it("applies each configured rounding method distinctly", async () => {
    const item = await column("Rounding");
    await saveGrade(item.id, "2.5", "rounding-grade-001");
    const expected: Record<string, string> = { HALF_UP: "3", HALF_EVEN: "2", DOWN: "2", UP: "3" };
    for (const [method, roundedAverage] of Object.entries(expected)) {
      const draft = await rule([item.id], [{ minimumInclusive: "0", label: method }], method, 0);
      await request(app).post(`/api/v1/admin/grades/rules/${draft.id}/publish`).set(admin()).send({ revision: 0 });
      const calculated = await request(app).post("/api/v1/admin/grades/calculate").set(admin()).send({ studentId, classId, semesterId, requestId: `round-${method.toLowerCase()}-001` });
      expect(calculated.body.data.result.roundedAverage).toBe(roundedAverage);
    }
  });

  it("validates threshold coverage against rounded reachable limits", async () => {
    const created = await request(app).post("/api/v1/admin/grades/columns").set(admin()).send({ classId, semesterId, name: "Rounded range", minimum: "0.04", maximum: "9.96", precision: 2 });
    expect(created.status).toBe(201);
    const draft = await rule([created.body.data.id], [{ minimumInclusive: "0", label: "Low" }, { minimumInclusive: "10", label: "Top" }], "HALF_UP", 1);
    expect(draft.status).toBe("DRAFT");
  });

  it("publishes immutable versions, reports every missing grade, and appends explainable recalculations", async () => {
    const oral = await column("Vấn đáp");
    const written = await column("Bài viết");
    const firstRule = await rule([oral.id, written.id]);
    const published = await request(app).post(`/api/v1/admin/grades/rules/${firstRule.id}/publish`).set(admin()).send({ revision: 0 });
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("PUBLISHED");
    const missing = await request(app).post("/api/v1/admin/grades/calculate").set(admin()).send({ studentId, classId, semesterId, requestId: "calc-missing-001" });
    expect(missing.body.data.reasons.map((item: { gradeColumnId: string }) => item.gradeColumnId)).toEqual(expect.arrayContaining([oral.id, written.id]));
    expect(await prisma.classificationResult.count()).toBe(0);
    await saveGrade(oral.id, "8.0", "grade-oral-001");
    await saveGrade(written.id, "9.0", "grade-written-001");
    const calculated = await request(app).post("/api/v1/admin/grades/calculate").set(admin()).send({ studentId, classId, semesterId, requestId: "calc-first-001" });
    expect(calculated.status).toBe(201);
    expect(calculated.body.data.result).toMatchObject({ ruleVersionId: firstRule.id, roundedAverage: "8.5", classificationLabel: "Tốt", resultRevision: 1 });
    expect(calculated.body.data.result.inputSnapshot).toHaveLength(2);
    const replay = await request(app).post("/api/v1/admin/grades/calculate").set(admin()).send({ studentId, classId, semesterId, requestId: "calc-first-001" });
    expect(replay.status).toBe(200);
    expect(replay.body.data.result.id).toBe(calculated.body.data.result.id);
    const otherStudent = await prisma.student.create({ data: { saintName: "Giuse", fullName: "Other Student" } });
    const targetClass = await prisma.catechismClass.findUniqueOrThrow({ where: { id: classId } });
    await prisma.enrollment.create({ data: { studentId: otherStudent.id, classId, academicYearId: targetClass.academicYearId, currentKey: `${otherStudent.id}:${targetClass.academicYearId}` } });
    const reused = await request(app).post("/api/v1/admin/grades/calculate").set(admin()).send({ studentId: otherStudent.id, classId, semesterId, requestId: "calc-first-001" });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const secondRule = await rule([oral.id, written.id], [{ minimumInclusive: "0", label: "Cần cố gắng" }, { minimumInclusive: "8", label: "Hoàn thành" }]);
    await request(app).post(`/api/v1/admin/grades/rules/${secondRule.id}/publish`).set(admin()).send({ revision: 0 });
    const recalculated = await request(app).post("/api/v1/admin/grades/calculate").set(admin()).send({ studentId, classId, semesterId, requestId: "calc-second-001" });
    expect(recalculated.body.data.result).toMatchObject({ ruleVersionId: secondRule.id, classificationLabel: "Hoàn thành", resultRevision: 2 });
    const tiedAt = new Date("2026-11-04T00:00:00.000Z");
    await prisma.classificationResult.updateMany({ where: { studentId }, data: { createdAt: tiedAt } });
    const history = await request(app).get(`/api/v1/admin/grades/results?classId=${classId}&semesterId=${semesterId}`).set(admin());
    expect(history.body.data.items).toHaveLength(2);
    expect(history.body.data.items.map((item: { resultRevision: number }) => item.resultRevision)).toEqual([2, 1]);
    expect(new Set(history.body.data.items.map((item: { ruleVersionId: string }) => item.ruleVersionId))).toEqual(new Set([firstRule.id, secondRule.id]));
    expect((await prisma.classificationRuleVersion.findUniqueOrThrow({ where: { id: firstRule.id } })).status).toBe("PUBLISHED");
  });
});


