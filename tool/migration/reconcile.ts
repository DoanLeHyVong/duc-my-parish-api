import {
  APP_TABLES,
  PARISH_TABLES,
  assertIsolated,
  closeAll,
  count,
  databaseConfig,
  deterministicParishUserId,
  loadMappings,
  normalizeUsername,
  rows,
  validateForeignKeys,
} from './migration-lib.js';

const parish = databaseConfig('PARISH_SOURCE_DATABASE_URL');
const app = databaseConfig('APPGLV_SOURCE_DATABASE_URL');
const target = databaseConfig('DATABASE_URL');
assertIsolated(parish, app, target);

type Check = { expected: number | string | boolean; actual: number | string | boolean; matches: boolean };
const checks: Record<string, Check> = {};
const record = (name: string, expected: Check['expected'], actual: Check['actual']): void => {
  checks[name] = { expected, actual, matches: expected === actual };
};
const metadataObject = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

try {
  const mappings = await loadMappings();
  const [parishConnection, appConnection, targetConnection] = await Promise.all([parish.pool.getConnection(), app.pool.getConnection(), target.pool.getConnection()]);
  try {
    await parishConnection.query('SET TRANSACTION READ ONLY');
    await parishConnection.beginTransaction();
    await appConnection.query('SET TRANSACTION READ ONLY');
    await appConnection.beginTransaction();
    await targetConnection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await targetConnection.query('SET TRANSACTION READ ONLY');
    await targetConnection.beginTransaction();

    for (const table of APP_TABLES) {
      const source = await count(appConnection, table);
      record(`appglv.${table}`, source, await count(targetConnection, table));
    }
    for (const table of PARISH_TABLES) {
      const source = await count(parishConnection, table);
      const mappingAuditDelta = table === 'AuditLog'
        ? mappings.parishAdminMappings.reduce((total, item) => total + (item.resolution === 'distinct' ? 2 : 1), 0)
        : 0;
      record(`parish.${table}`, source + mappingAuditDelta, await count(targetConnection, table));
    }

    const appUsers = await rows(appConnection, 'users');
    const parishAdmins = await rows(parishConnection, 'Admin');
    const mappingsByParishId = new Map(mappings.parishAdminMappings.map((item) => [item.parishAdminId, item]));
    const mergeCount = mappings.parishAdminMappings.filter((item) => item.resolution === 'merge').length;
    record('identity.users', appUsers.length + parishAdmins.length - mergeCount, await count(targetConnection, 'users'));
    record('identity.roles', 4, await count(targetConnection, 'access_roles'));
    record('identity.roleAssignments', appUsers.length + parishAdmins.length, await count(targetConnection, 'user_role_assignments'));
    record('identity.legacySessionsMigrated', 0, await count(targetConnection, 'auth_sessions'));

    for (const source of appUsers) {
      const targetUsers = await targetConnection.query<Array<{ passwordHash: string }>>(
        'SELECT passwordHash FROM users WHERE id = ?',
        [source.id],
      );
      record(`appglvCredential.${source.id}`, true, targetUsers[0]?.passwordHash === source.passwordHash);
      const roleRows = await targetConnection.query<Array<{ total: bigint | number }>>(
        `SELECT COUNT(*) AS total
           FROM user_role_assignments ura
           JOIN access_roles role ON role.id = ura.roleId
          WHERE ura.userId = ? AND role.code = ?`,
        [source.id, source.role],
      );
      record(`appglvUserRole.${source.id}`, 1, Number(roleRows[0]?.total ?? 0));
    }

    for (const sourceAdmin of parishAdmins) {
      const parishAdminId = Number(sourceAdmin.id);
      const mapping = mappingsByParishId.get(parishAdminId);
      const targetUserId = mapping?.resolution === 'merge' ? mapping.targetUserId : deterministicParishUserId(parishAdminId);
      const users = await targetConnection.query<Array<{ username: string; legacyParishAdminId: number; passwordHash: string }>>(
        'SELECT username, legacyParishAdminId, passwordHash FROM users WHERE id = ?',
        [targetUserId],
      );
      const checkPrefix = `parishIdentity.${parishAdminId}`;
      record(`${checkPrefix}.userExists`, true, users.length === 1);
      record(`${checkPrefix}.legacyId`, parishAdminId, Number(users[0]?.legacyParishAdminId ?? -1));
      record(`${checkPrefix}.sourceUsername`, true, !mapping || normalizeUsername(sourceAdmin.username) === normalizeUsername(mapping.expectedSourceUsername));
      if (mapping?.resolution !== 'merge') {
        const expectedUsername = mapping?.resolution === 'distinct' ? mapping.targetUsername : String(sourceAdmin.username ?? '');
        record(`${checkPrefix}.username`, normalizeUsername(expectedUsername), normalizeUsername(users[0]?.username));
        record(`${checkPrefix}.credentialPreserved`, true, users[0]?.passwordHash === sourceAdmin.passwordHash);
      }
      const parishRoleRows = await targetConnection.query<Array<{ total: bigint | number }>>(
        `SELECT COUNT(*) AS total
           FROM user_role_assignments ura
           JOIN access_roles role ON role.id = ura.roleId
          WHERE ura.userId = ? AND role.code = 'PARISH_ADMIN'`,
        [targetUserId],
      );
      record(`${checkPrefix}.parishRole`, 1, Number(parishRoleRows[0]?.total ?? 0));

      if (mapping) {
        const actions = mapping.resolution === 'merge'
          ? ['IDENTITY_MAPPING_MERGED']
          : ['IDENTITY_MAPPING_DISTINCT_APPROVED', 'MIGRATION_USERNAME_CHANGED'];
        for (const action of actions) {
          const auditRows = await targetConnection.query<Array<{ metadata: unknown }>>(
            `SELECT metadata FROM AuditLog
              WHERE actorId = ? AND action = ? AND entityType = 'User' AND entityId = ?`,
            [targetUserId, action, targetUserId],
          );
          const auditPrefix = `${checkPrefix}.audit.${action}`;
          record(`${auditPrefix}.count`, 1, auditRows.length);
          const metadata = metadataObject(auditRows[0]?.metadata);
          record(`${auditPrefix}.legacyId`, parishAdminId, Number(metadata.legacyParishAdminId ?? -1));
          record(`${auditPrefix}.approvedBy`, mapping.approvedBy, String(metadata.approvedBy ?? ''));
          if (action === 'MIGRATION_USERNAME_CHANGED' && mapping.resolution === 'distinct') {
            record(`${auditPrefix}.from`, normalizeUsername(mapping.expectedSourceUsername), normalizeUsername(metadata.from));
            record(`${auditPrefix}.to`, normalizeUsername(mapping.targetUsername), normalizeUsername(metadata.to));
          } else {
            record(`${auditPrefix}.reason`, mapping.reason, String(metadata.reason ?? ''));
          }
        }
      }
    }

    const foreignKeyFailures = await validateForeignKeys(targetConnection, target.database);
    record('foreignKeys.orphans', 0, foreignKeyFailures.reduce((total, item) => total + item.orphans, 0));
  } finally {
    await Promise.allSettled([
      parishConnection.rollback(),
      appConnection.rollback(),
      targetConnection.rollback(),
    ]);
    parishConnection.release();
    appConnection.release();
    targetConnection.release();
  }
} finally {
  await closeAll(parish, app, target);
}
console.log(JSON.stringify(checks, null, 2));
if (Object.values(checks).some((item) => !item.matches)) process.exitCode = 1;
