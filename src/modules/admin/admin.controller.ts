import type { Request, Response } from 'express';
import { crudService } from '../../services/crud.service.js';
import { ok } from '../../utils/response.js';

export const adminController = {
  async list(req: Request, res: Response) {
    const result = await crudService.list(String(req.params.resource), req.query);
    res.json({ success: true, ...result });
  },
  async get(req: Request, res: Response) {
    return ok(res, await crudService.get(String(req.params.resource), Number(req.params.id)));
  },
  async create(req: Request, res: Response) {
    const item = await crudService.create(String(req.params.resource), req.body, req.auth!.userId, req.ip);
    return res.status(201).json({ success: true, data: item, message: 'Tạo thành công' });
  },
  async update(req: Request, res: Response) {
    return ok(
      res,
      await crudService.update(String(req.params.resource), Number(req.params.id), req.body, req.auth!.userId, req.ip),
      'Cập nhật thành công',
    );
  },
  async remove(req: Request, res: Response) {
    return ok(
      res,
      await crudService.remove(String(req.params.resource), Number(req.params.id), req.auth!.userId, req.ip),
      'Xóa thành công',
    );
  },
};
