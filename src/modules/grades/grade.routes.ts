import { createHash } from "node:crypto";
import { Router } from "express";
import {
  AcademicStatus,
  ClassificationRuleStatus,
  GradeRoundingMethod,
  Prisma
} from "../../generated/prisma/client.js";
import { ApiError } from "../../lib/api-error.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { authorize, Permission } from "../../middleware/authorize.js";
import {
  calculateSchema,
  columnSchema,
  columnUpdateSchema,
  gradeUpsertSchema,
  idParamsSchema,
  publishSchema,
  reportQuerySchema,
  ruleDraftSchema,
  scopeQuerySchema
} from "./grade.schemas.js";

export const adminGradeRouter = Router();
adminGradeRouter.use(authenticate, authorize(Permission.APPGLV_MANAGE));

const D = Prisma.Decimal;
const conflict = (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details);
const notFound = (entity: string) => new ApiError(404, "NOT_FOUND", `Không tìm thấy ${entity}.`);
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function requireScope(classId: string, semesterId: string, open = false) {
  const [klass, semester] = await Promise.all([
    prisma.catechismClass.findUnique({ where: { id: classId }, include: { academicYear: true } }),
    prisma.semester.findUnique({ where: { id: semesterId }, include: { academicYear: true } })
  ]);
  if (!klass) throw notFound("Lớp");
  if (!semester) throw notFound("Học kỳ");
  if (klass.academicYearId !== semester.academicYearId) {
    throw conflict("CROSS_SCOPE", "Lớp và Học kỳ phải thuộc cùng Năm học.");
  }
  if (open && (klass.status !== AcademicStatus.OPEN || klass.academicYear.status !== AcademicStatus.OPEN || semester.status !== AcademicStatus.OPEN)) {
    throw conflict("ACADEMIC_SCOPE_CLOSED", "Chỉ có thể thay đổi điểm trong phạm vi học vụ đang mở.");
  }
  return { klass, semester };
}

function validateColumnValue(value: Prisma.Decimal, column: { minimum: Prisma.Decimal; maximum: Prisma.Decimal; precision: number }) {
  if (value.lessThan(column.minimum) || value.greaterThan(column.maximum)) {
    throw new ApiError(422, "GRADE_OUT_OF_RANGE", `Điểm phải từ ${column.minimum} đến ${column.maximum}.`);
  }
  if (value.decimalPlaces() > column.precision) {
    throw new ApiError(422, "GRADE_PRECISION", `Điểm chỉ được có tối đa ${column.precision} chữ số thập phân.`);
  }
}

const ruleInclude = {
  weights: { include: { gradeColumn: true }, orderBy: { gradeColumn: { name: "asc" as const } } },
  bands: { orderBy: { minimumInclusive: "desc" as const } },
  publishedBy: { select: { id: true, displayName: true } }
};

adminGradeRouter.get("/columns", asyncHandler(async (request, response) => {
  const scope = scopeQuerySchema.parse(request.query);
  await requireScope(scope.classId, scope.semesterId);
  const items = await prisma.gradeColumn.findMany({ where: scope, orderBy: { name: "asc" } });
  response.json({ data: { items, total: items.length } });
}));

adminGradeRouter.post("/columns", asyncHandler(async (request, response) => {
  const input = columnSchema.parse(request.body);
  await requireScope(input.classId, input.semesterId, true);
  const minimum = new D(input.minimum);
  const maximum = new D(input.maximum);
  if (minimum.greaterThanOrEqualTo(maximum)) throw new ApiError(422, "INVALID_GRADE_SCALE", "Điểm tối thiểu phải nhỏ hơn điểm tối đa.");
  const item = await prisma.gradeColumn.create({ data: { ...input, minimum, maximum } }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("DUPLICATE_GRADE_COLUMN", "Tên cột điểm đã tồn tại trong phạm vi này.");
    throw error;
  });
  response.status(201).json({ data: item });
}));

