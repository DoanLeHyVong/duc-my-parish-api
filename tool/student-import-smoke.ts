import ExcelJS from "exceljs";
import request from "supertest";
import { createApp } from "../src/app.js";
import { RoleCode } from "../src/generated/prisma/client.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();
const suffix = Date.now().toString();
const created: { yearId?: string; batchId?: string } = {};

try {
  const admin = await prisma.user.findFirstOrThrow({ where: { roleAssignments: { some: { role: { code: RoleCode.SUPER_ADMIN } } }, isActive: true } });
  const token = signAccessToken({ sub: admin.id, av: admin.authVersion });
  const header = { Authorization: `Bearer ${token}` };
  const year = await prisma.academicYear.create({ data: { name: `Import Smoke ${suffix}` } });
  created.yearId = year.id;
  const targetClass = await prisma.catechismClass.create({ data: { name: "Import Smoke", academicYearId: year.id } });

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Hoc sinh");
  sheet.addRow(["Tên Thánh", "Họ và tên"]);
  sheet.addRow(["Maria", `Smoke Student ${suffix}`]);
  const file = Buffer.from(await book.xlsx.writeBuffer());
  const preview = await request(app).post("/api/v1/admin/academics/imports/preview").set(header)
    .field("classId", targetClass.id).field("saintNameColumn", "Tên Thánh").field("fullNameColumn", "Họ và tên")
    .attach("file", file, { filename: "smoke.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (preview.status !== 201 || preview.body.data.validRows !== 1) throw new Error(`Preview failed: ${preview.status}`);
  created.batchId = preview.body.data.id as string;
  const body = { requestId: `smoke-${suffix}`, revision: 0, resolutions: [] };
  const confirmation = await request(app).post(`/api/v1/admin/academics/imports/${created.batchId}/confirm`).set(header).send(body);
  if (confirmation.status !== 200 || confirmation.body.data.createdStudents !== 1) throw new Error(`Confirmation failed: ${confirmation.status}`);
  const enrollment = await prisma.enrollment.findFirst({ where: { classId: targetClass.id, endedAt: null } });
  if (!enrollment) throw new Error("Imported Student was not enrolled in the target Class.");
  const replay = await request(app).post(`/api/v1/admin/academics/imports/${created.batchId}/confirm`).set(header).send(body);
  if (replay.status !== 200) throw new Error(`Idempotent replay failed: ${replay.status}`);
  const history = await request(app).get("/api/v1/admin/academics/imports?page=1&limit=20").set(header);
  const detail = await request(app).get(`/api/v1/admin/academics/imports/${created.batchId}`).set(header);
  if (history.status !== 200 || !history.body.data.items.some((item: { id: string }) => item.id === created.batchId)) {
    throw new Error(`Import history list failed: ${history.status}`);
  }
  if (detail.status !== 200 || detail.body.data.events.length !== 2 || detail.body.data.rows.length !== 1) {
    throw new Error(`Import history detail/audit failed: ${detail.status}`);
  }
  console.log("Student import smoke passed: XLSX preview, transactional confirmation, target-Class enrollment, history, and replay safety.");
} finally {
  if (created.batchId) {
    const rows = await prisma.studentImportRow.findMany({ where: { batchId: created.batchId }, select: { createdStudentId: true } });
    const studentIds = rows.map((row) => row.createdStudentId).filter((id): id is string => Boolean(id));
    await prisma.studentImportEvent.deleteMany({ where: { batchId: created.batchId } });
    await prisma.studentImportRow.deleteMany({ where: { batchId: created.batchId } });
    await prisma.studentImportBatch.deleteMany({ where: { id: created.batchId } });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
  }
  if (created.yearId) {
    await prisma.catechismClass.deleteMany({ where: { academicYearId: created.yearId } });
    await prisma.academicYear.deleteMany({ where: { id: created.yearId } });
  }
  await prisma.$disconnect();
}


