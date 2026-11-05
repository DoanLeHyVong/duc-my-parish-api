import { z } from "zod";

const username = z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/);

export const listTeachersSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(["active", "locked", "all"]).default("all")
});

export const createTeacherSchema = z.object({
  username,
  displayName: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128)
});

export const updateTeacherSchema = z.object({
  username: username.optional(),
  displayName: z.string().trim().min(2).max(120).optional()
}).refine((value) => Object.keys(value).length > 0, "Cần có ít nhất một thay đổi.");

export const lockTeacherSchema = z.object({ locked: z.boolean() });
export const resetTeacherPasswordSchema = z.object({ newPassword: z.string().min(12).max(128) });
export const teacherIdSchema = z.object({ id: z.string().min(1).max(30) });

