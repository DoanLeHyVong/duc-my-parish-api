import { Router } from 'express';
import { upload } from '../../middlewares/upload.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { mediaController } from './media.controller.js';

export const mediaRouter = Router();
mediaRouter.get('/', asyncHandler(mediaController.list));
mediaRouter.post('/upload', upload.array('files', 20), asyncHandler(mediaController.upload));
mediaRouter.delete('/:id', asyncHandler(mediaController.remove));
