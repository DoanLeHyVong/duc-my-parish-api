import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getEnv } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import {
  ActivityType,
  AttendanceSessionStatus,
  AttendanceState,
  ClassificationRuleStatus,
  GradeRoundingMethod,
  RoleCode
} from "../src/generated/prisma/client.js";

const app = createApp();
let adminToken: string;
let teacherToken: string;
let outsiderToken: string;
let adminId: string;
let teacherId: string;
let yearId: string;
let semesterId: string;
let classId: string;
let otherClassId: string;
let studentId: string;

async function cleanDatabase() {
  if (getEnv().DATABASE_NAME !== "appglv_unified_test") throw new Error("Report tests refuse to clear a database other than appglv_unified_test.");
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
  const passwordHash = await hashPassword("Test@Reports123!");
  const [admin, teacher, outsider] = await Promise.all([
    prisma.user.create({ data: { username: "reports.admin", displayName: "Admin", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } }),
    prisma.user.create({ data: { username: "reports.teacher", displayName: "Teacher", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } }),
    prisma.user.create({ data: { username: "reports.outsider", displayName: "Outsider", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } })
  ]);
  adminId = admin.id;
  teacherId = teacher.id;
  adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
  outsiderToken = signAccessToken({ sub: outsider.id, av: outsider.authVersion });
  const year = await prisma.academicYear.create({ data: { name: "2035–2036" } });
  yearId = year.id;
  semesterId = (await prisma.semester.create({ data: { academicYearId: year.id, name: "Học kỳ 1" } })).id;
  classId = (await prisma.catechismClass.create({ data: { academicYearId: year.id, name: "Thêm Sức" } })).id;
  otherClassId = (await prisma.catechismClass.create({ data: { academicYearId: year.id, name: "Bao Đồng" } })).id;
  studentId = (await prisma.student.create({ data: { saintName: "Maria", fullName: "Nguyễn Hoàng An" } })).id;
  await prisma.enrollment.create({ data: { studentId, classId, academicYearId: year.id, currentKey: `${studentId}:${year.id}` } });
  await prisma.teacherAssignment.create({ data: { teacherId, classId, currentKey: `${teacherId}:${classId}` } });
});

afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); });

const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const teacher = () => ({ Authorization: `Bearer ${teacherToken}` });

async function createSession(status: AttendanceSessionStatus, states: AttendanceState[], targetClass = classId, activityType: ActivityType = ActivityType.CATECHISM_LESSON, occursAt = new Date(Date.now() + Math.random() * 10_000_000)) {
  return prisma.attendanceSession.create({ data: {
    classId: targetClass,
    activityType,
    occursAt,
    windowOpensAt: new Date(Date.now() - 3_600_000),
    windowClosesAt: new Date(Date.now() + 3_600_000),
    status,
    records: targetClass === classId ? { create: states.map((state) => ({ studentId, saintNameSnapshot: "Maria", fullNameSnapshot: "Nguyễn Hoàng An", state })) } : undefined
  } });
}

