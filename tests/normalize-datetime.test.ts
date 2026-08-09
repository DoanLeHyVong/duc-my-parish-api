import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/utils/api-error.js';
import { normalizeDateTimeFields } from '../src/utils/normalize-datetime.js';

describe('normalizeDateTimeFields', () => {
  it('accepts datetime-local values used by admin forms', () => {
    const result = normalizeDateTimeFields('announcements', {
      startsAt: '2026-07-29T10:39',
      endsAt: '2026-08-16T10:39',
    });

    expect(result.startsAt).toBeInstanceOf(Date);
    expect(result.endsAt).toBeInstanceOf(Date);
    expect(result.startsAt.getFullYear()).toBe(2026);
    expect(result.startsAt.getMinutes()).toBe(39);
  });

  it('turns an empty optional date into null', () => {
    const result = normalizeDateTimeFields('announcements', { endsAt: '' });
    expect(result.endsAt).toBeNull();
  });

  it('returns a useful validation error for an invalid date', () => {
    expect(() =>
      normalizeDateTimeFields('events', { startsAt: 'khong-phai-ngay' }),
    ).toThrow(ApiError);
  });
});
