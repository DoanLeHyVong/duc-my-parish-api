import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error.js';
import { ok } from '../../utils/response.js';
import { mediaService } from './media.service.js';

export const mediaController = {
  async upload(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) throw new ApiError(422, 'Chưa chọn ảnh');
    const data = await mediaService.upload(files, req.auth!.userId, String(req.body.folder || 'general'));
    return res.status(201).json({ success: true, data, message: 'Tải ảnh thành công' });
  },
  async remove(req: Request, res: Response) {
    await mediaService.remove(Number(req.params.id), req.auth!.userId);
    return ok(res, null, 'Xóa ảnh thành công');
  },
};