describe("dashboards and reports with MariaDB", () => {
  it("returns approved Admin totals and keeps NOT_MARKED outside the marked percentage", async () => {
    await createSession(AttendanceSessionStatus.OPEN, [AttendanceState.PRESENT]);
    await createSession(AttendanceSessionStatus.SUBMITTED, [AttendanceState.ABSENT], classId, ActivityType.TUESDAY_MASS);
    await createSession(AttendanceSessionStatus.FINALIZED, [AttendanceState.NOT_MARKED], classId, ActivityType.SUNDAY_MASS);
    const response = await request(app).get(`/api/v1/admin/reports/dashboard?academicYearId=${yearId}`).set(admin());
    expect(response.status).toBe(200);
    expect(response.body.data.totals).toEqual({ students: 1, classes: 2, teachers: 2 });
    expect(response.body.data.attendance.lifecycle).toEqual({ open: 1, submitted: 1, finalized: 1 });
    expect(response.body.data.attendance.marks).toEqual({ present: 1, absent: 1, notMarked: 1 });
    expect(response.body.data.attendance.markedPercentage).toBe(0.5);
    expect(response.body.data.attendance.percentageBasis).toBe("MARKED_RECORDS_ONLY");
  });

  it("scopes Teacher dashboards and reports to current assignments and exposes no classification route", async () => {
    await createSession(AttendanceSessionStatus.OPEN, [AttendanceState.ABSENT]);
    await createSession(AttendanceSessionStatus.OPEN, [], otherClassId);
    const dashboard = await request(app).get(`/api/v1/teacher/reports/dashboard?academicYearId=${yearId}`).set(teacher());
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.classes).toHaveLength(1);
    expect(dashboard.body.data.classes[0].id).toBe(classId);
    expect(dashboard.body.data.attendance.marks.absent).toBe(1);
    expect((await request(app).get(`/api/v1/teacher/reports/attendance?classId=${otherClassId}`).set(teacher())).status).toBe(403);
    expect((await request(app).get(`/api/v1/teacher/reports/dashboard`).set({ Authorization: `Bearer ${outsiderToken}` })).body.data.classes).toHaveLength(0);
    expect((await request(app).get(`/api/v1/teacher/reports/classifications?academicYearId=${yearId}`).set(teacher())).status).toBe(404);
  });

  it("filters attendance, paginates absences, and distinguishes incomplete lifecycle/NOT_MARKED sessions", async () => {
    const first = await createSession(AttendanceSessionStatus.FINALIZED, [AttendanceState.ABSENT], classId, ActivityType.TUESDAY_MASS, new Date("2035-01-01T10:00:00.000Z"));
    const second = await createSession(AttendanceSessionStatus.FINALIZED, [AttendanceState.ABSENT], classId, ActivityType.TUESDAY_MASS, new Date("2035-01-02T10:00:00.000Z"));
    await createSession(AttendanceSessionStatus.FINALIZED, [AttendanceState.ABSENT], classId, ActivityType.TUESDAY_MASS, new Date("2035-01-03T10:00:00.000Z"));
    const openOne = await createSession(AttendanceSessionStatus.OPEN, [AttendanceState.NOT_MARKED], classId, ActivityType.SUNDAY_MASS, new Date("2035-01-04T10:00:00.000Z"));
    const openTwo = await createSession(AttendanceSessionStatus.OPEN, [AttendanceState.PRESENT], classId, ActivityType.SUNDAY_MASS, new Date("2035-01-05T10:00:00.000Z"));
    const report = await request(app).get(`/api/v1/admin/reports/attendance?academicYearId=${yearId}&activityType=TUESDAY_MASS&from=2035-01-02T00:00:00.000Z&to=2035-01-02T23:59:59.999Z`).set(admin());
    expect(report.body.data.byActivity).toHaveLength(1);
    expect(report.body.data.byActivity[0].absent).toBe(1);
    expect((await request(app).get(`/api/v1/admin/reports/attendance?from=2035-01-03T00:00:00.000Z&to=2035-01-01T00:00:00.000Z`).set(admin())).status).toBe(422);
    const absencesOne = await request(app).get(`/api/v1/admin/reports/absences?academicYearId=${yearId}&page=1&limit=1`).set(admin());
    const absencesTwo = await request(app).get(`/api/v1/admin/reports/absences?academicYearId=${yearId}&page=2&limit=1`).set(admin());
    expect(absencesOne.body.data).toMatchObject({ total: 3, page: 1, limit: 1 });
    expect(absencesOne.body.data.items[0].sessionId).not.toBe(absencesTwo.body.data.items[0].sessionId);
    expect([first.id, second.id]).not.toContain(absencesOne.body.data.items[0].sessionId);
    const incompleteOne = await request(app).get(`/api/v1/admin/reports/incomplete-sessions?academicYearId=${yearId}&page=1&limit=1`).set(admin());
    const incompleteTwo = await request(app).get(`/api/v1/admin/reports/incomplete-sessions?academicYearId=${yearId}&page=2&limit=1`).set(admin());
    expect(incompleteOne.body.data.total).toBe(2);
    expect(incompleteOne.body.data.items[0].id).toBe(openTwo.id);
    expect(incompleteTwo.body.data.items[0].id).toBe(openOne.id);
  });

  it("uses only the latest persisted classification revision and returns bounded rule-version history", async () => {
    const column = await prisma.gradeColumn.create({ data: { classId, semesterId, name: "Kiểm tra", minimum: 0, maximum: 10, precision: 1 } });
    const rule = await prisma.classificationRuleVersion.create({ data: {
      classId, semesterId, version: 1, status: ClassificationRuleStatus.PUBLISHED,
      decimalPlaces: 1, roundingMethod: GradeRoundingMethod.HALF_UP, publishedAt: new Date(), publishedById: adminId,
      weights: { create: { gradeColumnId: column.id, weight: 1 } },
      bands: { create: [{ minimumInclusive: 0, label: "Đạt" }, { minimumInclusive: 8, label: "Giỏi" }] }
    } });
    for (const revision of [1, 2]) await prisma.classificationResult.create({ data: {
      studentId, classId, semesterId, ruleVersionId: rule.id, resultRevision: revision,
      weightedAverage: revision === 1 ? 7 : 9, roundedAverage: revision === 1 ? 7 : 9,
      classificationLabel: revision === 1 ? "Đạt" : "Giỏi", inputSnapshot: {},
      inputFingerprint: `${revision}`.padEnd(64, "0"), requestId: `reports-result-${revision}`, actorId: adminId
    } });
    const report = await request(app).get(`/api/v1/admin/reports/classifications?academicYearId=${yearId}&page=1&limit=20`).set(admin());
    expect(report.body.data.total).toBe(1);
    expect(report.body.data.items[0]).toMatchObject({ resultRevision: 2, classificationLabel: "Giỏi" });
    const history = await request(app).get(`/api/v1/admin/reports/classifications/history?studentId=${studentId}&classId=${classId}&semesterId=${semesterId}&page=1&limit=1`).set(admin());
    expect(history.body.data).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(history.body.data.items[0].ruleVersion.version).toBe(1);
  });
});


