import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseConfig } from '../tool/migration/migration-lib.js';
import {
  assertIsolated,
  deterministicParishUserId,
  identityCollisionFields,
  isCompatibleBcryptHash,
  loadMappings,
  resolveDistinctUsername,
} from '../tool/migration/migration-lib.js';

const config = (url: string, database: string) => ({ url, database, pool: {} }) as DatabaseConfig;
const mappingDirectories: string[] = [];
const originalMappingFile = process.env.IDENTITY_MAPPING_FILE;
const loadMappingFixture = async (contents: unknown) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'appglv-mapping-'));
  mappingDirectories.push(directory);
  const file = path.join(directory, 'mapping.json');
  await writeFile(file, JSON.stringify(contents), 'utf8');
  process.env.IDENTITY_MAPPING_FILE = file;
  return loadMappings();
};

afterEach(async () => {
  if (originalMappingFile === undefined) delete process.env.IDENTITY_MAPPING_FILE;
  else process.env.IDENTITY_MAPPING_FILE = originalMappingFile;
  await Promise.all(mappingDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('unified migration safety', () => {
  it('requires three distinct databases and a visibly disposable target', () => {
    const parish = config('mysql://user:secret@localhost/parish', 'parish');
    const app = config('mysql://user:secret@localhost/appglv', 'appglv');
    expect(() => assertIsolated(parish, app, config(app.url, 'appglv'))).toThrow(/distinct databases/);
    expect(() => assertIsolated(parish, app, config('mysql://user:secret@localhost/production', 'production'))).toThrow(/unified\/disposable\/test/);
    expect(() => assertIsolated(parish, app, config('mysql://user:secret@localhost/appglv_unified_test', 'appglv_unified_test'))).not.toThrow();
  });

  it('reports ambiguous identity fields instead of inferring a merge', () => {
    const appUsers = [{ id: 'app-1', username: 'shared', email: 'same@example.test' }];
    expect(identityCollisionFields({ id: 7, username: 'SHARED', email: 'same@example.test' }, appUsers)).toEqual(['username', 'email']);
    expect(identityCollisionFields({ id: 8, username: 'distinct', email: 'other@example.test' }, appUsers)).toEqual([]);
    expect(deterministicParishUserId(7)).toBe(deterministicParishUserId(7));
    expect(deterministicParishUserId(7)).not.toBe(deterministicParishUserId(8));
  });

  it('accepts an approved distinct mapping only when source and target usernames are safe', () => {
    const mapping = {
      parishAdminId: 1,
      resolution: 'distinct' as const,
      expectedSourceUsername: 'admin',
      targetUsername: 'parish_admin',
      approvedBy: 'Product Owner',
      reason: 'Keep the two identities independent.',
    };
    expect(resolveDistinctUsername(mapping, { id: 1, username: ' ADMIN ' }, new Set(['admin']))).toBe('parish_admin');
    expect(() => resolveDistinctUsername(mapping, { id: 1, username: 'someone-else' }, new Set(['admin']))).toThrow(/reviewed source username/);
    expect(() => resolveDistinctUsername(mapping, { id: 1, username: 'admin' }, new Set(['admin', 'parish_admin']))).toThrow(/not unique/);
    expect(() => resolveDistinctUsername({ ...mapping, targetUsername: ' ADMIN ' }, { id: 1, username: 'admin' }, new Set())).toThrow(/must change/);
  });

  it('rejects malformed mapping files with explicit validation errors', async () => {
    await expect(loadMappingFixture(null)).rejects.toThrow(/must be an object/);
    await expect(loadMappingFixture({ version: 1, parishAdminMappings: [null] })).rejects.toThrow(/must be an object/);
    await expect(loadMappingFixture({
      version: 1,
      parishAdminMappings: [{ parishAdminId: 1, resolution: 'merge', expectedSourceUsername: 'admin', targetUserId: 'app-1', approvedBy: 7, reason: 'reviewed' }],
    })).rejects.toThrow(/requires parishAdminId, approvedBy, and reason/);
    await expect(loadMappingFixture({
      version: 1,
      parishAdminMappings: [{ parishAdminId: 1, resolution: 'guess', approvedBy: 'owner', reason: 'reviewed' }],
    })).rejects.toThrow(/resolution must be merge or distinct/);
    await expect(loadMappingFixture({
      version: 1,
      parishAdminMappings: [{ parishAdminId: 1, resolution: 'merge', targetUserId: 'app-1', approvedBy: 'owner', reason: 'reviewed' }],
    })).rejects.toThrow(/expectedSourceUsername and targetUserId strings/);
    await expect(loadMappingFixture({
      version: 1,
      parishAdminMappings: [{ parishAdminId: 1, resolution: 'distinct', expectedSourceUsername: 'admin', targetUsername: 42, approvedBy: 'owner', reason: 'reviewed' }],
    })).rejects.toThrow(/expectedSourceUsername and targetUsername/);
  });

  it('normalizes mapping identifiers and rejects duplicate sources or merge targets', async () => {
    await expect(loadMappingFixture({
      version: 1,
      parishAdminMappings: [{
        parishAdminId: 1,
        resolution: 'merge',
        expectedSourceUsername: ' admin ',
        targetUserId: ' app-1 ',
        approvedBy: ' owner ',
        reason: ' reviewed ',
      }],
    })).resolves.toEqual({
      version: 1,
      parishAdminMappings: [{
        parishAdminId: 1,
        resolution: 'merge',
        expectedSourceUsername: 'admin',
        targetUserId: 'app-1',
        approvedBy: 'owner',
        reason: 'reviewed',
      }],
    });
    const merge = (parishAdminId: number, targetUserId: string) => ({
      parishAdminId,
      resolution: 'merge',
      expectedSourceUsername: `admin_${parishAdminId}`,
      targetUserId,
      approvedBy: 'owner',
      reason: 'reviewed',
    });
    await expect(loadMappingFixture({ version: 1, parishAdminMappings: [merge(1, 'app-1'), merge(2, ' app-1 ')] }))
      .rejects.toThrow(/Duplicate merge target/);
    await expect(loadMappingFixture({ version: 1, parishAdminMappings: [merge(1, 'app-1'), { ...merge(1, 'app-2') }] }))
      .rejects.toThrow(/Duplicate mapping for Parish Admin 1/);
  });

  it('recognizes only supported bcrypt credentials for direct preservation', () => {
    expect(isCompatibleBcryptHash(`$2b$03$${'a'.repeat(53)}`)).toBe(false);
    expect(isCompatibleBcryptHash(`$2b$04$${'a'.repeat(53)}`)).toBe(true);
    expect(isCompatibleBcryptHash(`$2a$31$${'a'.repeat(53)}`)).toBe(true);
    expect(isCompatibleBcryptHash(`$2y$32$${'a'.repeat(53)}`)).toBe(false);
    expect(isCompatibleBcryptHash(`$2b$99$${'a'.repeat(53)}`)).toBe(false);
    expect(isCompatibleBcryptHash('not-a-bcrypt-hash')).toBe(false);
  });
});
