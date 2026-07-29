import multer from 'multer';
import { ApiError } from '../utils/api-error.js';

const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, callback) =>
    allowed.has(file.mimetype)
      ? callback(null, true)
      : callback(new ApiError(415, 'Chỉ chấp nhận JPG, PNG, WebP hoặc GIF')),
});
