import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getEnv } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { RoleCode } from "../src/generated/prisma/client.js";

const app = createApp();
let adminToken: string;
let teacherToken: string;
let teacherId: string;

async function cleanDatabase() {
  if (getEnv().DATABASE_NAME !== "appglv_unified_test") throw new Error("Academic tests refuse to clear a database other than appglv_unified_test.");
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
  const passwordHash = await hashPassword("Test@Academic123!");
  const admin = await prisma.user.create({ data: { username: "academic.admin", displayName: "Admin Test", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } });
  const teacher = await prisma.user.create({ data: { username: "academic.teacher", displayName: "Teacher Test", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } });
  teacherId = teacher.id;
  adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const teacher = () => ({ Authorization: `Bearer ${teacherToken}` });

async function createStructure() {
  const year = await prisma.academicYear.create({ data: { name: "2026–2027" } });
  const source = await prisma.catechismClass.create({ data: { name: "Thêm Sức", academicYearId: year.id } });
  const destination = await prisma.catechismClass.create({ data: { name: "Bao Đồng", academicYearId: year.id } });
  return { year, source, destination };
}

describe("academic management with MariaDB", () => {
  it("enforces academic router authentication and roles", async () => {
    expect((await request(app).get("/api/v1/admin/academics/students")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/academics/students").set(teacher())).status).toBe(403);
    expect((await request(app).get("/api/v1/teacher/classes").set(admin())).status).toBe(200);
  });

  it("creates unique structure and rejects duplicate labels", async () => {
    const year = await request(app).post("/api/v1/admin/academics/academic-years").set(admin()).send({ name: "2026–2027" });
    expect(year.status).toBe(201);
    const yearId = year.body.data.id as string;
    expect((await request(app).post("/api/v1/admin/academics/academic-years").set(admin()).send({ name: "2026–2027" })).status).toBe(409);
    expect((await request(app).post(`/api/v1/admin/academics/academic-years/${yearId}/semesters`).set(admin()).send({ name: "Học kỳ 1" })).status).toBe(201);
    const firstClass = await request(app).post("/api/v1/admin/academics/classes").set(admin()).send({ name: "Thêm Sức", academicYearId: yearId });
    expect(firstClass.status).toBe(201);
    expect((await request(app).post("/api/v1/admin/academics/classes").set(admin()).send({ name: "Thêm Sức", academicYearId: yearId })).status).toBe(409);
    const edited = await request(app).patch(`/api/v1/admin/academics/classes/${firstClass.body.data.id}`).set(admin()).send({ name: "Thêm Sức A" });
    expect(edited.body.data).toMatchObject({ id: firstClass.body.data.id, academicYearId: yearId, name: "Thêm Sức A" });
  });

  it("keeps same-name Students distinct by generated ID", async () => {
    const payload = { saintName: "Maria", fullName: "Nguyễn Hoàng An" };
    const first = await request(app).post("/api/v1/admin/academics/students").set(admin()).send(payload);
    const second = await request(app).post("/api/v1/admin/academics/students").set(admin()).send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
  });

  it("transfers atomically and preserves prior Enrollment", async () => {
    const { year, source, destination } = await createStructure();
    const student = await prisma.student.create({ data: { saintName: "Maria", fullName: "Nguyễn Hoàng An" } });
    expect((await request(app).post(`/api/v1/admin/academics/classes/${source.id}/enrollments`).set(admin()).send({ studentId: student.id })).status).toBe(201);
    expect((await request(app).post(`/api/v1/admin/academics/classes/${source.id}/enrollments`).set(admin()).send({ studentId: student.id })).status).toBe(409);
    expect((await request(app).post(`/api/v1/admin/academics/students/${student.id}/transfer`).set(admin()).send({ classId: destination.id })).status).toBe(200);
    const history = await prisma.enrollment.findMany({ where: { studentId: student.id }, orderBy: { startedAt: "asc" } });
    expect(history).toHaveLength(2);
    expect(history[0].endedAt).not.toBeNull();
    expect(history[1]).toMatchObject({ classId: destination.id, academicYearId: year.id, endedAt: null });
  });

  it("grants only current assigned-Class roster access", async () => {
    const { source, destination } = await createStructure();
    const student = await prisma.student.create({ data: { saintName: "Maria", fullName: "Nguyễn Hoàng An" } });
    await request(app).post(`/api/v1/admin/academics/classes/${source.id}/enrollments`).set(admin()).send({ studentId: student.id });
    const assigned = await request(app).post(`/api/v1/admin/academics/classes/${source.id}/assignments`).set(admin()).send({ teacherId });
    expect(assigned.status).toBe(201);
    expect((await request(app).post(`/api/v1/admin/academics/classes/${source.id}/assignments`).set(admin()).send({ teacherId })).status).toBe(409);
    const roster = await request(app).get(`/api/v1/teacher/classes/${source.id}/students`).set(teacher());
    expect(roster.status).toBe(200);
    expect(roster.body.data.enrollments[0].student).toMatchObject({ saintName: "Maria", fullName: "Nguyễn Hoàng An" });
    expect((await request(app).get(`/api/v1/teacher/classes/${destination.id}/students`).set(teacher())).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/academics/assignments/${assigned.body.data.id}/end`).set(admin())).status).toBe(200);
    expect((await request(app).get(`/api/v1/teacher/classes/${source.id}/students`).set(teacher())).status).toBe(403);
  });

  it("closes a parent without deleting history and rejects new children", async () => {
    const { year, source } = await createStructure();
    const student = await prisma.student.create({ data: { saintName: "Giuse", fullName: "Trần Minh" } });
    await request(app).post(`/api/v1/admin/academics/classes/${source.id}/enrollments`).set(admin()).send({ studentId: student.id });
    const before = await prisma.enrollment.count({ where: { academicYearId: year.id } });
    expect((await request(app).post(`/api/v1/admin/academics/academic-years/${year.id}/close`).set(admin())).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/academics/academic-years/${year.id}/semesters`).set(admin()).send({ name: "Học kỳ 2" })).status).toBe(409);
    expect((await request(app).post("/api/v1/admin/academics/classes").set(admin()).send({ name: "Dự Trưởng", academicYearId: year.id })).status).toBe(409);
    expect(await prisma.enrollment.count({ where: { academicYearId: year.id } })).toBe(before);
  });
});


