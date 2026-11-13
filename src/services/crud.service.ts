import sanitizeHtml from 'sanitize-html';
import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/api-error.js';
import { normalizeDateTimeFields } from '../utils/normalize-datetime.js';

const resourceModels: Record<string, string> = {
  posts: 'post',
  categories: 'category',
  tags: 'tag',
  menus: 'menu',
  'menu-items': 'menuItem',
  banners: 'banner',
  'home-sections': 'homeSection',
  announcements: 'announcement',
  'mass-schedules': 'massSchedule',
  'special-masses': 'specialMass',
  events: 'event',
  albums: 'album',
  'parish-profile': 'parishProfile',
  clergy: 'clergy',
  organizations: 'organization',
  settings: 'setting',
};

const cmsFields: Record<string, readonly string[]> = {
  'parish-profile': ['name', 'diocese', 'patronSaint', 'description', 'address', 'phone', 'email', 'mapEmbedUrl', 'logoUrl', 'faviconUrl', 'heroUrl', 'tagline', 'footerText', 'copyrightText', 'seoTitle', 'seoDescription', 'ogImageUrl', 'pageSeo', 'facebookUrl', 'youtubeUrl'],
  banners: ['title', 'subtitle', 'imageUrl', 'mobileImageUrl', 'primaryText', 'primaryUrl', 'secondaryText', 'secondaryUrl', 'sortOrder', 'isActive', 'startsAt', 'endsAt'],
  'home-sections': ['sectionKey', 'title', 'componentType', 'categoryId', 'displayLimit', 'sortOrder', 'settings', 'isVisible'],
  categories: ['parentId', 'name', 'slug', 'description', 'seoTitle', 'seoDescription', 'imageId', 'sortOrder', 'isActive'],
  events: ['title', 'slug', 'description', 'seoTitle', 'seoDescription', 'startsAt', 'endsAt', 'location', 'imageUrl', 'isFeatured', 'isActive'],
  albums: ['title', 'slug', 'description', 'seoTitle', 'seoDescription', 'coverUrl', 'eventDate', 'isPublished'],
  menus: ['name', 'location', 'isActive'],
  'menu-items': ['menuId', 'parentId', 'label', 'url', 'linkType', 'target', 'sortOrder', 'isVisible'],
};
const cmsUrlFields = new Set(['mapEmbedUrl', 'logoUrl', 'faviconUrl', 'heroUrl', 'ogImageUrl', 'facebookUrl', 'youtubeUrl', 'imageUrl', 'mobileImageUrl', 'primaryUrl', 'secondaryUrl', 'coverUrl']);
const isSafeCmsUrl = (value: string) => {
  if ([...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === '\\')) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (!value.startsWith('https://')) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

function validateCmsData(resource: string, data: Record<string, any>) {
  const allowed = cmsFields[resource];
  if (!allowed) return;
  if (resource === 'banners' && data.startsAt && data.endsAt && new Date(data.startsAt) > new Date(data.endsAt))
    throw new ApiError(422, 'Thời gian kết thúc banner phải sau thời gian bắt đầu');
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.includes(key)) throw new ApiError(422, `Trường ${key} không được phép chỉnh sửa`);
    if (value == null) continue;
    if (key === 'pageSeo') {
      const paths = new Set(['/about', '/contact', '/mass-schedule', '/events', '/gallery', '/privacy', '/terms', '/support', '/data-request']);
      if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((path) => !paths.has(path)) || JSON.stringify(value).length > 20000)
        throw new ApiError(422, 'Cấu hình SEO trang không hợp lệ');
      for (const entry of Object.values(value)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some((field) => !['title', 'description', 'image'].includes(field)))
          throw new ApiError(422, 'Thông tin SEO trang không hợp lệ');
        for (const [field, text] of Object.entries(entry)) {
          if (typeof text !== 'string' || text.length > (field === 'description' ? 2000 : 500) || (field === 'image' && text !== '' && !isSafeCmsUrl(text)))
            throw new ApiError(422, 'Giá trị SEO trang không hợp lệ');
        }
      }
      continue;
    }
    if (key === 'componentType' && !['GRID', 'LIST', 'FEATURED', 'SLIDER'].includes(String(value))) throw new ApiError(422, 'Kiểu section không hợp lệ');
    if (key === 'displayLimit' && (!Number.isInteger(value) || value < 1 || value > 30)) throw new ApiError(422, 'Số mục hiển thị phải từ 1 đến 30');
    if (key === 'location' && resource === 'menus' && !['HEADER', 'FOOTER'].includes(String(value))) throw new ApiError(422, 'Vị trí menu không hợp lệ');
    if (key === 'settings') {
      if (typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 10000) throw new ApiError(422, 'Cấu hình section không hợp lệ');
      if (typeof value.ctaUrl === 'string' && value.ctaUrl && !isSafeCmsUrl(value.ctaUrl)) throw new ApiError(422, 'URL nút section không hợp lệ');
      if (typeof value.imageUrl === 'string' && value.imageUrl && !isSafeCmsUrl(value.imageUrl)) throw new ApiError(422, 'URL ảnh section không hợp lệ');
    } else if (key === 'url' && resource === 'menu-items') {
      if (typeof value !== 'string' || !isSafeCmsUrl(value)) throw new ApiError(422, 'URL menu không hợp lệ');
    } else if (cmsUrlFields.has(key)) {
      if (typeof value !== 'string' || (value !== '' && !isSafeCmsUrl(value))) throw new ApiError(422, `URL ${key} phải là HTTPS hoặc đường dẫn nội bộ`);
    } else if (typeof value === 'string' && value.length > (['description', 'seoDescription', 'footerText', 'copyrightText', 'tagline'].includes(key) ? 50000 : 2000)) {
      throw new ApiError(422, `Trường ${key} quá dài`);
    }
  }
}

