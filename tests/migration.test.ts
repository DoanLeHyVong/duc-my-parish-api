import { describe, expect, it } from 'vitest';
import type { DatabaseConfig } from '../tool/migration/migration-lib.js';
import {
  assertIsolated,
  deterministicParishUserId,
  identityCollisionFields,
} from '../tool/migration/migration-lib.js';

const config = (url: string, database: string) => ({ url, database, pool: {} }) as DatabaseConfig;

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
});
