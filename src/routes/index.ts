import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { authorize, Permission } from '../middleware/authorize.js';
import { adminRouter } from '../modules/admin/admin.route.js';
import { authRouter } from '../modules/auth/auth.route.js';
import { mediaRouter } from '../modules/media/media.route.js';
import { publicRouter } from '../modules/public/public.route.js';
import { publicPolicyRouter, policyAdminRouter } from '../modules/policies/policy.route.js';
import { securityRouter } from '../modules/security/security.route.js';
import { auditRouter } from '../modules/audit/audit.route.js';
import { teacherRouter } from '../modules/users/user.routes.js';
import { adminAcademicRouter, teacherAcademicRouter } from '../modules/academics/academic.routes.js';
import { adminAttendanceRouter, teacherAttendanceRouter } from '../modules/attendance/attendance.routes.js';
import { studentImportRouter } from '../modules/student-import/student-import.routes.js';
import { adminGradeRouter } from '../modules/grades/grade.routes.js';
import { adminReportRouter, teacherReportRouter } from '../modules/reports/report.routes.js';
import { accountDeletionRouter, adminAccountDeletionRouter } from '../modules/account-deletion/account-deletion.routes.js';

export const apiRouter = Router();
apiRouter.get('/health', (_req, res) =>
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() }, message: 'API hoạt động' }),
);
export const readiness = async (_req: import('express').Request, res: import('express').Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: 'ready' } });
  } catch {
    res.status(503).json({ error: { code: 'NOT_READY', message: 'Cơ sở dữ liệu chưa sẵn sàng.' } });
  }
};
apiRouter.get('/ready', readiness);
apiRouter.use('/public/policies', publicPolicyRouter);
apiRouter.use('/public', publicRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/account-deletion', accountDeletionRouter);

apiRouter.use('/admin/security', securityRouter);
apiRouter.use('/admin/audit-logs', auditRouter);
apiRouter.use('/admin/policies', policyAdminRouter);
apiRouter.use('/admin/account-deletion', adminAccountDeletionRouter);
apiRouter.use('/admin/teachers', teacherRouter);
apiRouter.use('/admin/academics/imports', studentImportRouter);
apiRouter.use('/admin/academics', adminAcademicRouter);
apiRouter.use('/admin/attendance', adminAttendanceRouter);
apiRouter.use('/admin/grades', adminGradeRouter);
apiRouter.use('/admin/reports', adminReportRouter);
apiRouter.use('/teacher/attendance', teacherAttendanceRouter);
apiRouter.use('/teacher/reports', teacherReportRouter);
apiRouter.use('/teacher', teacherAcademicRouter);

apiRouter.use('/admin/media', authenticate, authorize(Permission.PARISH_MANAGE), mediaRouter);
apiRouter.use('/admin', authenticate, authorize(Permission.PARISH_MANAGE), adminRouter);
