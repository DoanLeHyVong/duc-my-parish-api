import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { RoleCode } from "../src/generated/prisma/client.js";
import { randomBytes } from "node:crypto";

const suffix = Date.now().toString();
const app = createApp();
const created: { yearId?: string; teacherId?: string } = {};

try {
  const admin = await prisma.user.findFirstOrThrow({ where: { roleAssignments: { some: { role: { code: RoleCode.SUPER_ADMIN } } }, isActive: true } });
  const teacher = await prisma.user.create({
    data: {
      username: `smoke.teacher.${suffix}`,
      displayName: "Smoke Teacher",
      passwordHash: await hashPassword(`Aa1!${randomBytes(24).toString("base64url")}`),
      roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } }
    }
  });
  created.teacherId = teacher.id;
  const adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  const teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
  const adminHeader = { Authorization: `Bearer ${adminToken}` };

  const year = await request(app).post("/api/v1/admin/academics/academic-years").set(adminHeader).send({ name: `Smoke ${suffix}` });
  if (year.status !== 201) throw new Error(`Year create failed: ${year.status}`);
  created.yearId = year.body.data.id as string;
  const firstClass = await request(app).post("/api/v1/admin/academics/classes").set(adminHeader).send({ name: "Smoke A", academicYearId: created.yearId });
  const secondClass = await request(app).post("/api/v1/admin/academics/classes").set(adminHeader).send({ name: "Smoke B", academicYearId: created.yearId });
  const student = await request(app).post("/api/v1/admin/academics/students").set(adminHeader).send({ saintName: "Maria", fullName: "Smoke Student" });
  if ([firstClass, secondClass, student].some((response) => response.status !== 201)) throw new Error("Academic create flow failed");
  const classA = firstClass.body.data.id as string;
  const classB = secondClass.body.data.id as string;
  const studentId = student.body.data.id as string;
  const enrollment = await request(app).post(`/api/v1/admin/academics/classes/${classA}/enrollments`).set(adminHeader).send({ studentId });
  const assignment = await request(app).post(`/api/v1/admin/academics/classes/${classA}/assignments`).set(adminHeader).send({ teacherId: teacher.id });
  const roster = await request(app).get(`/api/v1/teacher/classes/${classA}/students`).set("Authorization", `Bearer ${teacherToken}`);
  const transfer = await request(app).post(`/api/v1/admin/academics/students/${studentId}/transfer`).set(adminHeader).send({ classId: classB });
  if (enrollment.status !== 201 || assignment.status !== 201 || roster.status !== 200 || transfer.status !== 200) {
    throw new Error(`Flow failed: enroll=${enrollment.status}, assign=${assignment.status}, roster=${roster.status}, transfer=${transfer.status}`);
  }
  const history = await prisma.enrollment.findMany({ where: { studentId } });
  if (history.length !== 2 || history.filter((item) => item.endedAt === null).length !== 1) throw new Error("Transfer history invariant failed");
  console.log("Academic smoke passed: Admin CRUD, enrollment, assignment scope, Teacher roster, and transfer history.");
} finally {
  if (created.yearId) {
    const classes = await prisma.catechismClass.findMany({ where: { academicYearId: created.yearId }, select: { id: true } });
    const classIds = classes.map((item) => item.id);
    await prisma.teacherAssignment.deleteMany({ where: { classId: { in: classIds } } });
    const students = await prisma.enrollment.findMany({ where: { academicYearId: created.yearId }, select: { studentId: true } });
    await prisma.enrollment.deleteMany({ where: { academicYearId: created.yearId } });
    await prisma.student.deleteMany({ where: { id: { in: students.map((item) => item.studentId) } } });
    await prisma.semester.deleteMany({ where: { academicYearId: created.yearId } });
    await prisma.catechismClass.deleteMany({ where: { academicYearId: created.yearId } });
    await prisma.academicYear.deleteMany({ where: { id: created.yearId } });
  }
  if (created.teacherId) await prisma.user.deleteMany({ where: { id: created.teacherId } });
  await prisma.$disconnect();
}