adminGradeRouter.patch("/columns/:id", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = columnUpdateSchema.parse(request.body);
  const column = await prisma.gradeColumn.findUnique({ where: { id }, include: { _count: { select: { grades: true } }, ruleWeights: { take: 1 } } });
  if (!column) throw notFound("cột điểm");
  await requireScope(column.classId, column.semesterId, true);
  if (column._count.grades > 0 || column.ruleWeights.length > 0) throw conflict("GRADE_COLUMN_IN_USE", "Không thể sửa cột điểm đã có điểm hoặc đã được publish trong quy tắc.");
  const minimum = new D(input.minimum);
  const maximum = new D(input.maximum);
  if (minimum.greaterThanOrEqualTo(maximum)) throw new ApiError(422, "INVALID_GRADE_SCALE", "Điểm tối thiểu phải nhỏ hơn điểm tối đa.");
  const updated = await prisma.gradeColumn.updateMany({ where: { id, revision: input.revision }, data: { name: input.name, minimum, maximum, precision: input.precision, revision: { increment: 1 } } }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("DUPLICATE_GRADE_COLUMN", "Tên cột điểm đã tồn tại trong phạm vi này.");
    throw error;
  });
  if (updated.count !== 1) throw conflict("STALE_GRADE_COLUMN", "Cột điểm đã thay đổi. Vui lòng tải lại.");
  response.json({ data: await prisma.gradeColumn.findUniqueOrThrow({ where: { id } }) });
}));

adminGradeRouter.get("/sheet", asyncHandler(async (request, response) => {
  const scope = scopeQuerySchema.parse(request.query);
  await requireScope(scope.classId, scope.semesterId);
  const [columns, enrollments, grades] = await Promise.all([
    prisma.gradeColumn.findMany({ where: scope, orderBy: { name: "asc" } }),
    prisma.enrollment.findMany({ where: { classId: scope.classId, endedAt: null }, include: { student: true }, orderBy: { student: { fullName: "asc" } }, take: 100 }),
    prisma.gradeRecord.findMany({ where: { ...scope, student: { enrollments: { some: { classId: scope.classId, endedAt: null } } } }, orderBy: { updatedAt: "desc" } })
  ]);
  response.json({ data: { ...scope, columns, students: enrollments.map((item) => item.student), grades } });
}));

