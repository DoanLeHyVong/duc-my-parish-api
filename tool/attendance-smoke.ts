import { randomBytes } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { RoleCode } from "../src/generated/prisma/client.js";

const suffix = Date.now().toString();
const app = createApp();
const created: { yearId?: string; teacherId?: string; studentId?: string } = {};
const requestId = (action: string) => `${action}-${suffix}`;

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

try {
  const admin = await prisma.user.findFirstOrThrow({
    where: { roleAssignments: { some: { role: { code: RoleCode.SUPER_ADMIN } } }, isActive: true }
  });
  const teacher = await prisma.user.create({
    data: {
      username: `smoke.attendance.${suffix}`,
      displayName: "Attendance Smoke Teacher",
      passwordHash: await hashPassword(`Aa1!${randomBytes(24).toString("base64url")}`),
      roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } }
    }
  });
  created.teacherId = teacher.id;
  const adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  const teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
  const adminHeader = { Authorization: `Bearer ${adminToken}` };
  const teacherHeader = { Authorization: `Bearer ${teacherToken}` };

  const year = await request(app)
    .post("/api/v1/admin/academics/academic-years")
    .set(adminHeader)
    .send({ name: `Attendance Smoke ${suffix}` });
  if (year.status !== 201) throw new Error(`Year create failed: ${year.status}`);
  created.yearId = year.body.data.id as string;

  const classResponse = await request(app)
    .post("/api/v1/admin/academics/classes")
    .set(adminHeader)
    .send({ name: "Attendance Smoke Class", academicYearId: created.yearId });
  const studentResponse = await request(app)
    .post("/api/v1/admin/academics/students")
    .set(adminHeader)
    .send({ saintName: "Maria", fullName: "Attendance Smoke Student" });
  if (studentResponse.status === 201) created.studentId = studentResponse.body.data.id as string;
  if (classResponse.status !== 201 || studentResponse.status !== 201) {
    throw new Error(`Academic setup failed: class=${classResponse.status}, student=${studentResponse.status}`);
  }
  const classId = classResponse.body.data.id as string;
  const studentId = studentResponse.body.data.id as string;
  await request(app)
    .post(`/api/v1/admin/academics/classes/${classId}/enrollments`)
    .set(adminHeader)
    .send({ studentId });
  await request(app)
    .post(`/api/v1/admin/academics/classes/${classId}/assignments`)
    .set(adminHeader)
    .send({ teacherId: teacher.id });

  const localNow = new Date(Date.now() + 7 * 60 * 60_000);
  const today = dateKey(localNow);
  const occurrenceMinute = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const template = await request(app)
    .post("/api/v1/admin/attendance/templates")
    .set(adminHeader)
    .send({
      classId,
      activityType: "CATECHISM_LESSON",
      weekday: localNow.getUTCDay(),
      occurrenceMinute,
      utcOffsetMinutes: 420,
      windowOpenOffsetMinutes: -30,
      windowCloseOffsetMinutes: 90,
      effectiveStart: today,
      effectiveEnd: today
    });
  if (template.status !== 201) throw new Error(`Template create failed: ${template.status} ${template.text}`);
  const templateId = template.body.data.id as string;

  const generated = await request(app)
    .post(`/api/v1/admin/attendance/templates/${templateId}/generate`)
    .set(adminHeader)
    .send({ fromDate: today, toDate: today });
  const replay = await request(app)
    .post(`/api/v1/admin/attendance/templates/${templateId}/generate`)
    .set(adminHeader)
    .send({ fromDate: today, toDate: today });
  if (generated.status !== 200 || generated.body.data.created !== 1 || replay.body.data.existing !== 1) {
    throw new Error(`Generation/replay failed: ${generated.status}/${replay.status}`);
  }

  const sessions = await request(app)
    .get(`/api/v1/teacher/attendance/sessions?classId=${classId}`)
    .set(teacherHeader);
  const session = sessions.body.data.items[0] as { id: string; revision: number; records: Array<{ studentId: string; id: string }> };
  if (sessions.status !== 200 || !session || session.records.length !== 1) {
    throw new Error(`Teacher scoped session read failed: ${sessions.status}`);
  }

  const saved = await request(app)
    .post(`/api/v1/teacher/attendance/sessions/${session.id}/save`)
    .set(teacherHeader)
    .send({
      requestId: requestId("save"),
      revision: session.revision,
      records: [{ studentId, state: "ABSENT" }]
    });
  const submitted = await request(app)
    .post(`/api/v1/teacher/attendance/sessions/${session.id}/submit`)
    .set(teacherHeader)
    .send({ requestId: requestId("submit"), revision: saved.body.data.revision });
  const finalized = await request(app)
    .post(`/api/v1/admin/attendance/sessions/${session.id}/finalize`)
    .set(adminHeader)
    .send({ requestId: requestId("finalize"), revision: submitted.body.data.revision });
  const corrected = await request(app)
    .post(`/api/v1/admin/attendance/records/${session.records[0]!.id}/correct`)
    .set(adminHeader)
    .send({ requestId: requestId("correct"), state: "PRESENT", reason: "Smoke verification correction" });
  const audit = await request(app)
    .get(`/api/v1/admin/attendance/audit?classId=${classId}`)
    .set(adminHeader);
  const absences = await request(app)
    .get(`/api/v1/teacher/attendance/absences?classId=${classId}`)
    .set(teacherHeader);

  if (saved.status !== 200 || submitted.body.data.status !== "SUBMITTED" || finalized.body.data.status !== "FINALIZED") {
    throw new Error(`Lifecycle failed: save=${saved.status}, submit=${submitted.status}, finalize=${finalized.status}`);
  }
  if (corrected.status !== 200 || corrected.body.data.state !== "PRESENT" || audit.body.data.total !== 1) {
    throw new Error(`Correction/audit failed: correction=${corrected.status}, audit=${audit.status}`);
  }
  if (absences.status !== 200 || absences.body.data.total !== 0) {
    throw new Error(`Absence view failed: ${absences.status}`);
  }

  console.log("Attendance smoke passed: generation replay, Teacher save/submit, Admin finalize/correction, audit, and scoped absence view.");
} finally {
  if (created.yearId) {
    const classes = await prisma.catechismClass.findMany({
      where: { academicYearId: created.yearId },
      select: { id: true }
    });
    const classIds = classes.map((item) => item.id);
    const sessions = await prisma.attendanceSession.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    const sessionIds = sessions.map((item) => item.id);
    await prisma.attendanceAuditEntry.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.attendanceEvent.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.attendanceRecord.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.scheduleException.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.attendanceSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.scheduleTemplate.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.teacherAssignment.deleteMany({ where: { classId: { in: classIds } } });
    const students = await prisma.enrollment.findMany({ where: { academicYearId: created.yearId }, select: { studentId: true } });
    await prisma.enrollment.deleteMany({ where: { academicYearId: created.yearId } });
    await prisma.student.deleteMany({ where: { id: { in: students.map((item) => item.studentId) } } });
    await prisma.semester.deleteMany({ where: { academicYearId: created.yearId } });
    await prisma.catechismClass.deleteMany({ where: { academicYearId: created.yearId } });
    await prisma.academicYear.deleteMany({ where: { id: created.yearId } });
  }
  if (created.studentId) await prisma.student.deleteMany({ where: { id: created.studentId } });
  if (created.teacherId) await prisma.user.deleteMany({ where: { id: created.teacherId } });
  await prisma.$disconnect();
}


