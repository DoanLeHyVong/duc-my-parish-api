import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error.js';
import { ok } from '../../utils/response.js';
import { mediaService } from './media.service.js';
import { prisma } from '../../config/prisma.js';

export const mediaController = {
  async list(req: Request, res: Response) {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError(422, 'Phân trang thư viện không hợp lệ');
    const where = { deletedAt: null };
    const [data, total] = await Promise.all([
      prisma.media.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.media.count({ where }),
    ]);
    res.json({ success: true, data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  },
  async upload(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) throw new ApiError(422, 'Chưa chọn ảnh');
    const data = await mediaService.upload(files, req.auth!.userId, String(req.body.folder || 'general'));
    return res.status(201).json({ success: true, data, message: 'Tải ảnh thành công' });
  },
  async remove(req: Request, res: Response) {
    await mediaService.remove(Number(req.params.id), req.auth!.userId);
    return ok(res, null, 'Đã ẩn ảnh khỏi thư viện');
  },
};
