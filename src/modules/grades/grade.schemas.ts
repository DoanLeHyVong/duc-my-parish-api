import { z } from "zod";

const id = z.string().trim().min(1).max(30);
const decimal = z.string().trim().regex(/^-?\d{1,12}(?:\.\d{1,6})?$/);
const requestId = z.string().trim().min(8).max(64);
const page = z.coerce.number().int().min(1).max(1000000).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

export const idParamsSchema = z.object({ id });

export const scopeQuerySchema = z.object({ classId: id, semesterId: id });

export const columnSchema = z.object({
  classId: id,
  semesterId: id,
  name: z.string().trim().min(1).max(120),
  minimum: decimal,
  maximum: decimal,
  precision: z.number().int().min(0).max(6)
});

export const columnUpdateSchema = z.object({
  revision: z.number().int().min(0),
  name: z.string().trim().min(1).max(120),
  minimum: decimal,
  maximum: decimal,
  precision: z.number().int().min(0).max(6)
});

export const gradeUpsertSchema = z.object({
  studentId: id,
  classId: id,
  semesterId: id,
  gradeColumnId: id,
  value: decimal,
  revision: z.number().int().min(0).nullable(),
  requestId
});

export const ruleDraftSchema = z.object({
  classId: id,
  semesterId: id,
  decimalPlaces: z.number().int().min(0).max(6),
  roundingMethod: z.enum(["HALF_UP", "HALF_EVEN", "DOWN", "UP"]),
  weights: z.array(z.object({ gradeColumnId: id, weight: decimal })).min(1).max(100),
  bands: z.array(z.object({ minimumInclusive: decimal, label: z.string().trim().min(1).max(120) })).min(1).max(100)
});

export const publishSchema = z.object({ revision: z.number().int().min(0) });

export const calculateSchema = z.object({
  studentId: id,
  classId: id,
  semesterId: id,
  requestId
});

export const reportQuerySchema = z.object({
  studentId: id.optional(),
  classId: id.optional(),
  semesterId: id.optional(),
  academicYearId: id.optional(),
  page,
  limit
}).refine((value) => value.studentId || value.classId || value.semesterId || value.academicYearId, {
  message: "Cần ít nhất một bộ lọc phạm vi."
});

