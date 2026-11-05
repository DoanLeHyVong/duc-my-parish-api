import { AcademicStatus, Prisma, RoleCode } from "../../generated/prisma/client.js";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import { authenticate } from "../../middleware/auth.js";
import { authorize, Permission } from "../../middleware/authorize.js";
import {
  assignmentSchema,
  createClassSchema,
  createNamedSchema,
  enrollmentSchema,
  idParamsSchema,
  listSchema,
  studentSchema,
  transferSchema,
  updateNamedSchema
} from "./academic.schemas.js";

export const adminAcademicRouter = Router();
export const teacherAcademicRouter = Router();
adminAcademicRouter.use(authenticate, authorize(Permission.APPGLV_MANAGE));
teacherAcademicRouter.use(authenticate, authorize(Permission.APPGLV_TEACH));

const conflict = (message: string) => new ApiError(409, "ACADEMIC_CONFLICT", message);
const notFound = (entity: string) => new ApiError(404, "NOT_FOUND", `Không tìm thấy ${entity}.`);

function rethrowConstraint(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw conflict(message);
  }
  throw error;
}

async function openYear(id: string) {
  const year = await prisma.academicYear.findUnique({ where: { id } });
  if (!year) throw notFound("Năm học");
  if (year.status !== AcademicStatus.OPEN) throw conflict("Năm học đã đóng.");
  return year;
}

async function openClass(id: string) {
  const item = await prisma.catechismClass.findUnique({ where: { id }, include: { academicYear: true } });
  if (!item) throw notFound("Lớp");
  if (item.status !== AcademicStatus.OPEN || item.academicYear.status !== AcademicStatus.OPEN) {
    throw conflict("Lớp hoặc Năm học đã đóng.");
  }
  return item;
}

async function lockOpenYear(tx: Prisma.TransactionClient, id: string) {
  const locked = await tx.academicYear.updateMany({
    where: { id, status: AcademicStatus.OPEN },
    data: { updatedAt: new Date() }
  });
  if (locked.count === 0) {
    const year = await tx.academicYear.findUnique({ where: { id } });
    if (!year) throw notFound("Năm học");
    throw conflict("Năm học đã đóng.");
  }
  return tx.academicYear.findUniqueOrThrow({ where: { id } });
}

async function lockOpenClass(tx: Prisma.TransactionClient, id: string) {
  const item = await tx.catechismClass.findUnique({ where: { id } });
  if (!item) throw notFound("Lớp");
  await lockOpenYear(tx, item.academicYearId);
  const locked = await tx.catechismClass.updateMany({
    where: { id, status: AcademicStatus.OPEN },
    data: { updatedAt: new Date() }
  });
  if (locked.count === 0) throw conflict("Lớp đã đóng.");
  return tx.catechismClass.findUniqueOrThrow({ where: { id } });
}

adminAcademicRouter.get("/academic-years", asyncHandler(async (request, response) => {
  const query = listSchema.parse(request.query);
  const where: Prisma.AcademicYearWhereInput = {
    ...(query.status === "ALL" ? {} : { status: query.status }),
    ...(query.search ? { name: { contains: query.search } } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.academicYear.findMany({ where, orderBy: { name: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit, include: { semesters: { orderBy: { name: "asc" } } } }),
    prisma.academicYear.count({ where })
  ]);
  response.json({ data: { items, page: query.page, limit: query.limit, total } });
}));

adminAcademicRouter.post("/academic-years", asyncHandler(async (request, response) => {
  const input = createNamedSchema.parse(request.body);
  try {
    response.status(201).json({ data: await prisma.academicYear.create({ data: input }) });
  } catch (error) { rethrowConstraint(error, "Tên Năm học đã tồn tại."); }
}));

adminAcademicRouter.patch("/academic-years/:id", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = updateNamedSchema.parse(request.body);
  await openYear(id);
  try {
    response.json({ data: await prisma.academicYear.update({ where: { id }, data: input }) });
  } catch (error) { rethrowConstraint(error, "Tên Năm học đã tồn tại."); }
}));

