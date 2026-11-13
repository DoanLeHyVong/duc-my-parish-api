import type { Request, Response } from 'express';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
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
  event: async (req: Request, res: Response) => {
    const event = await prisma.event.findFirst({ where: { slug: String(req.params.slug), isActive: true } });
    if (!event) throw new ApiError(404, 'Không tìm thấy sự kiện');
    return ok(res, event);
  },
  announcements: async (_req: Request, res: Response) => ok(res, await prisma.announcement.findMany({ where: { isActive: true }, orderBy: { startsAt: 'desc' } })),
  albums: async (_req: Request, res: Response) => ok(res, await prisma.album.findMany({ where: { isPublished: true } })),
  album: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new ApiError(404, 'Không tìm thấy album');
    const album = await prisma.album.findFirst({ where: { id, isPublished: true }, include: { media: { include: { media: true } } } });
    if (!album) throw new ApiError(404, 'Không tìm thấy album');
    return ok(res, album);
  },
  profile: async (_req: Request, res: Response) => ok(res, await prisma.parishProfile.findFirst()),
  sitemap: async (_req: Request, res: Response) => {
    const rawOrigin = env.CLIENT_URL.split(',')[0]?.trim();
    let site: URL;
    try { site = new URL(rawOrigin || ''); } catch { throw new ApiError(503, 'Chưa cấu hình URL website HTTPS cho sitemap'); }
    if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash)
      throw new ApiError(503, 'URL website HTTPS cho sitemap phải là origin hợp lệ');
    const origin = site.origin;
    const now = new Date();
    const [posts, categories, events, albums, policies] = await prisma.$transaction([
      prisma.post.findMany({ where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: now } }, select: { slug: true } }),
      prisma.category.findMany({ where: { isActive: true }, select: { slug: true } }),
      prisma.event.findMany({ where: { isActive: true }, select: { slug: true } }),
      prisma.album.findMany({ where: { isPublished: true }, select: { id: true } }),
      prisma.policy.findMany({ where: { revisions: { some: { status: 'PUBLISHED' } } }, select: { slug: true } }),
    ]);
    const policyPaths: Record<string, string> = { 'privacy-policy': '/privacy', 'terms-of-use': '/terms', support: '/support', 'data-request': '/data-request' };
    const paths = ['/', '/about', '/mass-schedule', '/events', '/gallery', '/contact',
      ...posts.map((post) => `/posts/${encodeURIComponent(post.slug)}`),
      ...categories.map((category) => `/categories/${encodeURIComponent(category.slug)}`),
      ...events.map((event) => `/events/${encodeURIComponent(event.slug)}`),
      ...albums.map((album) => `/gallery/${album.id}`),
      ...policies.map((policy) => policyPaths[policy.slug]).filter((path): path is string => Boolean(path))];
    const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`).join('')}</urlset>`);
  },
};
