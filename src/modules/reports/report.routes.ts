import { Router, type Request } from "express";
import {
  AttendanceSessionStatus,
  AttendanceState,
  Prisma
} from "../../generated/prisma/client.js";
import { ApiError } from "../../lib/api-error.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { authorize, isTeacherScope, Permission } from "../../middleware/authorize.js";
import {
  adminDashboardQuerySchema,
  attendanceReportQuerySchema,
  classificationHistoryQuerySchema,
  classificationReportQuerySchema,
  pagedAttendanceReportQuerySchema,
  teacherDashboardQuerySchema
} from "./report.schemas.js";

export const adminReportRouter = Router();
export const teacherReportRouter = Router();
adminReportRouter.use(authenticate, authorize(Permission.APPGLV_MANAGE));
teacherReportRouter.use(authenticate, authorize(Permission.APPGLV_TEACH));

const notFound = (entity: string) => new ApiError(404, "NOT_FOUND", `Không tìm thấy ${entity}.`);
const invalidScope = (message: string) => new ApiError(409, "REPORT_SCOPE_MISMATCH", message);

type AttendanceFilters = {
  academicYearId?: string;
  classId?: string;
  activityType?: "TUESDAY_MASS" | "THURSDAY_MASS" | "SUNDAY_MASS" | "CATECHISM_LESSON";
  from?: string;
  to?: string;
};

async function validateAttendanceScope(filters: AttendanceFilters, teacherId?: string) {
  if (filters.academicYearId && !await prisma.academicYear.findUnique({ where: { id: filters.academicYearId }, select: { id: true } })) {
    throw notFound("Năm học");
  }
  if (filters.classId) {
    const item = await prisma.catechismClass.findUnique({ where: { id: filters.classId }, select: { academicYearId: true } });
    if (!item) throw notFound("Lớp");
    if (filters.academicYearId && item.academicYearId !== filters.academicYearId) {
      throw invalidScope("Lớp không thuộc Năm học đã chọn.");
    }
    if (teacherId && !await prisma.teacherAssignment.findUnique({ where: { currentKey: `${teacherId}:${filters.classId}` }, select: { id: true } })) {
      throw new ApiError(403, "FORBIDDEN", "Bạn không được phân công vào Lớp này.");
    }
  }
}

function attendanceWhere(filters: AttendanceFilters, teacherId?: string): Prisma.AttendanceSessionWhereInput {
  return {
    isCancelled: false,
    ...(filters.classId ? { classId: filters.classId } : {}),
    ...(filters.activityType ? { activityType: filters.activityType } : {}),
    ...(filters.from || filters.to ? { occursAt: {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {})
    } } : {}),
    catechismClass: {
      ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      ...(teacherId ? { assignments: { some: { teacherId, endedAt: null } } } : {})
    }
  };
}

async function attendanceSummary(where: Prisma.AttendanceSessionWhereInput) {
  const [sessions, records] = await Promise.all([
    prisma.attendanceSession.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.attendanceRecord.groupBy({ by: ["state"], where: { session: where }, _count: { _all: true } })
  ]);
  const lifecycle = { open: 0, submitted: 0, finalized: 0 };
  for (const item of sessions) {
    if (item.status === AttendanceSessionStatus.OPEN) lifecycle.open = item._count._all;
    else if (item.status === AttendanceSessionStatus.SUBMITTED) lifecycle.submitted = item._count._all;
    else lifecycle.finalized = item._count._all;
  }
  const marks = { present: 0, absent: 0, notMarked: 0 };
  for (const item of records) {
    if (item.state === AttendanceState.PRESENT) marks.present = item._count._all;
    else if (item.state === AttendanceState.ABSENT) marks.absent = item._count._all;
    else marks.notMarked = item._count._all;
  }
  const markedTotal = marks.present + marks.absent;
  return {
    lifecycle,
    marks,
    markedPercentage: markedTotal === 0 ? null : marks.present / markedTotal,
    markedPercentageStatus: markedTotal === 0 ? "INSUFFICIENT_DATA" : "AVAILABLE",
    percentageBasis: "MARKED_RECORDS_ONLY"
  };
}

async function attendanceBreakdown(where: Prisma.AttendanceSessionWhereInput) {
  const sessions = await prisma.attendanceSession.findMany({
    where,
    select: { activityType: true, records: { select: { state: true } } },
    orderBy: { occursAt: "desc" }
  });
  const result = new Map<string, { activityType: string; sessionCount: number; present: number; absent: number; notMarked: number }>();
  for (const session of sessions) {
    const item = result.get(session.activityType) ?? { activityType: session.activityType, sessionCount: 0, present: 0, absent: 0, notMarked: 0 };
    item.sessionCount += 1;
    for (const record of session.records) {
      if (record.state === AttendanceState.PRESENT) item.present += 1;
      else if (record.state === AttendanceState.ABSENT) item.absent += 1;
      else item.notMarked += 1;
    }
    result.set(session.activityType, item);
  }
  return [...result.values()].map((item) => {
    const denominator = item.present + item.absent;
    return { ...item, markedPercentage: denominator === 0 ? null : item.present / denominator };
  });
}

