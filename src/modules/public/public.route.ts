import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { publicController as c } from './public.controller.js';

export const publicRouter = Router();
publicRouter.get('/home', asyncHandler(c.home));
publicRouter.get('/menu', asyncHandler(c.menu));
publicRouter.get('/posts', asyncHandler(c.posts));
publicRouter.get('/posts/:slug', asyncHandler(c.post));
publicRouter.get('/categories/:slug/posts', asyncHandler(c.categoryPosts));
publicRouter.get('/search', asyncHandler(c.posts));
publicRouter.get('/mass-schedules', asyncHandler(c.massSchedules));
publicRouter.get('/events', asyncHandler(c.events));
publicRouter.get('/announcements', asyncHandler(c.announcements));
publicRouter.get('/albums', asyncHandler(c.albums));
publicRouter.get('/albums/:id', asyncHandler(c.album));
publicRouter.get('/parish-profile', asyncHandler(c.profile));
