import { createHash } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { AcademicStatus, Prisma, StudentImportEventType, StudentImportResolution, StudentImportRowStatus, StudentImportStatus } from "../../generated/prisma/client.js";
import { ApiError } from "../../lib/api-error.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { authorize, Permission } from "../../middleware/authorize.js";
import { MAX_IMPORT_BYTES, parseWorkbook } from "./student-import.parser.js";
import { confirmImportSchema, importIdParamsSchema, importListSchema, previewFieldsSchema } from "./student-import.schemas.js";

export const studentImportRouter = Router();
studentImportRouter.use(authenticate, authorize(Permission.APPGLV_MANAGE));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    const accepted = file.originalname.toLocaleLowerCase().endsWith(".xlsx") &&
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"].includes(file.mimetype);
    if (!accepted) {
      callback(new ApiError(415, "XLSX_REQUIRED", "Chỉ chấp nhận file .xlsx."));
      return;
    }
    callback(null, true);
  }
});

const conflict = (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details);
const notFound = () => new ApiError(404, "IMPORT_NOT_FOUND", "Không tìm thấy lần import.");
const normalize = (value: string) => value.trim().toLocaleLowerCase("vi-VN");
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function requiredFile(file?: Express.Multer.File) {
  if (!file) throw new ApiError(422, "FILE_REQUIRED", "Vui lòng chọn file .xlsx.");
  return file;
}

async function requireOpenClass(classId: string) {
  const item = await prisma.catechismClass.findUnique({ where: { id: classId }, include: { academicYear: true } });
  if (!item) throw new ApiError(404, "CLASS_NOT_FOUND", "Không tìm thấy Lớp.");
  if (item.status !== AcademicStatus.OPEN || item.academicYear.status !== AcademicStatus.OPEN) {
    throw conflict("CLASS_CLOSED", "Chỉ có thể import vào Lớp thuộc Năm học đang mở.");
  }
  return item;
}

async function batchPayload(id: string) {
  const batch = await prisma.studentImportBatch.findUnique({
    where: { id },
    include: {
      actor: { select: { id: true, displayName: true } },
      catechismClass: { include: { academicYear: true } },
      rows: { orderBy: { rowNumber: "asc" } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, displayName: true } } } }
    }
  });
  if (!batch) throw notFound();
  const candidateIds = [...new Set(batch.rows.flatMap((row) => Array.isArray(row.candidateStudentIds) ? row.candidateStudentIds.filter((id): id is string => typeof id === "string") : []))];
  const candidates = candidateIds.length === 0 ? [] : await prisma.student.findMany({
    where: { id: { in: candidateIds } }, select: { id: true, saintName: true, fullName: true }
  });
  const byId = new Map(candidates.map((student) => [student.id, student]));
  return {
    ...batch,
    rows: batch.rows.map((row) => ({
      ...row,
      candidates: (Array.isArray(row.candidateStudentIds) ? row.candidateStudentIds : []).map((id) => byId.get(String(id))).filter(Boolean)
    }))
  };
}

studentImportRouter.post("/headers", upload.single("file"), asyncHandler(async (request, response) => {
  const file = requiredFile(request.file);
  const parsed = await parseWorkbook(file.buffer);
  response.json({ data: { fileName: file.originalname, fileSize: file.size, fileSha256: sha256(file.buffer), headers: parsed.headers, rowCount: parsed.rows.length } });
}));

