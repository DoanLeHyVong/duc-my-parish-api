import { z } from "zod";

const id = z.string().min(1).max(30);
const requestId = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9._:-]+$/);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}, "Ngày không hợp lệ.");
const instant = z.string()
  .regex(/(?:Z|[+-]\d{2}:\d{2})$/i, "Thời gian phải có múi giờ.")
  .refine((value) => Number.isFinite(Date.parse(value)), "Thời gian không hợp lệ.");
const activityType = z.enum(["TUESDAY_MASS", "THURSDAY_MASS", "SUNDAY_MASS", "CATECHISM_LESSON"]);
const state = z.enum(["NOT_MARKED", "PRESENT", "ABSENT"]);

export const idParamsSchema = z.object({ id });

const templateCoreSchema = z.object({
  classId: id,
  activityType,
  weekday: z.coerce.number().int().min(0).max(6),
  occurrenceMinute: z.coerce.number().int().min(0).max(1439),
  utcOffsetMinutes: z.coerce.number().int().min(-720).max(840),
  windowOpenOffsetMinutes: z.coerce.number().int().min(-1440).max(1440),
  windowCloseOffsetMinutes: z.coerce.number().int().min(-1440).max(1440),
  effectiveStart: dateOnly,
  effectiveEnd: dateOnly
});

type TemplateRuleInput = Omit<z.infer<typeof templateCoreSchema>, "classId">;

function validateTemplate(value: TemplateRuleInput, context: z.RefinementCtx) {
  if (value.effectiveEnd < value.effectiveStart) {
    context.addIssue({ code: "custom", path: ["effectiveEnd"], message: "Ngày kết thúc phải từ ngày bắt đầu trở đi." });
  }
  if (value.windowCloseOffsetMinutes <= value.windowOpenOffsetMinutes) {
    context.addIssue({ code: "custom", path: ["windowCloseOffsetMinutes"], message: "Thời gian kết thúc phải sau thời gian bắt đầu." });
  }
  const requiredWeekday = value.activityType === "TUESDAY_MASS" ? 2 : value.activityType === "THURSDAY_MASS" ? 4 : value.activityType === "SUNDAY_MASS" ? 0 : null;
  if (requiredWeekday !== null && value.weekday !== requiredWeekday) {
    context.addIssue({ code: "custom", path: ["weekday"], message: "Thứ trong tuần không khớp loại Thánh lễ." });
  }
}

export const templateSchema = templateCoreSchema.superRefine(validateTemplate);

export const templateUpdateSchema = templateCoreSchema.omit({ classId: true }).extend({
  revision: z.coerce.number().int().min(0)
}).superRefine(validateTemplate);

export const generateSchema = z.object({ fromDate: dateOnly, toDate: dateOnly }).superRefine((value, context) => {
  if (value.toDate < value.fromDate) {
    context.addIssue({ code: "custom", path: ["toDate"], message: "Ngày kết thúc phải từ ngày bắt đầu trở đi." });
  } else if (toUtcDay(value.toDate) - toUtcDay(value.fromDate) > 366 * 86_400_000) {
    context.addIssue({ code: "custom", path: ["toDate"], message: "Khoảng sinh phiên không được vượt quá 366 ngày." });
  }
});

function toUtcDay(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day);
}

export const exceptionSchema = z.object({
  type: z.enum(["CANCEL", "MOVE", "ADD"]),
  sessionId: id.optional(),
  classId: id.optional(),
  activityType: activityType.optional(),
  occursAt: instant.optional(),
  windowOpensAt: instant.optional(),
  windowClosesAt: instant.optional(),
  note: z.string().trim().max(500).optional()
}).superRefine((value, context) => {
  if ((value.type === "CANCEL" || value.type === "MOVE") && !value.sessionId) {
    context.addIssue({ code: "custom", path: ["sessionId"], message: "Phiên điểm danh là bắt buộc." });
  }
  if (value.type === "ADD" && (!value.classId || !value.activityType)) {
    context.addIssue({ code: "custom", path: ["classId"], message: "Lớp và loại hoạt động là bắt buộc." });
  }
  if (value.type === "MOVE" || value.type === "ADD") {
    if (!value.occursAt || !value.windowOpensAt || !value.windowClosesAt) {
      context.addIssue({ code: "custom", path: ["occursAt"], message: "Thời gian phiên và cửa sổ điểm danh là bắt buộc." });
    } else if (Date.parse(value.occursAt) <= Date.now()) {
      context.addIssue({ code: "custom", path: ["occursAt"], message: "Phiên điểm danh phải ở trong tương lai." });
    } else if (!(Date.parse(value.windowOpensAt) < Date.parse(value.windowClosesAt))) {
      context.addIssue({ code: "custom", path: ["windowClosesAt"], message: "Cửa sổ kết thúc phải sau lúc bắt đầu." });
    }
  }
});

export const saveSchema = z.object({
  requestId,
  revision: z.coerce.number().int().min(0),
  records: z.array(z.object({ studentId: id, state })).min(1).max(500)
}).superRefine((value, context) => {
  if (new Set(value.records.map((item) => item.studentId)).size !== value.records.length) {
    context.addIssue({ code: "custom", path: ["records"], message: "Học sinh bị lặp trong yêu cầu." });
  }
});

export const lifecycleSchema = z.object({ requestId, revision: z.coerce.number().int().min(0) });
export const revisionSchema = z.object({ revision: z.coerce.number().int().min(0) });
export const correctionSchema = z.object({
  requestId,
  state,
  reason: z.string().trim().min(2).max(500)
});

export const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  classId: id.optional(),
  activityType: activityType.optional(),
  status: z.enum(["OPEN", "SUBMITTED", "FINALIZED"]).optional(),
  from: instant.optional(),
  to: instant.optional()
});

