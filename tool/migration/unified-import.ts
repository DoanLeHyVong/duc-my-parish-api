import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RoleCode } from '../../src/generated/prisma/enums.js';
import {
  APP_TABLES, PARISH_TABLES, assertIsolated, closeAll, count, databaseConfig,
  deterministicParishUserId, identityCollisionFields, insertRows, isCompatibleBcryptHash,
  loadMappings, normalizeUsername, resolveDistinctUsername, rows, validateForeignKeys, validateUsername,
} from './migration-lib.js';

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--dry-run') ? 'dry-run' : null;
if (!mode) throw new Error('Use exactly one mode: --dry-run or --apply.');

const parish = databaseConfig('PARISH_SOURCE_DATABASE_URL');
const app = databaseConfig('APPGLV_SOURCE_DATABASE_URL');
const target = databaseConfig('DATABASE_URL');
assertIsolated(parish, app, target);

const report: {
  mode: string;
  startedAt: string;
  completedAt?: string;
  mappings: Array<{
    parishAdminId: number;
    targetUserId: string;
    kind: 'automatic-distinct' | 'approved-distinct' | 'approved-merge';
    targetUsername?: string;
  }>;
  counts: Record<string, { source: number; target: number }>;
  blockedCollisions: Array<{ parishAdminId: number; fields: string[] }>;
  invalidatedLegacySessions: number;
  foreignKeyFailures: Array<{ table: string; constraint: string; orphans: number }>;
  migrationAuditEntries: number;
  rolledBack?: boolean;
} = {
  mode,
  startedAt: new Date().toISOString(),
  mappings: [],
  counts: {},
  blockedCollisions: [],
  invalidatedLegacySessions: 0,
  foreignKeyFailures: [],
  migrationAuditEntries: 0,
};

const permissionMap: Record<RoleCode, string[]> = {
  SUPER_ADMIN: ['parish.manage', 'appglv.manage', 'appglv.teach', 'policies.manage', 'security.manage'],
  PARISH_ADMIN: ['parish.manage', 'policies.manage'],
  APPGLV_ADMIN: ['appglv.manage'],
  TEACHER: ['appglv.teach'],
};

