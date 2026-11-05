import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mariadb, { type Pool, type PoolConnection } from 'mariadb';

export type DatabaseConfig = { url: string; database: string; pool: Pool };
export type MappingFile = {
  version: 1;
  parishAdminMappings: Array<{ parishAdminId: number; targetUserId: string; approvedBy: string; reason: string }>;
};

export const APP_TABLES = [
  'account_deletion_requests', 'account_deletion_events',
  'academic_years', 'semesters', 'catechism_classes', 'students',
  'grade_columns', 'grade_records', 'grade_audit_entries',
  'classification_rule_versions', 'classification_rule_weights', 'classification_rule_bands', 'classification_results',
  'student_import_batches', 'student_import_rows', 'student_import_events',
  'enrollments', 'teacher_assignments', 'schedule_templates', 'attendance_sessions',
  'attendance_records', 'attendance_events', 'attendance_audit_entries', 'schedule_exceptions',
] as const;

export const PARISH_TABLES = [
  'Category', 'Tag', 'Menu', 'Banner', 'Announcement', 'MassSchedule', 'SpecialMass',
  'Event', 'Album', 'ParishProfile', 'Clergy', 'Organization', 'Setting', 'HomeSection',
  'Media', 'Post', 'PostCategory', 'PostTag', 'PostMedia', 'MenuItem', 'AlbumMedia', 'AuditLog',
] as const;

export function databaseConfig(name: string): DatabaseConfig {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} is required.`);
  const url = new URL(raw);
  if (url.protocol !== 'mysql:' || !url.hostname || !url.username || !url.pathname.slice(1)) throw new Error(`${name} must be a complete mysql:// URL.`);
  const database = decodeURIComponent(url.pathname.slice(1));
  return {
    url: raw,
    database,
    pool: mariadb.createPool({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
      connectionLimit: 2,
      multipleStatements: false,
    }),
  };
}

export function assertIsolated(parish: DatabaseConfig, app: DatabaseConfig, target: DatabaseConfig): void {
  const normalized = (value: string) => value.replace(/\?.*$/, '').toLowerCase();
  if (normalized(parish.url) === normalized(app.url) || normalized(parish.url) === normalized(target.url) || normalized(app.url) === normalized(target.url)) {
    throw new Error('Parish, AppGLV, and target DATABASE URLs must identify three distinct databases.');
  }
  if (!/(?:unified|consolidat|merge|disposable|test)/i.test(target.database)) {
    throw new Error('Target database name must visibly identify a unified/disposable/test database.');
  }
}

export async function loadMappings(): Promise<MappingFile> {
  const file = process.env.IDENTITY_MAPPING_FILE?.trim();
  if (!file) return { version: 1, parishAdminMappings: [] };
  const parsed = JSON.parse(await readFile(path.resolve(file), 'utf8')) as MappingFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.parishAdminMappings)) throw new Error('Identity mapping file must use version 1.');
  const seen = new Set<number>();
  for (const entry of parsed.parishAdminMappings) {
    if (!Number.isInteger(entry.parishAdminId) || entry.parishAdminId <= 0 || !entry.targetUserId || !entry.approvedBy || !entry.reason) throw new Error('Every identity mapping requires parishAdminId, targetUserId, approvedBy, and reason.');
    if (seen.has(entry.parishAdminId)) throw new Error(`Duplicate mapping for Parish Admin ${entry.parishAdminId}.`);
    seen.add(entry.parishAdminId);
  }
  return parsed;
}

export const deterministicParishUserId = (legacyId: number): string =>
  `parish_${createHash('sha256').update(String(legacyId)).digest('hex').slice(0, 22)}`;

export function identityCollisionFields(
  parishAdmin: Record<string, unknown>,
  appUsers: Array<Record<string, unknown>>,
): string[] {
  const username = String(parishAdmin.username ?? '').trim().toLowerCase();
  const email = String(parishAdmin.email ?? '').trim().toLowerCase();
  const fields: string[] = [];
  if (username && appUsers.some((user) => String(user.username ?? '').trim().toLowerCase() === username)) {
    fields.push('username');
  }
  if (email && appUsers.some((user) => String(user.email ?? '').trim().toLowerCase() === email)) {
    fields.push('email');
  }
  return fields;
}

export function identifier(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `\`${value}\``;
}

export async function rows(connection: PoolConnection, table: string): Promise<Record<string, unknown>[]> {
  return connection.query(`SELECT * FROM ${identifier(table)}`);
}

export async function count(connection: PoolConnection, table: string): Promise<number> {
  const result = await connection.query<Array<{ total: bigint | number }>>(`SELECT COUNT(*) AS total FROM ${identifier(table)}`);
  return Number(result[0]?.total ?? 0);
}

export async function insertRows(connection: PoolConnection, table: string, data: Record<string, unknown>[]): Promise<void> {
  for (const row of data) {
    const columns = Object.keys(row);
    if (!columns.length) continue;
    const sql = `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    await connection.query(sql, columns.map((column) => row[column]));
  }
}

export async function validateForeignKeys(connection: PoolConnection, database: string): Promise<Array<{ table: string; constraint: string; orphans: number }>> {
  const constraints = await connection.query<Array<{ TABLE_NAME: string; CONSTRAINT_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string }>>(
    'SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
    [database],
  );
  const grouped = new Map<string, typeof constraints>();
  for (const item of constraints) {
    const key = `${item.TABLE_NAME}:${item.CONSTRAINT_NAME}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const failures: Array<{ table: string; constraint: string; orphans: number }> = [];
  for (const items of grouped.values()) {
    const first = items[0]!;
    const join = items.map((item) => `child.${identifier(item.COLUMN_NAME)} = parent.${identifier(item.REFERENCED_COLUMN_NAME)}`).join(' AND ');
    const present = items.map((item) => `child.${identifier(item.COLUMN_NAME)} IS NOT NULL`).join(' AND ');
    const result = await connection.query<Array<{ total: bigint | number }>>(
      `SELECT COUNT(*) AS total FROM ${identifier(first.TABLE_NAME)} child LEFT JOIN ${identifier(first.REFERENCED_TABLE_NAME)} parent ON ${join} WHERE ${present} AND parent.${identifier(first.REFERENCED_COLUMN_NAME)} IS NULL`,
    );
    const orphans = Number(result[0]?.total ?? 0);
    if (orphans) failures.push({ table: first.TABLE_NAME, constraint: first.CONSTRAINT_NAME, orphans });
  }
  return failures;
}

export async function closeAll(...configs: DatabaseConfig[]): Promise<void> {
  await Promise.all(configs.map((config) => config.pool.end()));
}