studentImportRouter.post("/preview", upload.single("file"), asyncHandler(async (request, response) => {
  const actorId = request.auth!.userId;
  const file = requiredFile(request.file);
  const fields = previewFieldsSchema.parse(request.body);
  const targetClass = await requireOpenClass(fields.classId);
  const parsed = await parseWorkbook(file.buffer);
  for (const column of [fields.saintNameColumn, fields.fullNameColumn]) {
    if (!parsed.headers.includes(column)) throw new ApiError(422, "COLUMN_NOT_FOUND", `Không tìm thấy cột: ${column}.`);
  }

  const fileSha256 = sha256(file.buffer);
  const mapping = { saintName: fields.saintNameColumn, fullName: fields.fullNameColumn };
  const mappingKey = sha256(JSON.stringify(mapping));
  const completed = await prisma.studentImportBatch.findFirst({
    where: { fileSha256, classId: fields.classId, mappingKey, status: StudentImportStatus.COMPLETED },
    orderBy: { completedAt: "desc" }
  });
  if (completed) throw conflict("IMPORT_ALREADY_COMPLETED", "File này đã được import vào Lớp đã chọn với cùng mapping.", { batchId: completed.id });
  const existingPreview = await prisma.studentImportBatch.findFirst({
    where: { fileSha256, classId: fields.classId, mappingKey, status: StudentImportStatus.PREVIEW_READY },
    orderBy: { createdAt: "desc" }
  });
  if (existingPreview) {
    response.json({ data: await batchPayload(existingPreview.id) });
    return;
  }

  const existingStudents = await prisma.student.findMany({ select: { id: true, saintName: true, fullName: true } });
  const existingByName = new Map<string, string[]>();
  for (const student of existingStudents) {
    const key = `${normalize(student.saintName)}\u0000${normalize(student.fullName)}`;
    existingByName.set(key, [...(existingByName.get(key) ?? []), student.id]);
  }
  const sourceGroups = new Map<string, number[]>();
  for (const row of parsed.rows) {
    const saintName = row.values.get(fields.saintNameColumn)?.trim() ?? "";
    const fullName = row.values.get(fields.fullNameColumn)?.trim() ?? "";
    if (saintName && fullName) {
      const key = `${normalize(saintName)}\u0000${normalize(fullName)}`;
      sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), row.rowNumber]);
    }
  }

  const prepared = parsed.rows.map((row) => {
    const saintName = row.values.get(fields.saintNameColumn)?.trim() ?? "";
    const fullName = row.values.get(fields.fullNameColumn)?.trim() ?? "";
    const errors: Array<{ field: string; message: string }> = [];
    if (!saintName) errors.push({ field: "saintName", message: "Tên Thánh là bắt buộc." });
    else if (saintName.length > 120) errors.push({ field: "saintName", message: "Tên Thánh tối đa 120 ký tự." });
    if (!fullName) errors.push({ field: "fullName", message: "Họ tên là bắt buộc." });
    else if (fullName.length < 2 || fullName.length > 180) errors.push({ field: "fullName", message: "Họ tên phải từ 2 đến 180 ký tự." });
    const key = saintName && fullName ? `${normalize(saintName)}\u0000${normalize(fullName)}` : "";
    const candidateStudentIds = errors.length === 0 ? (existingByName.get(key) ?? []) : [];
    const candidateRowNumbers = key ? (sourceGroups.get(key) ?? []).filter((number) => number !== row.rowNumber) : [];
    const possibleDuplicate = errors.length === 0 && (candidateStudentIds.length > 0 || candidateRowNumbers.length > 0);
    return {
      rowNumber: row.rowNumber,
      saintName: saintName || null,
      fullName: fullName || null,
      status: errors.length > 0 ? StudentImportRowStatus.INVALID : possibleDuplicate ? StudentImportRowStatus.POSSIBLE_DUPLICATE : StudentImportRowStatus.VALID,
      validationErrors: errors.length > 0 ? errors : Prisma.JsonNull,
      candidateStudentIds: candidateStudentIds.length > 0 ? candidateStudentIds : Prisma.JsonNull,
      candidateRowNumbers: candidateRowNumbers.length > 0 ? candidateRowNumbers : Prisma.JsonNull
    };
  });
  const counts = {
    totalRows: prepared.length,
    validRows: prepared.filter((row) => row.status === StudentImportRowStatus.VALID).length,
    invalidRows: prepared.filter((row) => row.status === StudentImportRowStatus.INVALID).length,
    possibleDuplicateRows: prepared.filter((row) => row.status === StudentImportRowStatus.POSSIBLE_DUPLICATE).length
  };
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.studentImportBatch.create({ data: {
      actorId, classId: targetClass.id, fileName: file.originalname, fileSize: file.size, fileSha256, mappingKey, mapping, ...counts,
      rows: { create: prepared }
    } });
    await tx.studentImportEvent.create({ data: { batchId: created.id, actorId, type: StudentImportEventType.PREVIEW_CREATED, details: counts } });
    return created;
  });
  response.status(201).json({ data: await batchPayload(batch.id) });
}));