async function run(): Promise<void> {
  const mappings = await loadMappings();
  const [parishConnection, appConnection, targetConnection] = await Promise.all([
    parish.pool.getConnection(), app.pool.getConnection(), target.pool.getConnection(),
  ]);
  try {
    await parishConnection.query('SET TRANSACTION READ ONLY');
    await parishConnection.beginTransaction();
    await appConnection.query('SET TRANSACTION READ ONLY');
    await appConnection.beginTransaction();
    await targetConnection.beginTransaction();
    await targetConnection.query('SET FOREIGN_KEY_CHECKS = 0');

    const existingTargetUsers = await count(targetConnection, 'users');
    const existingTargetContent = await count(targetConnection, 'Post');
    if (existingTargetUsers || existingTargetContent) throw new Error('Target must be an empty newly baselined database.');

    const appUsers = await rows(appConnection, 'users');
    const parishAdmins = await rows(parishConnection, 'Admin');
    const reviewedMappings = new Map(mappings.parishAdminMappings.map((item) => [item.parishAdminId, item]));
    const parishAdminIds = new Set(parishAdmins.map((admin) => Number(admin.id)));
    const unknownMapping = mappings.parishAdminMappings.find((item) => !parishAdminIds.has(item.parishAdminId));
    if (unknownMapping) throw new Error(`Identity mapping references missing Parish Admin ${unknownMapping.parishAdminId}.`);
    const appById = new Map(appUsers.map((user) => [String(user.id), user]));
    const reservedUsernames = new Set(appUsers.map((user) => normalizeUsername(user.username)));
    const migrationAuditRows: Record<string, unknown>[] = [];

    const permissionRows = Object.entries({
      'parish.manage': 'Quản trị nội dung Giáo xứ',
      'appglv.manage': 'Quản trị nghiệp vụ AppGLV',
      'appglv.teach': 'Thao tác Giáo lý viên theo phạm vi lớp',
      'policies.manage': 'Soạn và công bố chính sách',
      'security.manage': 'Quản trị tài khoản, vai trò và quyền',
    }).map(([code, description]) => ({ id: `permission_${code.replace('.', '_')}`, code, description, createdAt: new Date() }));
    await insertRows(targetConnection, 'permissions', permissionRows);
    const roleRows = Object.values(RoleCode).map((code) => ({ id: `role_${code.toLowerCase()}`, code, name: code, createdAt: new Date(), updatedAt: new Date() }));
    await insertRows(targetConnection, 'access_roles', roleRows);
    await insertRows(targetConnection, 'role_permissions', roleRows.flatMap((role) => permissionMap[role.code].map((permissionCode) => ({
      roleId: role.id,
      permissionId: permissionRows.find((permission) => permission.code === permissionCode)!.id,
    }))));

    for (const source of appUsers) {
      const role = String(source.role) as RoleCode;
      const user = { ...source };
      delete user.role;
      await insertRows(targetConnection, 'users', [user]);
      await insertRows(targetConnection, 'user_role_assignments', [{ userId: source.id, roleId: `role_${role.toLowerCase()}`, assignedBy: null, assignedAt: source.createdAt }]);
    }

    const parishUserMap = new Map<number, string>();
    for (const admin of parishAdmins) {
      const legacyId = Number(admin.id);
      const reviewed = reviewedMappings.get(legacyId);
      if (reviewed?.resolution === 'merge') {
        if (normalizeUsername(admin.username) !== normalizeUsername(reviewed.expectedSourceUsername)) {
          throw new Error(`Merge mapping for Parish Admin ${legacyId} does not match the reviewed source username.`);
        }
        if (!appById.has(reviewed.targetUserId)) throw new Error(`Merge mapping for Parish Admin ${legacyId} points to a missing AppGLV User.`);
        parishUserMap.set(legacyId, reviewed.targetUserId);
        report.mappings.push({ parishAdminId: legacyId, targetUserId: reviewed.targetUserId, kind: 'approved-merge' });
        migrationAuditRows.push({
          actorId: reviewed.targetUserId,
          action: 'IDENTITY_MAPPING_MERGED',
          entityType: 'User',
          entityId: reviewed.targetUserId,
          metadata: JSON.stringify({ legacyParishAdminId: legacyId, approvedBy: reviewed.approvedBy, reason: reviewed.reason }),
          ipAddress: null,
          createdAt: new Date(),
        });
        continue;
      }
      const fields = identityCollisionFields(admin, appUsers);
      const unresolvedFields = reviewed?.resolution === 'distinct' ? fields.filter((field) => field !== 'username') : fields;
      if (unresolvedFields.length && reviewed?.resolution !== 'merge') {
        report.blockedCollisions.push({ parishAdminId: legacyId, fields: unresolvedFields });
        continue;
      }
      if (!isCompatibleBcryptHash(admin.passwordHash)) {
        throw new Error(`Parish Admin ${legacyId} uses an unsupported password hash and requires the approved reset workflow.`);
      }
      const id = deterministicParishUserId(legacyId);
      const sourceUsername = validateUsername(String(admin.username ?? `parish_admin_${legacyId}`));
      const username = reviewed?.resolution === 'distinct'
        ? resolveDistinctUsername(reviewed, admin, reservedUsernames)
        : sourceUsername;
      if (!reviewed) {
        const normalized = normalizeUsername(username);
        if (reservedUsernames.has(normalized)) {
          report.blockedCollisions.push({ parishAdminId: legacyId, fields: ['username'] });
          continue;
        }
        reservedUsernames.add(normalized);
      }
      parishUserMap.set(legacyId, id);
      report.mappings.push({
        parishAdminId: legacyId,
        targetUserId: id,
        kind: reviewed ? 'approved-distinct' : 'automatic-distinct',
        targetUsername: username,
      });
      await insertRows(targetConnection, 'users', [{
        id,
        username,
        legacyParishAdminId: legacyId,
        email: admin.email,
        lastLoginAt: admin.lastLoginAt,
        displayName: admin.fullName,
        passwordHash: admin.passwordHash,
        isActive: admin.isActive,
        authVersion: 1,
        deletedAt: admin.deletedAt,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      }]);
      await insertRows(targetConnection, 'user_role_assignments', [{ userId: id, roleId: 'role_parish_admin', assignedBy: null, assignedAt: admin.createdAt }]);
      if (reviewed?.resolution === 'distinct') {
        migrationAuditRows.push({
          actorId: id,
          action: 'IDENTITY_MAPPING_DISTINCT_APPROVED',
          entityType: 'User',
          entityId: id,
          metadata: JSON.stringify({ legacyParishAdminId: legacyId, approvedBy: reviewed.approvedBy, reason: reviewed.reason }),
          ipAddress: null,
          createdAt: new Date(),
        });
        migrationAuditRows.push({
          actorId: id,
          action: 'MIGRATION_USERNAME_CHANGED',
          entityType: 'User',
          entityId: id,
          metadata: JSON.stringify({ legacyParishAdminId: legacyId, from: sourceUsername, to: username, approvedBy: reviewed.approvedBy }),
          ipAddress: null,
          createdAt: new Date(),
        });
      }
    }
    if (report.blockedCollisions.length) throw new Error('Ambiguous Parish/AppGLV identity collisions require an explicit reviewed mapping file.');

    for (const mapping of report.mappings.filter((item) => item.kind === 'approved-merge')) {
      await targetConnection.query('UPDATE users SET legacyParishAdminId = ? WHERE id = ?', [mapping.parishAdminId, mapping.targetUserId]);
      await targetConnection.query("INSERT IGNORE INTO user_role_assignments (userId, roleId, assignedBy, assignedAt) VALUES (?, 'role_parish_admin', NULL, NOW(3))", [mapping.targetUserId]);
    }

    for (const table of APP_TABLES) {
      const sourceRows = await rows(appConnection, table);
      await insertRows(targetConnection, table, sourceRows);
      report.counts[`appglv.${table}`] = { source: sourceRows.length, target: await count(targetConnection, table) };
    }

    for (const table of PARISH_TABLES) {
      const sourceRows = await rows(parishConnection, table);
      const transformed = sourceRows.map((source) => {
        const row = { ...source };
        if (table === 'Post') row.authorId = parishUserMap.get(Number(row.authorId));
        if (table === 'Media') row.uploadedById = parishUserMap.get(Number(row.uploadedById));
        if (table === 'AuditLog') {
          row.actorId = row.adminId == null ? null : parishUserMap.get(Number(row.adminId));
          delete row.adminId;
        }
        return row;
      });
      await insertRows(targetConnection, table, transformed);
      report.counts[`parish.${table}`] = { source: sourceRows.length, target: await count(targetConnection, table) };
    }
    await insertRows(targetConnection, 'AuditLog', migrationAuditRows);
    report.migrationAuditEntries = migrationAuditRows.length;
    report.counts['parish.AuditLog']!.target = await count(targetConnection, 'AuditLog');
    report.invalidatedLegacySessions = await count(parishConnection, 'AdminSession');

    await targetConnection.query('SET FOREIGN_KEY_CHECKS = 1');
    report.foreignKeyFailures = await validateForeignKeys(targetConnection, target.database);
    const mismatches = Object.entries(report.counts).filter(([name, value]) => {
      const expectedTarget = name === 'parish.AuditLog' ? value.source + report.migrationAuditEntries : value.source;
      return expectedTarget !== value.target;
    });
    if (mismatches.length || report.foreignKeyFailures.length) throw new Error('Count or foreign-key reconciliation failed.');

    if (mode === 'apply') await targetConnection.commit();
    else {
      await targetConnection.rollback();
      report.rolledBack = true;
    }
    await parishConnection.rollback();
    await appConnection.rollback();
    report.completedAt = new Date().toISOString();
  } catch (error) {
    await targetConnection.rollback();
    await parishConnection.rollback();
    await appConnection.rollback();
    report.rolledBack = true;
    report.completedAt = new Date().toISOString();
    throw error;
  } finally {
    parishConnection.release();
    appConnection.release();
    targetConnection.release();
  }
}

try {
  await run();
} finally {
  const evidenceDir = path.resolve('tool/migration/evidence');
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `unified-import-${Date.now()}.json`), JSON.stringify(report, null, 2));
  await closeAll(parish, app, target);
}
