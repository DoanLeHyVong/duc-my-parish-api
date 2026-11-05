import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RoleCode } from "../src/generated/prisma/client.js";
import { createApp } from "../src/app.js";
import { getEnv } from "../src/config/env.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { hashPassword } from "../src/lib/password.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();
const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let adminToken: string;
let teacherToken: string;
let classId: string;

async function cleanDatabase() {
  if (getEnv().DATABASE_NAME !== "appglv_unified_test") throw new Error("Import tests refuse to clear a database other than appglv_unified_test.");
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

async function workbook(rows: Array<[string, string]>) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Hoc sinh");
  sheet.addRow(["Tên Thánh", "Họ và tên"]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

beforeEach(async () => {
  await cleanDatabase();
  const passwordHash = await hashPassword("Test@Import123!");
  const admin = await prisma.user.create({ data: { username: "import.admin", displayName: "Admin Import", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.SUPER_ADMIN } } } } } });
  const teacher = await prisma.user.create({ data: { username: "import.teacher", displayName: "Teacher Import", passwordHash, roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } } } } } });
  adminToken = signAccessToken({ sub: admin.id, av: admin.authVersion });
  teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
  const year = await prisma.academicYear.create({ data: { name: "2026-2027" } });
  classId = (await prisma.catechismClass.create({ data: { name: "Thêm Sức", academicYearId: year.id } })).id;
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const teacher = () => ({ Authorization: `Bearer ${teacherToken}` });

async function preview(file: Buffer) {
  return request(app).post("/api/v1/admin/academics/imports/preview").set(admin())
    .field("classId", classId).field("saintNameColumn", "Tên Thánh").field("fullNameColumn", "Họ và tên")
    .attach("file", file, { filename: "students.xlsx", contentType: xlsxMime });
}

describe("student Excel import with MariaDB", () => {
  it("allows only Super Admin and exposes workbook headers without persistence", async () => {
    const file = await workbook([["Maria", "Nguyễn Hoàng An"]]);
    expect((await request(app).post("/api/v1/admin/academics/imports/headers").attach("file", file, { filename: "students.xlsx", contentType: xlsxMime })).status).toBe(401);
    expect((await request(app).post("/api/v1/admin/academics/imports/headers").set(teacher()).attach("file", file, { filename: "students.xlsx", contentType: xlsxMime })).status).toBe(403);
    const result = await request(app).post("/api/v1/admin/academics/imports/headers").set(admin()).attach("file", file, { filename: "students.xlsx", contentType: xlsxMime });
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ headers: ["Tên Thánh", "Họ và tên"], rowCount: 1 });
    expect(await prisma.student.count()).toBe(0);
    expect(await prisma.studentImportBatch.count()).toBe(0);
  });

  it("previews required-field errors and blocks confirmation without Student writes", async () => {
    const result = await preview(await workbook([["", "Nguyễn A"], ["Giuse", ""]]));
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({ totalRows: 2, validRows: 0, invalidRows: 2, possibleDuplicateRows: 0 });
    expect(result.body.data.rows[0].validationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "saintName" })]));
    expect(await prisma.student.count()).toBe(0);
    const confirmation = await request(app).post(`/api/v1/admin/academics/imports/${result.body.data.id}/confirm`).set(admin()).send({ requestId: "invalid-batch-001", revision: 0, resolutions: [] });
    expect(confirmation.status).toBe(409);
    expect(confirmation.body.error.code).toBe("INVALID_ROWS_REMAIN");
  });

  it("warns on normalized same-name matches and requires an explicit resolution", async () => {
    const existing = await prisma.student.create({ data: { saintName: "Maria", fullName: "Nguyễn Hoàng An" } });
    const result = await preview(await workbook([["  maria ", " NGUYỄN HOÀNG AN "]]));
    expect(result.status).toBe(201);
    expect(result.body.data.possibleDuplicateRows).toBe(1);
    expect(result.body.data.rows[0].candidates).toEqual([expect.objectContaining({ id: existing.id })]);
    const missing = await request(app).post(`/api/v1/admin/academics/imports/${result.body.data.id}/confirm`).set(admin()).send({ requestId: "duplicate-missing-001", revision: 0, resolutions: [] });
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe("DUPLICATE_RESOLUTION_REQUIRED");
    const excluded = await request(app).post(`/api/v1/admin/academics/imports/${result.body.data.id}/confirm`).set(admin()).send({
      requestId: "duplicate-exclude-001", revision: 0,
      resolutions: [{ rowId: result.body.data.rows[0].id, resolution: "EXCLUDE" }]
    });
    expect(excluded.status).toBe(200);
    expect(excluded.body.data).toMatchObject({ status: "COMPLETED", createdStudents: 0, excludedRows: 1 });
    expect(await prisma.student.count()).toBe(1);
  });

  it("confirms transactionally, enrolls the batch into one Class, and replays idempotently", async () => {
    const file = await workbook([["Maria", "Nguyễn Hoàng An"], ["Giuse", "Trần Minh Khôi"]]);
    const result = await preview(file);
    expect(result.status).toBe(201);
    const body = { requestId: "confirm-import-001", revision: 0, resolutions: [] };
    const confirmed = await request(app).post(`/api/v1/admin/academics/imports/${result.body.data.id}/confirm`).set(admin()).send(body);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({ status: "COMPLETED", createdStudents: 2, excludedRows: 0 });
    expect(await prisma.student.count()).toBe(2);
    expect(await prisma.enrollment.count({ where: { classId, endedAt: null } })).toBe(2);
    const replay = await request(app).post(`/api/v1/admin/academics/imports/${result.body.data.id}/confirm`).set(admin()).send(body);
    expect(replay.status).toBe(200);
    expect(await prisma.student.count()).toBe(2);
    const repeatedPreview = await preview(file);
    expect(repeatedPreview.status).toBe(409);
    expect(repeatedPreview.body.error.code).toBe("IMPORT_ALREADY_COMPLETED");
    const history = await request(app).get("/api/v1/admin/academics/imports").set(admin());
    expect(history.status).toBe(200);
    expect(history.body.data.items[0]).toMatchObject({ id: result.body.data.id, status: "COMPLETED", classId });
  });

  it("rejects a stale preview when a new matching Student appears before confirmation", async () => {
    const result = await preview(await workbook([["Maria", "Nguyễn Hoàng An"]]));
    expect(result.status).toBe(201);
    await prisma.student.create({ data: { saintName: " maria ", fullName: "NGUYỄN HOÀNG AN" } });
    const confirmation = await request(app).post(`/api/v1/admin/academics/imports/${result.body.data.id}/confirm`).set(admin()).send({
      requestId: "stale-duplicate-001", revision: 0, resolutions: []
    });
    expect(confirmation.status).toBe(409);
    expect(confirmation.body.error.code).toBe("STALE_DUPLICATE_PREVIEW");
    expect(await prisma.student.count()).toBe(1);
    expect(await prisma.enrollment.count()).toBe(0);
  });

  it("rechecks destination scope inside confirmation", async () => {
    const result = await preview(await workbook([["Giuse", "Trần Minh Khôi"]]));
    expect(result.status).toBe(201);
    await prisma.catechismClass.update({ where: { id: classId }, data: { status: "CLOSED", closedAt: new Date() } });
    const confirmation = await request(app).post(`/api/v1/admin/academics/imports/${result.body.data.id}/confirm`).set(admin()).send({
      requestId: "closed-class-001", revision: 0, resolutions: []
    });
    expect(confirmation.status).toBe(409);
    expect(confirmation.body.error.code).toBe("CLASS_CLOSED");
    expect(await prisma.student.count()).toBe(0);
  });
});


