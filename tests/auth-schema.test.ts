import { describe, expect, it } from 'vitest';
import { loginSchema } from '../src/modules/auth/auth.schema.js';

describe('loginSchema', () => {
  it('accepts a username without requiring an email address', () => {
    const result = loginSchema.parse({
      username: 'nguyenhoangbuukim',
      password: 'a-secure-password',
    });

    expect(result.username).toBe('nguyenhoangbuukim');
  });

  it('rejects the former email-only payload', () => {
    expect(() => loginSchema.parse({
      email: 'admin@example.com',
      password: 'a-secure-password',
    })).toThrow();
  });
});
