import type { Request, Response } from 'express';
import { prisma } from '../../config/prisma.js';
import { ok } from '../../utils/response.js';
import { publicService } from './public.service.js';

export const publicController = {
  home: async (_req: Request, res: Response) => ok(res, await publicService.home()),
  menu: async (_req: Request, res: Response) => ok(res, await publicService.menu()),
  posts: async (req: Request, res: Response) => {
    const result = await publicService.posts(req.query);
    res.json({ success: true, ...result });
  },
  post: async (req: Request, res: Response) => ok(res, await publicService.post(String(req.params.slug))),
  categoryPosts: async (req: Request, res: Response) => ok(res, await publicService.categoryPosts(String(req.params.slug))),
  massSchedules: async (_req: Request, res: Response) => ok(res, await prisma.massSchedule.findMany({ where: { isActive: true } })),
  events: async (_req: Request, res: Response) => ok(res, await prisma.event.findMany({ where: { isActive: true }, orderBy: { startsAt: 'asc' } })),
  announcements: async (_req: Request, res: Response) => ok(res, await prisma.announcement.findMany({ where: { isActive: true }, orderBy: { startsAt: 'desc' } })),
  albums: async (_req: Request, res: Response) => ok(res, await prisma.album.findMany({ where: { isPublished: true } })),
  album: async (req: Request, res: Response) => ok(res, await prisma.album.findUnique({ where: { id: Number(req.params.id) }, include: { media: { include: { media: true } } } })),
  profile: async (_req: Request, res: Response) => ok(res, await prisma.parishProfile.findFirst()),
};
