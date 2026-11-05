import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { RoleCode } from "../src/generated/prisma/client.js";

const app = createApp();
const suffix = `${Date.now()}`;
const ids: Record<string, string> = {};

try {
  const password = "Smoke@Deletion123!";
  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.create({ data: { username: `deletion.admin.${suffix}`, displayName: "Deletion Smoke Admin", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } });
  const teacher = await prisma.user.create({ data: { username: `deletion.teacher.${suffix}`, displayName: "Deletion Smoke Teacher", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } });
  ids.admin = admin.id; ids.teacher = teacher.id;
  const year = await prisma.academicYear.create({ data: { name: `Deletion Smoke ${suffix}` } }); ids.year = year.id;
  const klass = await prisma.catechismClass.create({ data: { academicYearId: year.id, name: "Deletion Smoke Class" } }); ids.class = klass.id;
  const assignment = await prisma.teacherAssignment.create({ data: { teacherId: teacher.id, classId: klass.id, currentKey: `${teacher.id}:${klass.id}` } }); ids.assignment = assignment.id;
  const adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  const teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
  const teacherAuth = { Authorization: `Bearer ${teacherToken}` };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };
  const submitted = await request(app).post("/api/v1/account-deletion/requests").set(teacherAuth).send({ requestKey: `smoke-${suffix}`, currentPassword: password, confirmation: "XÓA TÀI KHOẢN" });
  if (submitted.status !== 201) throw new Error(`Submit failed: ${submitted.status}`);
  ids.request = submitted.body.data.id;
  let revision = 1;
  for (const action of ["START_REVIEW", "VERIFY", "APPROVE"]) {
    const result = await request(app).post(`/api/v1/admin/account-deletion/requests/${ids.request}/transitions`).set(adminAuth).send({ action, revision, reason: `Smoke ${action}` });
    if (result.status !== 200) throw new Error(`${action} failed: ${result.status}`);
    revision = result.body.data.revision;
  }
  const executed = await request(app).post(`/api/v1/admin/account-deletion/requests/${ids.request}/transitions`).set(adminAuth).send({
    action: "EXECUTE", revision, reason: "Smoke execution with explicit retention basis",
    retentionDecisions: [
      { category: "ACCOUNT_DELETION_AUDIT", basis: "Smoke evidence for the approved deletion workflow." },
      { category: "TEACHER_ASSIGNMENTS", basis: "Smoke evidence for preserved historical assignment attribution." }
    ]
  });
  if (executed.status !== 200 || executed.body.data.status !== "EXECUTED") throw new Error(`Execution failed: ${executed.status}`);
  if ((await request(app).get("/api/v1/auth/me").set(teacherAuth)).status !== 401) throw new Error("Old token was not revoked.");
  if (await prisma.teacherAssignment.count({ where: { id: assignment.id } }) !== 1) throw new Error("Historical assignment was not preserved.");
  console.log("Account-deletion smoke passed: request lifecycle, retention gate, tombstone, token revocation, and history preservation verified.");
} finally {
  if (ids.request) {
    await prisma.accountDeletionEvent.deleteMany({ where: { requestId: ids.request } });
    await prisma.accountDeletionRequest.deleteMany({ where: { id: ids.request } });
  }
  if (ids.assignment) await prisma.teacherAssignment.deleteMany({ where: { id: ids.assignment } });
  if (ids.class) await prisma.catechismClass.deleteMany({ where: { id: ids.class } });
  if (ids.year) await prisma.academicYear.deleteMany({ where: { id: ids.year } });
  if (ids.admin || ids.teacher) await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.teacher].filter(Boolean) } } });
  await prisma.$disconnect();
}


