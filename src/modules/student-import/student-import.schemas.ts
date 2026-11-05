import { z } from "zod";

const id = z.string().min(1).max(30);

export const importIdParamsSchema = z.object({ id });

export const previewFieldsSchema = z.object({
  classId: id,
  saintNameColumn: z.string().trim().min(1).max(120),
  fullNameColumn: z.string().trim().min(1).max(120)
}).refine((value) => value.saintNameColumn !== value.fullNameColumn, {
  message: "Hai trường không thể dùng cùng một cột.",
  path: ["fullNameColumn"]
});

export const confirmImportSchema = z.object({
  requestId: z.string().trim().min(8).max(64),
  revision: z.number().int().min(0),
  resolutions: z.array(z.object({
    rowId: id,
    resolution: z.enum(["CREATE_SEPARATE", "EXCLUDE"])
  })).max(1000)
});

export const importListSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

