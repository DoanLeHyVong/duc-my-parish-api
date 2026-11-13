import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/api-error.js';

const postInclude = {
  featuredImage: true,
  categories: { include: { category: true } },
  tags: { include: { tag: true } },
};

export const publicService = {
  async home() {
    const now = new Date();
    const [profile, banners, menu, footerMenu, sections, posts, announcements, massSchedules, events, albums] =
      await prisma.$transaction([
        prisma.parishProfile.findFirst(),
        prisma.banner.findMany({ where: { isActive: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] }, orderBy: { sortOrder: 'asc' } }),
        prisma.menu.findFirst({
          where: { location: 'HEADER', isActive: true },
          include: { items: { where: { isVisible: true }, orderBy: { sortOrder: 'asc' } } },
        }),
        prisma.menu.findFirst({
          where: { location: 'FOOTER', isActive: true },
          include: { items: { where: { isVisible: true }, orderBy: { sortOrder: 'asc' } } },
        }),
        prisma.homeSection.findMany({
          where: { isVisible: true },
          orderBy: { sortOrder: 'asc' },
          include: { category: true },
        }),
        prisma.post.findMany({
          where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: now } },
          orderBy: { publishedAt: 'desc' },
          take: 30,
          include: postInclude,
        }),
        prisma.announcement.findMany({
          where: { isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          orderBy: [{ isPinned: 'desc' }, { startsAt: 'desc' }],
          take: 5,
        }),
        prisma.massSchedule.findMany({ where: { isActive: true }, orderBy: [{ dayOfWeek: 'asc' }, { sortOrder: 'asc' }] }),
        prisma.event.findMany({ where: { isActive: true, startsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 8 }),
        prisma.album.findMany({ where: { isPublished: true }, orderBy: { eventDate: 'desc' }, take: 8 }),
      ]);
    return { profile, banners, menu, footerMenu, sections, posts, announcements, massSchedules, events, albums };
  },
  menu: () =>
    prisma.menu.findFirst({
      where: { location: 'HEADER', isActive: true },
      include: { items: { where: { isVisible: true }, orderBy: { sortOrder: 'asc' } } },
    }),
  async posts(query: Record<string, unknown>) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50);
    const search = typeof query.q === 'string' ? query.q : undefined;
    const where = {
      status: 'PUBLISHED' as const,
      deletedAt: null,
      publishedAt: { lte: new Date() },
      ...(search ? { OR: [{ title: { contains: search } }, { excerpt: { contains: search } }] } : {}),
    };
    const [data, total] = await prisma.$transaction([
      prisma.post.findMany({ where, include: postInclude, orderBy: { publishedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.post.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
  async post(slug: string) {
    const post = await prisma.post.findFirst({ where: { slug, status: 'PUBLISHED', publishedAt: { lte: new Date() }, deletedAt: null }, include: postInclude });
    if (!post) throw new ApiError(404, 'Không tìm thấy bài viết');
    await prisma.post.update({ where: { id: post.id }, data: { viewCount: { increment: 1 } } });
    return post;
  },
  async categoryPosts(slug: string) {
    const category = await prisma.category.findFirst({ where: { slug, isActive: true } });
    if (!category) throw new ApiError(404, 'Không tìm thấy chuyên mục');
    const posts = await prisma.post.findMany({
      where: { status: 'PUBLISHED', publishedAt: { lte: new Date() }, deletedAt: null, categories: { some: { categoryId: category.id } } },
      include: postInclude,
      orderBy: { publishedAt: 'desc' },
    });
    return { category, posts };
  },
};
