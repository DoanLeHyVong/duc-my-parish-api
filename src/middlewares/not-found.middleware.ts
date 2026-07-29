import type { RequestHandler } from 'express';

export const notFoundMiddleware: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, message: `Không tìm thấy ${req.method} ${req.path}` });
};