adminAcademicRouter.post("/academic-years/:id/close", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const now = new Date();
  const year = await prisma.$transaction(async (tx) => {
    await lockOpenYear(tx, id);
    await tx.enrollment.updateMany({ where: { academicYearId: id, endedAt: null }, data: { endedAt: now, currentKey: null } });
    await tx.teacherAssignment.updateMany({ where: { catechismClass: { academicYearId: id }, endedAt: null }, data: { endedAt: now, currentKey: null } });
    await tx.semester.updateMany({ where: { academicYearId: id, status: AcademicStatus.OPEN }, data: { status: AcademicStatus.CLOSED, closedAt: now } });
    await tx.catechismClass.updateMany({ where: { academicYearId: id, status: AcademicStatus.OPEN }, data: { status: AcademicStatus.CLOSED, closedAt: now } });
    return tx.academicYear.update({ where: { id }, data: { status: AcademicStatus.CLOSED, closedAt: now } });
  });
  response.json({ data: year });
}));

adminAcademicRouter.post("/academic-years/:id/semesters", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = createNamedSchema.parse(request.body);
  try {
    const semester = await prisma.$transaction(async (tx) => {
      await lockOpenYear(tx, id);
      return tx.semester.create({ data: { academicYearId: id, name: input.name } });
    });
    response.status(201).json({ data: semester });
  } catch (error) { rethrowConstraint(error, "Tên Học kỳ đã tồn tại trong Năm học."); }
}));

adminAcademicRouter.patch("/semesters/:id", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = updateNamedSchema.parse(request.body);
  const semester = await prisma.semester.findUnique({ where: { id } });
  if (!semester) throw notFound("Học kỳ");
  await openYear(semester.academicYearId);
  if (semester.status !== AcademicStatus.OPEN) throw conflict("Học kỳ đã đóng.");
  try { response.json({ data: await prisma.semester.update({ where: { id }, data: input }) }); }
  catch (error) { rethrowConstraint(error, "Tên Học kỳ đã tồn tại trong Năm học."); }
}));

adminAcademicRouter.post("/semesters/:id/close", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const semester = await prisma.semester.findUnique({ where: { id } });
  if (!semester) throw notFound("Học kỳ");
  if (semester.status !== AcademicStatus.OPEN) throw conflict("Học kỳ đã đóng.");
  response.json({ data: await prisma.semester.update({ where: { id }, data: { status: AcademicStatus.CLOSED, closedAt: new Date() } }) });
}));

adminAcademicRouter.get("/classes", asyncHandler(async (request, response) => {
  const query = listSchema.parse(request.query);
  const where: Prisma.CatechismClassWhereInput = {
    ...(query.status === "ALL" ? {} : { status: query.status }),
    ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
    ...(query.search ? { name: { contains: query.search } } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.catechismClass.findMany({ where, orderBy: { name: "asc" }, skip: (query.page - 1) * query.limit, take: query.limit, include: { academicYear: true, _count: { select: { enrollments: { where: { endedAt: null } }, assignments: { where: { endedAt: null } } } } } }),
    prisma.catechismClass.count({ where })
  ]);
  response.json({ data: { items, page: query.page, limit: query.limit, total } });
}));

adminAcademicRouter.post("/classes", asyncHandler(async (request, response) => {
  const input = createClassSchema.parse(request.body);
  try {
    const item = await prisma.$transaction(async (tx) => {
      await lockOpenYear(tx, input.academicYearId);
      return tx.catechismClass.create({ data: input, include: { academicYear: true } });
    });
    response.status(201).json({ data: item });
  }
  catch (error) { rethrowConstraint(error, "Tên Lớp đã tồn tại trong Năm học."); }
}));

