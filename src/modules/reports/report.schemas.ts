import { z } from "zod";

const id = z.string().trim().min(1).max(30);
const page = z.coerce.number().int().min(1).max(1_000_000).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const instant = z.string()
  .regex(/(?:Z|[+-]\d{2}:\d{2})$/i, "Thời gian phải có múi giờ.")
  .refine((value) => Number.isFinite(Date.parse(value)), "Thời gian không hợp lệ.");

const attendanceFilters = z.object({
  academicYearId: id.optional(),
  classId: id.optional(),
  activityType: z.enum(["TUESDAY_MASS", "THURSDAY_MASS", "SUNDAY_MASS", "CATECHISM_LESSON"]).optional(),
  from: instant.optional(),
  to: instant.optional()
}).superRefine((value, context) => {
  if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
    context.addIssue({ code: "custom", path: ["to"], message: "Thời gian kết thúc phải sau thời gian bắt đầu." });
  }
});

export const adminDashboardQuerySchema = z.object({ academicYearId: id });
export const teacherDashboardQuerySchema = z.object({ academicYearId: id.optional() });
export const attendanceReportQuerySchema = attendanceFilters;
export const pagedAttendanceReportQuerySchema = attendanceFilters.and(z.object({ page, limit }));

export const classificationReportQuerySchema = z.object({
  academicYearId: id,
  semesterId: id.optional(),
  classId: id.optional(),
  page,
  limit
});

export const classificationHistoryQuerySchema = z.object({
  studentId: id,
  classId: id,
  semesterId: id,
  page,
  limit
});