adminGradeRouter.post("/grades", asyncHandler(async (request, response) => {
  const actorId = request.auth!.userId;
  const input = gradeUpsertSchema.parse(request.body);
  const requestFingerprint = fingerprint({ ...input, value: new D(input.value).toFixed() });
  const replay = await prisma.gradeAuditEntry.findUnique({ where: { requestId: input.requestId }, include: { gradeRecord: true } });
  if (replay) {
    if (replay.fingerprint === requestFingerprint) { response.json({ data: replay.gradeRecord }); return; }
    throw conflict("IDEMPOTENCY_KEY_REUSED", "Mã yêu cầu đã được dùng cho nội dung khác.");
  }
  await requireScope(input.classId, input.semesterId, true);
  const [column, enrollment, existing] = await Promise.all([
    prisma.gradeColumn.findFirst({ where: { id: input.gradeColumnId, classId: input.classId, semesterId: input.semesterId } }),
    prisma.enrollment.findFirst({ where: { studentId: input.studentId, classId: input.classId, endedAt: null } }),
    prisma.gradeRecord.findUnique({ where: { studentId_classId_semesterId_gradeColumnId: { studentId: input.studentId, classId: input.classId, semesterId: input.semesterId, gradeColumnId: input.gradeColumnId } } })
  ]);
  if (!column) throw conflict("GRADE_COLUMN_SCOPE_MISMATCH", "Cột điểm không thuộc Lớp và Học kỳ đã chọn.");
  if (!enrollment) throw conflict("STUDENT_NOT_ENROLLED", "Học sinh không thuộc Lớp đã chọn.");
  const value = new D(input.value);
  validateColumnValue(value, column);
  if ((existing?.revision ?? null) !== input.revision) throw conflict("STALE_GRADE", "Điểm đã thay đổi. Vui lòng tải lại.");
  try {
    const result = await prisma.$transaction(async (tx) => {
      let record;
      if (existing) {
        const locked = await tx.gradeRecord.updateMany({ where: { id: existing.id, revision: input.revision! }, data: { value, revision: { increment: 1 } } });
        if (locked.count !== 1) throw conflict("STALE_GRADE", "Điểm đã được yêu cầu khác thay đổi.");
        record = await tx.gradeRecord.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        record = await tx.gradeRecord.create({ data: { studentId: input.studentId, classId: input.classId, semesterId: input.semesterId, gradeColumnId: input.gradeColumnId, value } });
      }
      await tx.gradeAuditEntry.create({ data: { gradeRecordId: record.id, actorId, requestId: input.requestId, fingerprint: requestFingerprint, beforeValue: existing?.value, afterValue: value, beforeRevision: existing?.revision, afterRevision: record.revision } });
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    response.json({ data: result });
  } catch (error) {
    const winner = await prisma.gradeAuditEntry.findUnique({ where: { requestId: input.requestId }, include: { gradeRecord: true } });
    if (winner?.fingerprint === requestFingerprint) { response.json({ data: winner.gradeRecord }); return; }
    if (winner) throw conflict("IDEMPOTENCY_KEY_REUSED", "Mã yêu cầu đã được dùng cho nội dung khác.");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("STALE_GRADE", "Điểm đã được yêu cầu khác thay đổi.");
    }
    throw error;
  }
}));

adminGradeRouter.get("/audit", asyncHandler(async (request, response) => {
  const query = reportQuerySchema.parse(request.query);
  const where: Prisma.GradeAuditEntryWhereInput = { gradeRecord: { studentId: query.studentId, classId: query.classId, semesterId: query.semesterId, semester: query.academicYearId ? { academicYearId: query.academicYearId } : undefined } };
  const [items, total] = await prisma.$transaction([
    prisma.gradeAuditEntry.findMany({ where, include: { actor: { select: { id: true, displayName: true } }, gradeRecord: { include: { student: true, gradeColumn: true } } }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.gradeAuditEntry.count({ where })
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}));

adminGradeRouter.post("/rules", asyncHandler(async (request, response) => {
  const input = ruleDraftSchema.parse(request.body);
  await requireScope(input.classId, input.semesterId, true);
  const columnIds = input.weights.map((item) => item.gradeColumnId);
  if (new Set(columnIds).size !== columnIds.length) throw new ApiError(422, "DUPLICATE_RULE_COLUMN", "Mỗi cột điểm chỉ được khai báo một lần.");
  const columns = await prisma.gradeColumn.findMany({ where: { id: { in: columnIds }, classId: input.classId, semesterId: input.semesterId } });
  if (columns.length !== columnIds.length) throw conflict("RULE_COLUMN_SCOPE_MISMATCH", "Tất cả cột điểm phải thuộc phạm vi quy tắc.");
  const weights = input.weights.map((item) => ({ ...item, decimal: new D(item.weight) }));
  if (weights.some((item) => item.decimal.lessThanOrEqualTo(0))) throw new ApiError(422, "INVALID_WEIGHT", "Trọng số phải lớn hơn 0.");
  const bandValues = input.bands.map((item) => new D(item.minimumInclusive));
  if (new Set(bandValues.map(String)).size !== bandValues.length) throw new ApiError(422, "DUPLICATE_THRESHOLD", "Ngưỡng xếp loại không được trùng.");
  const totalWeight = weights.reduce((sum, item) => sum.plus(item.decimal), new D(0));
  const byId = new Map(columns.map((item) => [item.id, item]));
  const possibleMin = round(weights.reduce((sum, item) => sum.plus(byId.get(item.gradeColumnId)!.minimum.times(item.decimal)), new D(0)).div(totalWeight), input.decimalPlaces, input.roundingMethod);
  const possibleMax = round(weights.reduce((sum, item) => sum.plus(byId.get(item.gradeColumnId)!.maximum.times(item.decimal)), new D(0)).div(totalWeight), input.decimalPlaces, input.roundingMethod);
  if (bandValues.some((item) => item.lessThan(possibleMin) || item.greaterThan(possibleMax)) || !bandValues.some((item) => item.lessThanOrEqualTo(possibleMin))) {
    throw new ApiError(422, "INVALID_THRESHOLDS", "Ngưỡng phải nằm trong miền điểm có thể tính và bao phủ mức tối thiểu.");
  }
  const latest = await prisma.classificationRuleVersion.aggregate({ where: { classId: input.classId, semesterId: input.semesterId }, _max: { version: true } });
  const item = await prisma.$transaction(async (tx) => tx.classificationRuleVersion.create({ data: {
    classId: input.classId, semesterId: input.semesterId, version: (latest._max.version ?? 0) + 1,
    decimalPlaces: input.decimalPlaces, roundingMethod: input.roundingMethod,
    weights: { create: weights.map((item) => ({ gradeColumnId: item.gradeColumnId, weight: item.decimal })) },
    bands: { create: input.bands.map((item) => ({ minimumInclusive: new D(item.minimumInclusive), label: item.label })) }
  }, include: ruleInclude }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("RULE_VERSION_CONFLICT", "Phiên bản quy tắc đã được yêu cầu khác tạo.");
    throw error;
  });
  response.status(201).json({ data: item });
}));

adminGradeRouter.get("/rules", asyncHandler(async (request, response) => {
  const scope = scopeQuerySchema.parse(request.query);
  await requireScope(scope.classId, scope.semesterId);
  const items = await prisma.classificationRuleVersion.findMany({ where: scope, include: ruleInclude, orderBy: { version: "desc" }, take: 100 });
  response.json({ data: { items, total: items.length } });
}));

adminGradeRouter.post("/rules/:id/publish", asyncHandler(async (request, response) => {
  const actorId = request.auth!.userId;
  const { id } = idParamsSchema.parse(request.params);
  const input = publishSchema.parse(request.body);
  const rule = await prisma.classificationRuleVersion.findUnique({ where: { id }, include: ruleInclude });
  if (!rule) throw notFound("phiên bản quy tắc");
  if (rule.status === ClassificationRuleStatus.PUBLISHED) { response.json({ data: rule }); return; }
  await requireScope(rule.classId, rule.semesterId, true);
  if (rule.weights.length === 0 || rule.bands.length === 0) throw conflict("RULE_INCOMPLETE", "Quy tắc chưa đủ trọng số và ngưỡng.");
  const updated = await prisma.classificationRuleVersion.updateMany({ where: { id, status: ClassificationRuleStatus.DRAFT, revision: input.revision }, data: { status: ClassificationRuleStatus.PUBLISHED, publishedAt: new Date(), publishedById: actorId, revision: { increment: 1 } } });
  if (updated.count !== 1) throw conflict("STALE_RULE", "Quy tắc đã thay đổi hoặc đã được publish.");
  response.json({ data: await prisma.classificationRuleVersion.findUniqueOrThrow({ where: { id }, include: ruleInclude }) });
}));

function round(value: Prisma.Decimal, places: number, method: GradeRoundingMethod) {
  const modes = {
    HALF_UP: D.ROUND_HALF_UP, HALF_EVEN: D.ROUND_HALF_EVEN, DOWN: D.ROUND_DOWN, UP: D.ROUND_UP
  } as const;
  return value.toDecimalPlaces(places, modes[method]);
}

adminGradeRouter.post("/calculate", asyncHandler(async (request, response) => {
  const actorId = request.auth!.userId;
  const input = calculateSchema.parse(request.body);
  await requireScope(input.classId, input.semesterId);
  const replay = await prisma.classificationResult.findUnique({ where: { requestId: input.requestId }, include: { ruleVersion: true } });
  if (replay) {
    if (replay.studentId === input.studentId && replay.classId === input.classId && replay.semesterId === input.semesterId) { response.json({ data: { status: "CALCULATED", result: replay } }); return; }
    throw conflict("IDEMPOTENCY_KEY_REUSED", "Mã yêu cầu đã được dùng cho phạm vi khác.");
  }
  const enrollment = await prisma.enrollment.findFirst({ where: { studentId: input.studentId, classId: input.classId, endedAt: null } });
  if (!enrollment) throw conflict("STUDENT_NOT_ENROLLED", "Học sinh không thuộc Lớp đã chọn.");
  const rule = await prisma.classificationRuleVersion.findFirst({ where: { classId: input.classId, semesterId: input.semesterId, status: ClassificationRuleStatus.PUBLISHED }, include: ruleInclude, orderBy: { version: "desc" } });
  if (!rule) { response.json({ data: { status: "NOT_CALCULATED", reasons: [{ code: "MISSING_PUBLISHED_RULE", message: "Chưa có quy tắc đã publish cho Lớp và Học kỳ này." }] } }); return; }
  const grades = await prisma.gradeRecord.findMany({ where: { studentId: input.studentId, classId: input.classId, semesterId: input.semesterId, gradeColumnId: { in: rule.weights.map((item) => item.gradeColumnId) } } });
  const byColumn = new Map(grades.map((item) => [item.gradeColumnId, item]));
  const missing = rule.weights.filter((item) => !byColumn.has(item.gradeColumnId));
  if (missing.length) {
    response.json({ data: { status: "NOT_CALCULATED", reasons: missing.map((item) => ({ code: "MISSING_GRADE", gradeColumnId: item.gradeColumnId, gradeColumnName: item.gradeColumn.name, message: `Thiếu điểm ${item.gradeColumn.name}.` })) } }); return;
  }
  const totalWeight = rule.weights.reduce((sum, item) => sum.plus(item.weight), new D(0));
  const weightedAverage = rule.weights.reduce((sum, item) => sum.plus(byColumn.get(item.gradeColumnId)!.value.times(item.weight)), new D(0)).div(totalWeight);
  const roundedAverage = round(weightedAverage, rule.decimalPlaces, rule.roundingMethod);
  const band = rule.bands.find((item) => roundedAverage.greaterThanOrEqualTo(item.minimumInclusive));
  if (!band) { response.json({ data: { status: "NOT_CALCULATED", reasons: [{ code: "NO_MATCHING_THRESHOLD", message: "Không có ngưỡng xếp loại phù hợp." }] } }); return; }
  const snapshot = rule.weights.map((item) => ({ gradeColumnId: item.gradeColumnId, name: item.gradeColumn.name, grade: byColumn.get(item.gradeColumnId)!.value.toFixed(), gradeRevision: byColumn.get(item.gradeColumnId)!.revision, weight: item.weight.toFixed() }));
  const inputFingerprint = fingerprint({ ruleVersionId: rule.id, snapshot });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const latest = await tx.classificationResult.aggregate({ where: { studentId: input.studentId, classId: input.classId, semesterId: input.semesterId }, _max: { resultRevision: true } });
      return tx.classificationResult.create({ data: { studentId: input.studentId, classId: input.classId, semesterId: input.semesterId, ruleVersionId: rule.id, resultRevision: (latest._max.resultRevision ?? 0) + 1, weightedAverage, roundedAverage, classificationLabel: band.label, inputSnapshot: snapshot, inputFingerprint, requestId: input.requestId, actorId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    response.status(201).json({ data: { status: "CALCULATED", result } });
  } catch (error) {
    const winner = await prisma.classificationResult.findUnique({ where: { requestId: input.requestId } });
    if (winner) {
      if (winner.studentId === input.studentId && winner.classId === input.classId && winner.semesterId === input.semesterId && winner.inputFingerprint === inputFingerprint) {
        response.json({ data: { status: "CALCULATED", result: winner } }); return;
      }
      throw conflict("IDEMPOTENCY_KEY_REUSED", "Mã yêu cầu đã được dùng cho phạm vi hoặc dữ liệu khác.");
    }
    throw error;
  }
}));

adminGradeRouter.get("/results", asyncHandler(async (request, response) => {
  const query = reportQuerySchema.parse(request.query);
  const where: Prisma.ClassificationResultWhereInput = { studentId: query.studentId, classId: query.classId, semesterId: query.semesterId, semester: query.academicYearId ? { academicYearId: query.academicYearId } : undefined };
  const [items, total] = await prisma.$transaction([
    prisma.classificationResult.findMany({ where, include: { student: true, ruleVersion: true, catechismClass: true, semester: { include: { academicYear: true } } }, orderBy: [{ createdAt: "desc" }, { resultRevision: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.classificationResult.count({ where })
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}));


