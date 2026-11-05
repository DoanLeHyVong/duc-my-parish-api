import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { ActivityType, AttendanceSessionStatus, AttendanceState, RoleCode } from "../src/generated/prisma/client.js";

const app = createApp();
const suffix = `${Date.now()}`;
const ids: Record<string, string> = {};

try {
  const passwordHash = await hashPassword("Smoke@Reports123!");
  const admin = await prisma.user.create({ data: { username: `reports.admin.${suffix}`, displayName: "Reports Smoke Admin", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } });
  ids.admin = admin.id;
  const teacher = await prisma.user.create({ data: { username: `reports.teacher.${suffix}`, displayName: "Reports Smoke Teacher", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } });
  ids.teacher = teacher.id;
  const year = await prisma.academicYear.create({ data: { name: `Reports Smoke ${suffix}` } }); ids.year = year.id;
  const klass = await prisma.catechismClass.create({ data: { academicYearId: year.id, name: "Smoke Class" } }); ids.class = klass.id;
  const student = await prisma.student.create({ data: { saintName: "Maria", fullName: `Smoke ${suffix}` } }); ids.student = student.id;
  const enrollment = await prisma.enrollment.create({ data: { studentId: student.id, classId: klass.id, academicYearId: year.id, currentKey: `${student.id}:${year.id}` } }); ids.enrollment = enrollment.id;
  const assignment = await prisma.teacherAssignment.create({ data: { teacherId: teacher.id, classId: klass.id, currentKey: `${teacher.id}:${klass.id}` } }); ids.assignment = assignment.id;
  const session = await prisma.attendanceSession.create({ data: {
    classId: klass.id, activityType: ActivityType.CATECHISM_LESSON, occursAt: new Date(),
    windowOpensAt: new Date(Date.now() - 60_000), windowClosesAt: new Date(Date.now() + 60_000), status: AttendanceSessionStatus.OPEN,
    records: { create: { studentId: student.id, saintNameSnapshot: student.saintName, fullNameSnapshot: student.fullName, state: AttendanceState.NOT_MARKED } }
  } }); ids.session = session.id;
  const adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  const teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
  const adminDashboard = await request(app).get(`/api/v1/admin/reports/dashboard?academicYearId=${year.id}`).set({ Authorization: `Bearer ${adminToken}` });
  const teacherDashboard = await request(app).get(`/api/v1/teacher/reports/dashboard?academicYearId=${year.id}`).set({ Authorization: `Bearer ${teacherToken}` });
  const attendance = await request(app).get(`/api/v1/admin/reports/attendance?academicYearId=${year.id}`).set({ Authorization: `Bearer ${adminToken}` });
  if (adminDashboard.status !== 200 || teacherDashboard.status !== 200 || attendance.status !== 200) throw new Error("Reports smoke endpoint failed.");
  if (adminDashboard.body.data.totals.students !== 1 || teacherDashboard.body.data.classes.length !== 1) throw new Error("Reports smoke scope assertion failed.");
  if (attendance.body.data.summary.marks.notMarked !== 1 || attendance.body.data.summary.markedPercentage !== null) throw new Error("Reports smoke NOT_MARKED assertion failed.");
  console.log("Reports smoke passed: Admin/Teacher scope, lifecycle, and NOT_MARKED semantics verified.");
} finally {
  if (ids.session) {
    await prisma.attendanceRecord.deleteMany({ where: { sessionId: ids.session } });
    await prisma.attendanceSession.deleteMany({ where: { id: ids.session } });
  }
  if (ids.assignment) await prisma.teacherAssignment.deleteMany({ where: { id: ids.assignment } });
  if (ids.enrollment) await prisma.enrollment.deleteMany({ where: { id: ids.enrollment } });
  if (ids.student) await prisma.student.deleteMany({ where: { id: ids.student } });
  if (ids.class) await prisma.catechismClass.deleteMany({ where: { id: ids.class } });
  if (ids.year) await prisma.academicYear.deleteMany({ where: { id: ids.year } });
  if (ids.admin || ids.teacher) await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.teacher].filter(Boolean) } } });
  await prisma.$disconnect();
}