function latestScope(academicYearId: string, semesterId?: string, classId?: string) {
  return Prisma.sql`s.academicYearId = ${academicYearId}
    ${semesterId ? Prisma.sql`AND cr.semesterId = ${semesterId}` : Prisma.empty}
    ${classId ? Prisma.sql`AND cr.classId = ${classId}` : Prisma.empty}`;
}

async function latestClassificationDistribution(academicYearId: string, semesterId?: string, classId?: string) {
  const rows = await prisma.$queryRaw<Array<{ classificationLabel: string; total: bigint | number }>>(Prisma.sql`
    WITH latest AS (
      SELECT cr.classificationLabel,
        ROW_NUMBER() OVER (PARTITION BY cr.studentId, cr.classId, cr.semesterId ORDER BY cr.resultRevision DESC) AS rowNumber
      FROM classification_results cr
      JOIN semesters s ON s.id = cr.semesterId
      WHERE ${latestScope(academicYearId, semesterId, classId)}
    )
    SELECT classificationLabel, COUNT(*) AS total
    FROM latest WHERE rowNumber = 1 GROUP BY classificationLabel ORDER BY classificationLabel
  `);
  return Object.fromEntries(rows.map((item) => [item.classificationLabel, Number(item.total)]));
}

async function latestClassificationPage(academicYearId: string, semesterId: string | undefined, classId: string | undefined, page: number, limit: number) {
  const offset = (page - 1) * limit;
  const [ids, totals, distribution] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH latest AS (
        SELECT cr.id,
          ROW_NUMBER() OVER (PARTITION BY cr.studentId, cr.classId, cr.semesterId ORDER BY cr.resultRevision DESC) AS rowNumber
        FROM classification_results cr
        JOIN semesters s ON s.id = cr.semesterId
        WHERE ${latestScope(academicYearId, semesterId, classId)}
      )
      SELECT id FROM latest WHERE rowNumber = 1 ORDER BY id LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      WITH latest AS (
        SELECT ROW_NUMBER() OVER (PARTITION BY cr.studentId, cr.classId, cr.semesterId ORDER BY cr.resultRevision DESC) AS rowNumber
        FROM classification_results cr
        JOIN semesters s ON s.id = cr.semesterId
        WHERE ${latestScope(academicYearId, semesterId, classId)}
      )
      SELECT COUNT(*) AS total FROM latest WHERE rowNumber = 1
    `),
    latestClassificationDistribution(academicYearId, semesterId, classId)
  ]);
  const records = await prisma.classificationResult.findMany({
    where: { id: { in: ids.map((item) => item.id) } },
    include: { student: true, catechismClass: { include: { academicYear: true } }, semester: true, ruleVersion: { select: { id: true, version: true } } }
  });
  const byId = new Map(records.map((item) => [item.id, item]));
  return { items: ids.map((item) => byId.get(item.id)!).filter(Boolean), total: Number(totals[0]?.total ?? 0), distribution };
}

adminReportRouter.get("/dashboard", asyncHandler(async (request, response) => {
  const query = adminDashboardQuerySchema.parse(request.query);
  if (!await prisma.academicYear.findUnique({ where: { id: query.academicYearId }, select: { id: true } })) throw notFound("Năm học");
  const where = attendanceWhere(query);
  const [students, classes, teachers, attendance, results] = await Promise.all([
    prisma.student.count({ where: { enrollments: { some: { academicYearId: query.academicYearId, endedAt: null } } } }),
    prisma.catechismClass.count({ where: { academicYearId: query.academicYearId } }),
    prisma.user.count({ where: { roleAssignments: { some: { role: { code: 'TEACHER' } } }, isActive: true } }),
    attendanceSummary(where),
    latestClassificationDistribution(query.academicYearId)
  ]);
  response.json({ data: { academicYearId: query.academicYearId, totals: { students, classes, teachers }, attendance, classifications: results } });
}));

teacherReportRouter.get("/dashboard", asyncHandler(async (request, response) => {
  const query = teacherDashboardQuerySchema.parse(request.query);
  await validateAttendanceScope(query, request.auth!.userId);
  const teacherId = request.auth!.userId;
  const classWhere: Prisma.CatechismClassWhereInput = {
    ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
    assignments: { some: { teacherId, endedAt: null } }
  };
  const sessionWhere = attendanceWhere(query, teacherId);
  const [classes, attendance, upcomingSessions, incompleteSessions] = await Promise.all([
    prisma.catechismClass.findMany({
      where: classWhere,
      orderBy: { name: "asc" },
      select: { id: true, name: true, academicYearId: true, academicYear: { select: { name: true } }, _count: { select: { enrollments: { where: { endedAt: null } } } } }
    }),
    attendanceSummary(sessionWhere),
    prisma.attendanceSession.findMany({ where: { ...sessionWhere, occursAt: { gte: new Date() } }, orderBy: { occursAt: "asc" }, take: 5, include: { catechismClass: { select: { name: true } }, _count: { select: { records: { where: { state: AttendanceState.ABSENT } } } } } }),
    prisma.attendanceSession.count({ where: { ...sessionWhere, status: { in: [AttendanceSessionStatus.OPEN, AttendanceSessionStatus.SUBMITTED] } } })
  ]);
  response.json({ data: { academicYearId: query.academicYearId ?? null, classes, attendance, upcomingSessions, incompleteSessions } });
}));

async function attendanceReport(request: Request, response: Parameters<Parameters<typeof asyncHandler>[0]>[1]) {
  const query = attendanceReportQuerySchema.parse(request.query);
  const teacherId = isTeacherScope(request) ? request.auth!.userId : undefined;
  await validateAttendanceScope(query, teacherId);
  const where = attendanceWhere(query, teacherId);
  const [summary, byActivity] = await Promise.all([attendanceSummary(where), attendanceBreakdown(where)]);
  response.json({ data: { filters: query, summary, byActivity } });
}

async function absenceReport(request: Request, response: Parameters<Parameters<typeof asyncHandler>[0]>[1]) {
  const query = pagedAttendanceReportQuerySchema.parse(request.query);
  const teacherId = isTeacherScope(request) ? request.auth!.userId : undefined;
  await validateAttendanceScope(query, teacherId);
  const where: Prisma.AttendanceRecordWhereInput = { state: AttendanceState.ABSENT, session: attendanceWhere(query, teacherId) };
  const [items, total] = await prisma.$transaction([
    prisma.attendanceRecord.findMany({ where, include: { session: { include: { catechismClass: true } } }, orderBy: [{ session: { occursAt: "desc" } }, { sessionId: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.attendanceRecord.count({ where })
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}

async function incompleteReport(request: Request, response: Parameters<Parameters<typeof asyncHandler>[0]>[1]) {
  const query = pagedAttendanceReportQuerySchema.parse(request.query);
  const teacherId = isTeacherScope(request) ? request.auth!.userId : undefined;
  await validateAttendanceScope(query, teacherId);
  const where: Prisma.AttendanceSessionWhereInput = {
    ...attendanceWhere(query, teacherId),
    OR: [
      { status: { in: [AttendanceSessionStatus.OPEN, AttendanceSessionStatus.SUBMITTED] } },
      { records: { some: { state: AttendanceState.NOT_MARKED } } }
    ]
  };
  const [items, total] = await prisma.$transaction([
    prisma.attendanceSession.findMany({ where, include: { catechismClass: true, _count: { select: { records: { where: { state: AttendanceState.NOT_MARKED } } } } }, orderBy: [{ occursAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.attendanceSession.count({ where })
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}

for (const router of [adminReportRouter, teacherReportRouter]) {
  router.get("/attendance", asyncHandler(attendanceReport));
  router.get("/absences", asyncHandler(absenceReport));
  router.get("/incomplete-sessions", asyncHandler(incompleteReport));
}

adminReportRouter.get("/classifications", asyncHandler(async (request, response) => {
  const query = classificationReportQuerySchema.parse(request.query);
  const [year, semester, klass] = await Promise.all([
    prisma.academicYear.findUnique({ where: { id: query.academicYearId }, select: { id: true } }),
    query.semesterId ? prisma.semester.findUnique({ where: { id: query.semesterId }, select: { academicYearId: true } }) : null,
    query.classId ? prisma.catechismClass.findUnique({ where: { id: query.classId }, select: { academicYearId: true } }) : null
  ]);
  if (!year) throw notFound("Năm học");
  if (query.semesterId && !semester) throw notFound("Học kỳ");
  if (query.classId && !klass) throw notFound("Lớp");
  if (semester && semester.academicYearId !== query.academicYearId) throw invalidScope("Học kỳ không thuộc Năm học đã chọn.");
  if (klass && klass.academicYearId !== query.academicYearId) throw invalidScope("Lớp không thuộc Năm học đã chọn.");
  const latest = await latestClassificationPage(query.academicYearId, query.semesterId, query.classId, query.page, query.limit);
  response.json({ data: { ...latest, page: query.page, limit: query.limit } });
}));

adminReportRouter.get("/classifications/history", asyncHandler(async (request, response) => {
  const query = classificationHistoryQuerySchema.parse(request.query);
  const where = { studentId: query.studentId, classId: query.classId, semesterId: query.semesterId };
  const [items, total] = await prisma.$transaction([
    prisma.classificationResult.findMany({ where, include: { ruleVersion: { select: { id: true, version: true } }, actor: { select: { id: true, displayName: true } } }, orderBy: { resultRevision: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.classificationResult.count({ where })
  ]);
  response.json({ data: { items, total, page: query.page, limit: query.limit } });
}));


