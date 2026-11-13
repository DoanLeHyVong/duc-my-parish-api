import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const database = vi.hoisted(() => ({
  parishProfileCreate: vi.fn(), parishProfileUpdate: vi.fn(), bannerCreate: vi.fn(), menuItemCreate: vi.fn(), auditCreate: vi.fn(),
  mediaFind: vi.fn(), mediaUpdate: vi.fn(), transaction: vi.fn(), cloudDestroy: vi.fn(),
  postFindMany: vi.fn(), categoryFindMany: vi.fn(), eventFindMany: vi.fn(), policyFindMany: vi.fn(),
  albumFindFirst: vi.fn(), albumFindMany: vi.fn(), categoryFindFirst: vi.fn(),
  homeSectionCreate: vi.fn(), mediaCreate: vi.fn(), cloudUpload: vi.fn(), cloudUrl: vi.fn(),
}));
vi.mock('../src/config/env.js', () => ({ env: { CLIENT_URL: 'https://giaoxu.example.test' } }));
vi.mock('../src/config/prisma.js', () => ({ prisma: {
  parishProfile: { create: database.parishProfileCreate, update: database.parishProfileUpdate },
  banner: { create: database.bannerCreate }, homeSection: { create: database.homeSectionCreate }, menuItem: { create: database.menuItemCreate },
  auditLog: { create: database.auditCreate },
  media: { findUnique: database.mediaFind, update: database.mediaUpdate, create: database.mediaCreate },
  post: { findMany: database.postFindMany }, category: { findMany: database.categoryFindMany, findFirst: database.categoryFindFirst },
  event: { findMany: database.eventFindMany }, policy: { findMany: database.policyFindMany },
  album: { findFirst: database.albumFindFirst, findMany: database.albumFindMany },
  $transaction: database.transaction,
} }));
vi.mock('../src/config/cloudinary.js', () => ({ cloudinary: { uploader: { destroy: database.cloudDestroy, upload_stream: database.cloudUpload }, url: database.cloudUrl }, cloudinaryConfigured: true }));
import { crudService } from '../src/services/crud.service.js';
import { mediaService } from '../src/modules/media/media.service.js';
import { publicController } from '../src/modules/public/public.controller.js';
import { publicService } from '../src/modules/public/public.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  database.parishProfileCreate.mockResolvedValue({ id: 1 });
  database.parishProfileUpdate.mockResolvedValue({ id: 1 });
  database.bannerCreate.mockResolvedValue({ id: 2 });
  database.menuItemCreate.mockResolvedValue({ id: 3 });
  database.auditCreate.mockResolvedValue({ id: 4 });
  database.mediaFind.mockResolvedValue({ id: 8, cloudinaryPublicId: 'asset' });
  database.mediaUpdate.mockResolvedValue({ id: 8 });
  database.mediaCreate.mockResolvedValue({ id: 9, secureUrl: 'https://cdn.example.test/image.png' });
  database.homeSectionCreate.mockResolvedValue({ id: 5 });
  database.cloudUrl.mockReturnValue('https://cdn.example.test/thumb.png');
  database.cloudUpload.mockImplementation((_options, callback) => ({ end: () => callback(null, { public_id: 'asset', secure_url: 'https://cdn.example.test/image.png', resource_type: 'image', format: 'png', width: 64, height: 64, bytes: 10 }) }));
  database.transaction.mockImplementation((items) => Promise.all(items));
  database.postFindMany.mockResolvedValue([{ slug: 'tin-moi' }]);
  database.categoryFindMany.mockResolvedValue([{ slug: 'tin-giao-xu' }]);
  database.eventFindMany.mockResolvedValue([{ slug: 'le-hoi' }]);
  database.albumFindMany.mockResolvedValue([{ id: 17 }]);
  database.policyFindMany.mockResolvedValue([{ slug: 'privacy-policy' }]);
});

it('builds sitemap from published CMS records and configured Web origin', async () => {
  const send = vi.fn();
  const response = { type: vi.fn().mockReturnThis(), send };
  await publicController.sitemap({} as never, response as never);
  expect(database.postFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: expect.any(Date) } }) }));
  expect(database.policyFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { revisions: { some: { status: 'PUBLISHED' } } } }));
  expect(send.mock.calls[0]?.[0]).toContain('https://giaoxu.example.test/posts/tin-moi');
  expect(send.mock.calls[0]?.[0]).toContain('https://giaoxu.example.test/privacy');
  expect(send.mock.calls[0]?.[0]).toContain('https://giaoxu.example.test/gallery/17');
});

