import { ApiError } from './api-error.js';

const dateFieldsByResource: Record<string, string[]> = {
  posts: ['scheduledAt', 'publishedAt'],
  banners: ['startsAt', 'endsAt'],
  announcements: ['startsAt', 'endsAt'],
  'mass-schedules': ['validFrom', 'validTo'],
  'special-masses': ['startsAt'],
  events: ['startsAt', 'endsAt'],
  albums: ['eventDate'],
};

export function normalizeDateTimeFields(resource: string, input: Record<string, any>) {
  const data = { ...input };
  for (const field of dateFieldsByResource[resource] ?? []) {
    const value = data[field];
    if (value === undefined) continue;
    if (value === null || value === '') {
      data[field] = null;
      continue;
    }
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new ApiError(422, 'Ngày giờ không hợp lệ', [
        { field, message: `Giá trị ngày giờ của ${field} không hợp lệ` },
      ]);
    }
    data[field] = parsed;
  }
  return data;
}