const delegateFor = (resource: string) => {
  const model = resourceModels[resource];
  if (!model) throw new ApiError(404, 'Tài nguyên quản trị không tồn tại');
  return (prisma as any)[model];
};

const prepareData = async (resource: string, raw: Record<string, any>, actorId: string, creating: boolean) => {
  const data = { ...raw };
  validateCmsData(resource, data);
  for (const key of ['id', 'createdAt', 'updatedAt', 'deletedAt', 'viewCount', 'passwordHash'])
    delete data[key];
  if (resource === 'posts') {
    data.content = sanitizeHtml(data.content || '', {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'figure', 'figcaption']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt', 'width', 'height', 'loading'] },
      allowedSchemes: ['http', 'https'],
    });
    if (creating) data.authorId = actorId;
    const categoryIds = data.categoryIds as number[] | undefined;
    const tagIds = data.tagIds as number[] | undefined;
    delete data.categoryIds;
    delete data.tagIds;
    if (categoryIds)
      data.categories = {
        ...(creating ? {} : { deleteMany: {} }),
        create: categoryIds.map((categoryId) => ({ categoryId })),
      };
    if (tagIds)
      data.tags = {
        ...(creating ? {} : { deleteMany: {} }),
        create: tagIds.map((tagId) => ({ tagId })),
      };
  }
  if (resource === 'home-sections') data.settings ??= {};
  return normalizeDateTimeFields(resource, data);
};

export const crudService = {
  async list(resource: string, query: Record<string, unknown>) {
    const delegate = delegateFor(resource);
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const where =
      ['posts', 'media'].includes(resource) && query.trash !== 'true'
        ? { deletedAt: null }
        : {};
    const [data, total] = await Promise.all([
      delegate.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { id: 'desc' } }),
      delegate.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
  async get(resource: string, id: number) {
    const item = await delegateFor(resource).findUnique({ where: { id }, ...(resource === 'posts' ? { include: { featuredImage: true, categories: true } } : {}) });
    if (!item) throw new ApiError(404, 'Không tìm thấy dữ liệu');
    return item;
  },
  async create(resource: string, raw: Record<string, any>, actorId: string, ipAddress?: string) {
    const data = await prepareData(resource, raw, actorId, true);
    const item = await delegateFor(resource).create({ data });
    await prisma.auditLog.create({
      data: { actorId, action: `CREATE_${resource.toUpperCase()}`, entityType: resource, entityId: String(item.id), ipAddress },
    });
    return item;
  },
  async update(resource: string, id: number, raw: Record<string, any>, actorId: string, ipAddress?: string) {
    const data = await prepareData(resource, raw, actorId, false);
    const item = await delegateFor(resource).update({ where: { id }, data });
    await prisma.auditLog.create({
      data: { actorId, action: `UPDATE_${resource.toUpperCase()}`, entityType: resource, entityId: String(id), ipAddress },
    });
    return item;
  },
  async remove(resource: string, id: number, actorId: string, ipAddress?: string) {
    const delegate = delegateFor(resource);
    const item = ['posts', 'media'].includes(resource)
      ? await delegate.update({ where: { id }, data: { deletedAt: new Date() } })
      : await delegate.delete({ where: { id } });
    await prisma.auditLog.create({
      data: { actorId, action: `DELETE_${resource.toUpperCase()}`, entityType: resource, entityId: String(id), ipAddress },
    });
    return item;
  },
};