it('never exposes an unpublished album by its numeric ID', async () => {
  database.albumFindFirst.mockResolvedValue(null);
  await expect(publicController.album({ params: { id: '12' } } as never, {} as never)).rejects.toMatchObject({ statusCode: 404 });
  expect(database.albumFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 12, isPublished: true } }));
});

it('does not expose posts through a disabled category', async () => {
  database.categoryFindFirst.mockResolvedValue(null);
  await expect(publicService.categoryPosts('disabled')).rejects.toMatchObject({ statusCode: 404 });
  expect(database.categoryFindFirst).toHaveBeenCalledWith({ where: { slug: 'disabled', isActive: true } });
});

it('keeps Vietnamese seed labels in UTF-8 source without mojibake', () => {
  const source = readFileSync(new URL('../prisma/seed.ts', import.meta.url), 'utf8');
  expect(source).toContain('Phụng vụ');
  expect(source).toContain('Giờ lễ');
  expect(source).not.toMatch(/GiÃ|Phá»|Tin tá»/);
});

it('hides a media library item without destroying a published Cloudinary image', async () => {
  await mediaService.remove(8, 'admin');
  expect(database.mediaUpdate).toHaveBeenCalledWith({ where: { id: 8 }, data: { deletedAt: expect.any(Date) } });
  expect(database.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'HIDE_MEDIA' }) }));
  expect(database.cloudDestroy).not.toHaveBeenCalled();
});

it('uploads an image through the existing Cloudinary service', async () => {
  const result = await mediaService.upload([{ buffer: Buffer.from('synthetic'), originalname: 'test.png' }] as never, 'admin', 'branding');
  expect(result[0]).toMatchObject({ id: 9, secureUrl: 'https://cdn.example.test/image.png' });
  expect(database.cloudUpload).toHaveBeenCalledWith(expect.objectContaining({ folder: 'giao-xu-duc-my/branding' }), expect.any(Function));
});

describe('CMS writes', () => {
  it('saves optional branding and writes audit evidence', async () => {
    await crudService.update('parish-profile', 1, { name: 'Giáo xứ thử nghiệm', faviconUrl: 'https://cdn.example.org/favicon.png', pageSeo: { '/about': { title: 'Giới thiệu mới' } } }, 'admin');
    expect(database.parishProfileUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ faviconUrl: 'https://cdn.example.org/favicon.png', pageSeo: { '/about': { title: 'Giới thiệu mới' } } }) }));
    expect(database.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'UPDATE_PARISH-PROFILE' }) }));
  });
  it('persists banner and section CMS values for public rendering', async () => {
    await crudService.create('banners', { title: 'Thông báo', imageUrl: 'https://cdn.example.test/banner.png', secondaryText: 'Xem thêm', secondaryUrl: '/events' }, 'admin');
    await crudService.create('home-sections', { sectionKey: 'news', title: 'Tin tức', componentType: 'GRID', displayLimit: 3, settings: { body: 'Từ Admin', ctaUrl: '/events' } }, 'admin');
    expect(database.bannerCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ secondaryUrl: '/events' }) }));
    expect(database.homeSectionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ displayLimit: 3 }) }));
    expect(database.auditCreate).toHaveBeenCalledTimes(2);
  });
  it('rejects script URLs, unknown fields and unsafe section links before writing', async () => {
    await expect(crudService.create('banners', { title: 'X', imageUrl: 'javascript:alert(1)' }, 'admin')).rejects.toMatchObject({ statusCode: 422 });
    await expect(crudService.update('parish-profile', 1, { passwordHash: 'unsafe' }, 'admin')).rejects.toMatchObject({ statusCode: 422 });
    await expect(crudService.create('home-sections', { sectionKey: 'x', title: 'X', settings: { ctaUrl: 'javascript:alert(1)' } }, 'admin')).rejects.toMatchObject({ statusCode: 422 });
    await expect(crudService.create('menu-items', { menuId: 1, label: 'X', url: 'javascript:alert(1)' }, 'admin')).rejects.toMatchObject({ statusCode: 422 });
    await expect(crudService.update('parish-profile', 1, { pageSeo: { '/admin': { title: 'Unsafe' } } }, 'admin')).rejects.toMatchObject({ statusCode: 422 });
    await expect(crudService.create('banners', { title: 'X', imageUrl: 'https://cdn.example.test/x.png', startsAt: '2026-12-02T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }, 'admin')).rejects.toMatchObject({ statusCode: 422 });
    expect(database.auditCreate).not.toHaveBeenCalled();
  });
});
