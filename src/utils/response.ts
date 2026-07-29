import type { Response } from 'express';

export const ok = (res: Response, data: unknown, message = 'Thành công') =>
  res.json({ success: true, data, message });
