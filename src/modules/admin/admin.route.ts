import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { adminController as c } from './admin.controller.js';

export const adminRouter = Router();
adminRouter.get('/:resource', asyncHandler(c.list));
adminRouter.get('/:resource/:id', asyncHandler(c.get));
adminRouter.post('/:resource', asyncHandler(c.create));
adminRouter.put('/:resource/:id', asyncHandler(c.update));
adminRouter.patch('/:resource/:id', asyncHandler(c.update));
adminRouter.delete('/:resource/:id', asyncHandler(c.remove));