adminAcademicRouter.patch("/classes/:id", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = updateNamedSchema.parse(request.body);
  await openClass(id);
  try { response.json({ data: await prisma.catechismClass.update({ where: { id }, data: input, include: { academicYear: true } }) }); }
  catch (error) { rethrowConstraint(error, "Tên Lớp đã tồn tại trong Năm học."); }
}));

adminAcademicRouter.post("/classes/:id/close", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const now = new Date();
  const item = await prisma.$transaction(async (tx) => {
    await lockOpenClass(tx, id);
    await tx.enrollment.updateMany({ where: { classId: id, endedAt: null }, data: { endedAt: now, currentKey: null } });
    await tx.teacherAssignment.updateMany({ where: { classId: id, endedAt: null }, data: { endedAt: now, currentKey: null } });
    return tx.catechismClass.update({ where: { id }, data: { status: AcademicStatus.CLOSED, closedAt: now } });
  });
  response.json({ data: item });
}));

adminAcademicRouter.get("/classes/:id", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const item = await prisma.catechismClass.findUnique({ where: { id }, include: {
    academicYear: true,
    enrollments: { orderBy: { startedAt: "desc" }, include: { student: true } },
    assignments: { orderBy: { startedAt: "desc" }, include: { teacher: { select: { id: true, username: true, displayName: true, isActive: true } } } }
  } });
  if (!item) throw notFound("Lớp");
  response.json({ data: item });
}));

adminAcademicRouter.get("/students", asyncHandler(async (request, response) => {
  const query = listSchema.parse(request.query);
  const where: Prisma.StudentWhereInput = query.search ? { OR: [{ saintName: { contains: query.search } }, { fullName: { contains: query.search } }] } : {};
  const [items, total] = await prisma.$transaction([
    prisma.student.findMany({ where, orderBy: { fullName: "asc" }, skip: (query.page - 1) * query.limit, take: query.limit, include: { enrollments: { where: { endedAt: null }, include: { catechismClass: { include: { academicYear: true } } } } } }),
    prisma.student.count({ where })
  ]);
  response.json({ data: { items, page: query.page, limit: query.limit, total } });
}));

adminAcademicRouter.post("/students", asyncHandler(async (request, response) => {
  const input = studentSchema.parse(request.body);
  response.status(201).json({ data: await prisma.student.create({ data: input }) });
}));

adminAcademicRouter.get("/students/:id", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const student = await prisma.student.findUnique({ where: { id }, include: { enrollments: { orderBy: { startedAt: "desc" }, include: { catechismClass: true, academicYear: true } } } });
  if (!student) throw notFound("Học sinh");
  response.json({ data: student });
}));

adminAcademicRouter.patch("/students/:id", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = studentSchema.parse(request.body);
  const exists = await prisma.student.findUnique({ where: { id } });
  if (!exists) throw notFound("Học sinh");
  response.json({ data: await prisma.student.update({ where: { id }, data: input }) });
}));

adminAcademicRouter.post("/classes/:id/enrollments", asyncHandler(async (request, response) => {
  const { id: classId } = idParamsSchema.parse(request.params);
  const { studentId } = enrollmentSchema.parse(request.body);
  try {
    const enrollment = await prisma.$transaction(async (tx) => {
      const item = await lockOpenClass(tx, classId);
      if (!await tx.student.findUnique({ where: { id: studentId } })) throw notFound("Học sinh");
      return tx.enrollment.create({ data: { studentId, classId, academicYearId: item.academicYearId, currentKey: `${studentId}:${item.academicYearId}` } });
    });
    response.status(201).json({ data: enrollment });
  } catch (error) { rethrowConstraint(error, "Học sinh đã có Lớp hiện tại trong Năm học này."); }
}));

