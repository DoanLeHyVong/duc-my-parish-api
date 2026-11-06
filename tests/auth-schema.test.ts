import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema } from '../src/modules/auth/auth.schema.js';

describe('loginSchema', () => {
  it('accepts retained short credentials but keeps new-password rules', () => {
    expect(loginSchema.safeParse({ username: 'admin', password: 'short' }).success).toBe(true);
    expect(loginSchema.safeParse({ username: 'admin', password: '' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'short', newPassword: 'short' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'short', newPassword: 'long-enough-password' }).success).toBe(true);
  });
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
