import { z } from "zod";

const id = z.string().min(1).max(30);
const name = z.string().trim().min(2).max(120);
const page = z.coerce.number().int().min(1).max(1000000).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

export const idParamsSchema = z.object({ id });
export const yearChildParamsSchema = z.object({ id, childId: id.optional() });
export const listSchema = z.object({
  page,
  limit,
  search: z.string().trim().max(180).optional(),
  status: z.enum(["OPEN", "CLOSED", "ALL"]).default("ALL"),
  academicYearId: id.optional()
});
export const createNamedSchema = z.object({ name });
export const updateNamedSchema = z.object({ name });
export const createClassSchema = z.object({ name, academicYearId: id });
export const studentSchema = z.object({
  saintName: z.string().trim().min(1).max(120),
  fullName: z.string().trim().min(2).max(180)
});
export const enrollmentSchema = z.object({ studentId: id });
export const transferSchema = z.object({ classId: id });
export const assignmentSchema = z.object({ teacherId: id });