adminAcademicRouter.post("/students/:id/transfer", asyncHandler(async (request, response) => {
  const { id: studentId } = idParamsSchema.parse(request.params);
  const { classId } = transferSchema.parse(request.body);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const destination = await lockOpenClass(tx, classId);
      if (!await tx.student.findUnique({ where: { id: studentId } })) throw notFound("Học sinh");
      const currentKey = `${studentId}:${destination.academicYearId}`;
      const current = await tx.enrollment.findUnique({ where: { currentKey } });
      if (!current) throw conflict("Học sinh chưa có Lớp hiện tại trong Năm học này.");
      if (current.classId === classId) throw conflict("Học sinh đang thuộc Lớp này.");
      const now = new Date();
      const ended = await tx.enrollment.updateMany({
        where: { id: current.id, endedAt: null, currentKey },
        data: { endedAt: now, currentKey: null }
      });
      if (ended.count !== 1) throw conflict("Ghi danh hiện tại vừa thay đổi. Vui lòng tải lại.");
      return tx.enrollment.create({ data: { studentId, classId, academicYearId: destination.academicYearId, currentKey, startedAt: now } });
    });
    response.json({ data: result });
  } catch (error) {
    rethrowConstraint(error, "Ghi danh hiện tại vừa thay đổi. Vui lòng tải lại.");
  }
}));

adminAcademicRouter.post("/classes/:id/assignments", asyncHandler(async (request, response) => {
  const { id: classId } = idParamsSchema.parse(request.params);
  const { teacherId } = assignmentSchema.parse(request.body);
  try {
    const assignment = await prisma.$transaction(async (tx) => {
      await lockOpenClass(tx, classId);
      const teacher = await tx.user.findUnique({
        where: { id: teacherId },
        include: { roleAssignments: { include: { role: true } } },
      });
      if (!teacher || !teacher.roleAssignments.some((assignment) => assignment.role.code === RoleCode.TEACHER) || !teacher.isActive) throw conflict("Tài khoản Giáo lý viên không hợp lệ hoặc đã khóa.");
      return tx.teacherAssignment.create({ data: { teacherId, classId, currentKey: `${teacherId}:${classId}` } });
    });
    response.status(201).json({ data: assignment });
  }
  catch (error) { rethrowConstraint(error, "Giáo lý viên đã được phân công vào Lớp này."); }
}));

adminAcademicRouter.post("/assignments/:id/end", asyncHandler(async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const assignment = await prisma.teacherAssignment.findUnique({ where: { id } });
  if (!assignment) throw notFound("Phân công");
  if (assignment.endedAt) throw conflict("Phân công đã kết thúc.");
  response.json({ data: await prisma.teacherAssignment.update({ where: { id }, data: { endedAt: new Date(), currentKey: null } }) });
}));

teacherAcademicRouter.get("/classes", asyncHandler(async (request, response) => {
  const items = await prisma.teacherAssignment.findMany({
    where: { teacherId: request.auth!.userId, endedAt: null, catechismClass: { status: AcademicStatus.OPEN, academicYear: { status: AcademicStatus.OPEN } } },
    orderBy: { catechismClass: { name: "asc" } },
    include: { catechismClass: { include: { academicYear: true, _count: { select: { enrollments: { where: { endedAt: null } } } } } } }
  });
  response.json({ data: { items: items.map((item) => item.catechismClass), total: items.length } });
}));

teacherAcademicRouter.get("/classes/:id/students", asyncHandler(async (request, response) => {
  const { id: classId } = idParamsSchema.parse(request.params);
  const assignment = await prisma.teacherAssignment.findUnique({ where: { currentKey: `${request.auth!.userId}:${classId}` } });
  if (!assignment) throw new ApiError(403, "FORBIDDEN", "Bạn không được phân công vào Lớp này.");
  const item = await prisma.catechismClass.findUnique({ where: { id: classId }, include: { academicYear: true, enrollments: { where: { endedAt: null }, orderBy: { student: { fullName: "asc" } }, include: { student: true } } } });
  if (!item) throw notFound("Lớp");
  response.json({ data: item });
}));


