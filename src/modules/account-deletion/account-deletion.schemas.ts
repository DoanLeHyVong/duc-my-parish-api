import { z } from "zod";

const id = z.string().trim().min(1).max(30);
const requestKey = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9._:-]+$/);
const reason = z.string().trim().min(3).max(1_000);

export const retentionCategorySchema = z.enum([
  "TEACHER_ASSIGNMENTS",
  "SCHEDULE_ADMINISTRATION",
  "ATTENDANCE_HISTORY",
  "IMPORT_HISTORY",
  "GRADE_HISTORY",
  "CLASSIFICATION_HISTORY",
  "ACCOUNT_DELETION_AUDIT"
]);

export type RetentionCategory = z.infer<typeof retentionCategorySchema>;

export const submitDeletionRequestSchema = z.object({
  requestKey,
  currentPassword: z.string().min(1).max(128),
  confirmation: z.literal("XÓA TÀI KHOẢN")
});

export const ownRequestListSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export const adminRequestListSchema = ownRequestListSchema.extend({
  status: z.enum(["SUBMITTED", "IN_REVIEW", "VERIFIED", "APPROVED", "REJECTED", "EXECUTED"]).optional()
});

export const deletionRequestParamsSchema = z.object({ id });

export const transitionDeletionRequestSchema = z.object({
  action: z.enum(["START_REVIEW", "VERIFY", "APPROVE", "REJECT", "EXECUTE"]),
  revision: z.coerce.number().int().min(1),
  reason,
  retentionDecisions: z.array(z.object({
    category: retentionCategorySchema,
    basis: z.string().trim().min(10).max(1_000)
  })).max(7).optional()
}).superRefine((value, context) => {
  if (value.action === "EXECUTE" && !value.retentionDecisions) {
    context.addIssue({ code: "custom", path: ["retentionDecisions"], message: "Phải khai báo căn cứ lưu giữ cho từng nhóm dữ liệu liên quan." });
  }
  if (value.retentionDecisions && new Set(value.retentionDecisions.map((item) => item.category)).size !== value.retentionDecisions.length) {
    context.addIssue({ code: "custom", path: ["retentionDecisions"], message: "Nhóm dữ liệu lưu giữ không được lặp." });
  }
});