studentImportRouter.post("/:id/confirm", asyncHandler(async (request, response) => {
  const actorId = request.auth!.userId;
  const { id } = importIdParamsSchema.parse(request.params);
  const input = confirmImportSchema.parse(request.body);
  const fingerprint = sha256(JSON.stringify({
    batchId: id,
    revision: input.revision,
    resolutions: [...input.resolutions].sort((a, b) => a.rowId.localeCompare(b.rowId))
  }));
  const replay = await prisma.studentImportBatch.findUnique({ where: { confirmationRequestId: input.requestId } });
  if (replay) {
    if (replay.id === id && replay.confirmationFingerprint === fingerprint && replay.status === StudentImportStatus.COMPLETED) {
      response.json({ data: await batchPayload(id) });
      return;
    }
    throw conflict("IDEMPOTENCY_KEY_REUSED", "Mã yêu cầu đã được dùng cho nội dung khác.");
  }

  const batch = await prisma.studentImportBatch.findUnique({ where: { id }, include: { rows: true, catechismClass: { include: { academicYear: true } } } });
  if (!batch) throw notFound();
  if (batch.status === StudentImportStatus.COMPLETED) throw conflict("IMPORT_ALREADY_COMPLETED", "Lần import này đã hoàn tất.");
  if (batch.status === StudentImportStatus.FAILED) throw conflict("IMPORT_FAILED", "Lần import này đã thất bại. Vui lòng tạo preview mới.");
  if (batch.revision !== input.revision) throw conflict("STALE_IMPORT", "Preview đã thay đổi. Vui lòng tải lại.");
  if (batch.invalidRows > 0) throw conflict("INVALID_ROWS_REMAIN", "Hãy sửa file và tạo preview mới vì vẫn còn dòng không hợp lệ.");
  if (batch.catechismClass.status !== AcademicStatus.OPEN || batch.catechismClass.academicYear.status !== AcademicStatus.OPEN) {
    throw conflict("CLASS_CLOSED", "Lớp hoặc Năm học đã đóng.");
  }
  const candidates = batch.rows.filter((row) => row.status === StudentImportRowStatus.POSSIBLE_DUPLICATE);
  const resolutionMap = new Map(input.resolutions.map((item) => [item.rowId, item.resolution as StudentImportResolution]));
  if (input.resolutions.some((item) => !candidates.some((row) => row.id === item.rowId)) || candidates.some((row) => !resolutionMap.has(row.id))) {
    throw conflict("DUPLICATE_RESOLUTION_REQUIRED", "Mỗi dòng nghi trùng phải được chọn Tạo học sinh riêng hoặc Loại khỏi batch.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const completedDuplicate = await tx.studentImportBatch.findFirst({
        where: {
          id: { not: id }, fileSha256: batch.fileSha256, classId: batch.classId,
          mappingKey: batch.mappingKey, status: StudentImportStatus.COMPLETED
        },
        select: { id: true }
      });
      if (completedDuplicate) throw conflict("IMPORT_ALREADY_COMPLETED", "File này đã được import vào Lớp đã chọn với cùng mapping.", { batchId: completedDuplicate.id });

      const lockedYear = await tx.academicYear.updateMany({
        where: { id: batch.catechismClass.academicYearId, status: AcademicStatus.OPEN },
        data: { updatedAt: new Date() }
      });
      const lockedClass = await tx.catechismClass.updateMany({
        where: { id: batch.classId, status: AcademicStatus.OPEN },
        data: { updatedAt: new Date() }
      });
      if (lockedYear.count !== 1 || lockedClass.count !== 1) throw conflict("CLASS_CLOSED", "Lớp hoặc Năm học đã đóng.");

      const locked = await tx.studentImportBatch.updateMany({
        where: { id, status: StudentImportStatus.PREVIEW_READY, revision: input.revision },
        data: { revision: { increment: 1 } }
      });
      if (locked.count !== 1) throw conflict("STALE_IMPORT", "Preview đã được xử lý bởi yêu cầu khác.");
      const currentStudents = await tx.student.findMany({ select: { id: true, saintName: true, fullName: true } });
      const currentByName = new Map<string, string[]>();
      for (const student of currentStudents) {
        const key = `${normalize(student.saintName)}\u0000${normalize(student.fullName)}`;
        currentByName.set(key, [...(currentByName.get(key) ?? []), student.id]);
      }
      for (const row of batch.rows) {
        const resolution = row.status === StudentImportRowStatus.POSSIBLE_DUPLICATE ? resolutionMap.get(row.id)! : StudentImportResolution.CREATE_SEPARATE;
        if (resolution === StudentImportResolution.EXCLUDE) continue;
        const knownIds = new Set(Array.isArray(row.candidateStudentIds) ? row.candidateStudentIds.map(String) : []);
        const currentIds = currentByName.get(`${normalize(row.saintName!)}\u0000${normalize(row.fullName!)}`) ?? [];
        if (currentIds.some((candidateId) => !knownIds.has(candidateId))) {
          throw conflict("STALE_DUPLICATE_PREVIEW", `Dòng ${row.rowNumber} có kết quả nghi trùng mới. Vui lòng tạo preview lại.`);
        }
      }
      let createdStudents = 0;
      let excludedRows = 0;
      for (const row of batch.rows) {
        const resolution = row.status === StudentImportRowStatus.POSSIBLE_DUPLICATE ? resolutionMap.get(row.id)! : StudentImportResolution.CREATE_SEPARATE;
        if (resolution === StudentImportResolution.EXCLUDE) {
          excludedRows += 1;
          await tx.studentImportRow.update({ where: { id: row.id }, data: { resolution } });
          continue;
        }
        const student = await tx.student.create({ data: { saintName: row.saintName!, fullName: row.fullName! } });
        await tx.enrollment.create({ data: {
          studentId: student.id,
          classId: batch.classId,
          academicYearId: batch.catechismClass.academicYearId,
          currentKey: `${student.id}:${batch.catechismClass.academicYearId}`
        } });
        await tx.studentImportRow.update({ where: { id: row.id }, data: { resolution, createdStudentId: student.id } });
        createdStudents += 1;
      }
      await tx.studentImportBatch.update({ where: { id }, data: {
        status: StudentImportStatus.COMPLETED,
        confirmationRequestId: input.requestId,
        confirmationFingerprint: fingerprint,
        createdStudents,
        excludedRows,
        failureCode: null,
        failureMessage: null,
        completedAt: new Date()
      } });
      await tx.studentImportEvent.create({ data: {
        batchId: id, actorId, type: StudentImportEventType.CONFIRMED, details: { createdStudents, excludedRows }
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const winner = await prisma.studentImportBatch.findUnique({ where: { confirmationRequestId: input.requestId } });
    if (winner?.id === id && winner.confirmationFingerprint === fingerprint) {
      response.json({ data: await batchPayload(id) });
      return;
    }
    if (winner) throw conflict("IDEMPOTENCY_KEY_REUSED", "Mã yêu cầu đã được dùng cho nội dung khác.");
    await prisma.$transaction(async (tx) => {
      const updated = await tx.studentImportBatch.updateMany({
        where: { id, status: StudentImportStatus.PREVIEW_READY },
        data: { failureCode: "TRANSACTION_FAILED", failureMessage: "Không thể hoàn tất transaction import; có thể thử lại." }
      });
      if (updated.count === 1) {
        await tx.studentImportEvent.create({ data: { batchId: id, actorId, type: StudentImportEventType.FAILED, details: { code: "TRANSACTION_FAILED", retryable: true } } });
      }
    });
    throw error;
  }
  response.json({ data: await batchPayload(id) });
}));

studentImportRouter.get("/", asyncHandler(async (request, response) => {
  const query = importListSchema.parse(request.query);
  const [items, total] = await prisma.$transaction([
    prisma.studentImportBatch.findMany({
      orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit,
      include: { actor: { select: { id: true, displayName: true } }, catechismClass: { include: { academicYear: true } } }
    }),
    prisma.studentImportBatch.count()
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}));

studentImportRouter.get("/:id", asyncHandler(async (request, response) => {
  const { id } = importIdParamsSchema.parse(request.params);
  response.json({ data: await batchPayload(id) });
}));


