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

const delegateFor = (resource: string) => {
  const model = resourceModels[resource];
  if (!model) throw new ApiError(404, 'Tài nguyên quản trị không tồn tại');
  return (prisma as any)[model];
};

const prepareData = async (resource: string, raw: Record<string, any>, actorId: string, creating: boolean) => {
  const data = { ...raw };
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
    const item = await delegateFor(resource).findUnique({ where: { id } });
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
