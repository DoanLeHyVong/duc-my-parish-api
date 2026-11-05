import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { RoleCode } from "../src/generated/prisma/client.js";

const app = createApp();
const suffix = Date.now().toString();
let yearId: string | undefined;
let studentId: string | undefined;

try {
  const admin = await prisma.user.findFirstOrThrow({ where: { roleAssignments: { some: { role: { code: RoleCode.SUPER_ADMIN } } }, isActive: true } });
  const header = { Authorization: `Bearer ${signAccessToken({ sub: admin.id, av: admin.authVersion })}` };
  const year = await prisma.academicYear.create({ data: { name: `Smoke grades ${suffix}` } });
  yearId = year.id;
  const semester = await prisma.semester.create({ data: { academicYearId: year.id, name: "Smoke semester" } });
  const klass = await prisma.catechismClass.create({ data: { academicYearId: year.id, name: "Smoke class" } });
  const student = await prisma.student.create({ data: { saintName: "Maria", fullName: "Smoke Grade Student" } });
  studentId = student.id;
  await prisma.enrollment.create({ data: { studentId: student.id, classId: klass.id, academicYearId: year.id, currentKey: `${student.id}:${year.id}` } });

  const columns = [];
  for (const name of ["Smoke oral", "Smoke written"]) {
    const result = await request(app).post("/api/v1/admin/grades/columns").set(header).send({ classId: klass.id, semesterId: semester.id, name, minimum: "0", maximum: "10", precision: 1 });
    if (result.status !== 201) throw new Error(`Column create failed: ${result.status}`);
    columns.push(result.body.data.id as string);
  }
  for (const [index, gradeColumnId] of columns.entries()) {
    const result = await request(app).post("/api/v1/admin/grades/grades").set(header).send({ studentId: student.id, classId: klass.id, semesterId: semester.id, gradeColumnId, value: index === 0 ? "8.0" : "9.0", revision: null, requestId: `smoke-grade-${suffix}-${index}` });
    if (result.status !== 200) throw new Error(`Grade save failed: ${result.status}`);
  }
  const draft = await request(app).post("/api/v1/admin/grades/rules").set(header).send({ classId: klass.id, semesterId: semester.id, decimalPlaces: 1, roundingMethod: "HALF_UP", weights: columns.map((gradeColumnId) => ({ gradeColumnId, weight: "1" })), bands: [{ minimumInclusive: "0", label: "Smoke low" }, { minimumInclusive: "8", label: "Smoke high" }] });
  if (draft.status !== 201) throw new Error(`Rule draft failed: ${draft.status}`);
  const published = await request(app).post(`/api/v1/admin/grades/rules/${draft.body.data.id}/publish`).set(header).send({ revision: 0 });
  if (published.status !== 200) throw new Error(`Rule publish failed: ${published.status}`);
  const first = await request(app).post("/api/v1/admin/grades/calculate").set(header).send({ studentId: student.id, classId: klass.id, semesterId: semester.id, requestId: `smoke-calc-${suffix}-1` });
  const second = await request(app).post("/api/v1/admin/grades/calculate").set(header).send({ studentId: student.id, classId: klass.id, semesterId: semester.id, requestId: `smoke-calc-${suffix}-2` });
  if (first.status !== 201 || second.status !== 201 || first.body.data.result.roundedAverage !== "8.5") throw new Error("Configured calculation failed");
  if (await prisma.classificationResult.count({ where: { studentId: student.id } }) !== 2) throw new Error("Append-only result history failed");
  console.log("Grade smoke passed: configured columns, audited grades, published rule, weighted calculation, and historical recalculation.");
} finally {
  if (yearId) {
    const classes = await prisma.catechismClass.findMany({ where: { academicYearId: yearId }, select: { id: true } });
    const classIds = classes.map((item) => item.id);
    await prisma.classificationResult.deleteMany({ where: { classId: { in: classIds } } });
    const rules = await prisma.classificationRuleVersion.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    await prisma.classificationRuleBand.deleteMany({ where: { ruleVersionId: { in: rules.map((item) => item.id) } } });
    await prisma.classificationRuleWeight.deleteMany({ where: { ruleVersionId: { in: rules.map((item) => item.id) } } });
    await prisma.classificationRuleVersion.deleteMany({ where: { id: { in: rules.map((item) => item.id) } } });
    const records = await prisma.gradeRecord.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    await prisma.gradeAuditEntry.deleteMany({ where: { gradeRecordId: { in: records.map((item) => item.id) } } });
    await prisma.gradeRecord.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.gradeColumn.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.enrollment.deleteMany({ where: { academicYearId: yearId } });
    if (studentId) await prisma.student.deleteMany({ where: { id: studentId } });
    await prisma.semester.deleteMany({ where: { academicYearId: yearId } });
    await prisma.catechismClass.deleteMany({ where: { academicYearId: yearId } });
    await prisma.academicYear.deleteMany({ where: { id: yearId } });
  }
  await prisma.$disconnect();
}


