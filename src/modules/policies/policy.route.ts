import { createHash } from 'node:crypto';
import { Router } from 'express';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { PolicyKind, PolicyRevisionStatus, Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { ApiError } from '../../lib/api-error.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize, Permission } from '../../middleware/authorize.js';

const slugSchema = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100) });
const revisionParamsSchema = z.object({ slug: slugSchema.shape.slug, revision: z.coerce.number().int().positive() });
const policySchema = z.object({ kind: z.enum(PolicyKind), slug: slugSchema.shape.slug, title: z.string().trim().min(2).max(180), contentHtml: z.string().min(1).max(500_000) });
const draftSchema = policySchema.pick({ title: true, contentHtml: true });
const publishSchema = z.object({ revision: z.number().int().positive() });

function cleanHtml(value: string): string {
  const cleaned = sanitizeHtml(value, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'figure', 'figcaption', 'h1', 'h2'],
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'loading'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: (_tagName, attribs) => ({ tagName: 'a', attribs: { ...attribs, ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}) } }) },
  });
  if (!cleaned.replace(/<[^>]+>/g, '').trim()) throw new ApiError(422, 'INVALID_POLICY_HTML', 'Nội dung chính sách không hợp lệ.');
  return cleaned;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const publicPolicyRouter = Router();
publicPolicyRouter.get('/:slug', asyncHandler(async (request, response) => {
  const { slug } = slugSchema.parse(request.params);
  const item = await prisma.policy.findUnique({ where: { slug }, include: { revisions: { where: { status: PolicyRevisionStatus.PUBLISHED }, orderBy: [{ publishedAt: 'desc' }, { revision: 'desc' }], take: 1, select: { revision: true, title: true, contentHtml: true, publishedAt: true } } } });
  const published = item?.revisions[0];
  if (!item || !published) throw new ApiError(404, 'POLICY_NOT_FOUND', 'Không tìm thấy chính sách đã công bố.');
  response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  response.json({ data: { kind: item.kind, slug: item.slug, ...published } });
}));

export const policyAdminRouter = Router();
policyAdminRouter.use(authenticate, authorize(Permission.POLICIES_MANAGE));

policyAdminRouter.get('/', asyncHandler(async (_request, response) => {
  const items = await prisma.policy.findMany({ orderBy: { kind: 'asc' }, include: { revisions: { orderBy: { revision: 'desc' }, select: { revision: true, status: true, title: true, createdAt: true, publishedAt: true } } } });
  response.json({ data: items });
}));

policyAdminRouter.post('/', asyncHandler(async (request, response) => {
  const input = policySchema.parse(request.body);
  const contentHtml = cleanHtml(input.contentHtml);
  try {
    const item = await prisma.$transaction(async (tx) => {
      const policy = await tx.policy.create({ data: { kind: input.kind, slug: input.slug, title: input.title } });
      await tx.policyRevision.create({ data: { policyId: policy.id, revision: 1, title: input.title, contentHtml, contentHash: hash(contentHtml), createdById: request.auth!.userId } });
      await tx.auditLog.create({ data: { actorId: request.auth!.userId, action: 'POLICY_CREATED', entityType: 'policy', entityId: policy.id } });
      return tx.policy.findUniqueOrThrow({ where: { id: policy.id }, include: { revisions: true } });
    });
    response.status(201).json({ data: item });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(409, 'POLICY_EXISTS', 'Loại hoặc đường dẫn chính sách đã tồn tại.');
    throw error;
  }
}));

policyAdminRouter.post('/:slug/revisions', asyncHandler(async (request, response) => {
  const { slug } = slugSchema.parse(request.params);
  const input = draftSchema.parse(request.body);
  const contentHtml = cleanHtml(input.contentHtml);
  const revision = await prisma.$transaction(async (tx) => {
    const policy = await tx.policy.findUnique({ where: { slug }, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } } });
    if (!policy) throw new ApiError(404, 'POLICY_NOT_FOUND', 'Không tìm thấy chính sách.');
    const nextRevision = (policy.revisions[0]?.revision ?? 0) + 1;
    const created = await tx.policyRevision.create({ data: { policyId: policy.id, revision: nextRevision, title: input.title, contentHtml, contentHash: hash(contentHtml), createdById: request.auth!.userId } });
    await tx.policy.update({ where: { id: policy.id }, data: { title: input.title } });
    await tx.auditLog.create({ data: { actorId: request.auth!.userId, action: 'POLICY_REVISION_CREATED', entityType: 'policy', entityId: policy.id, metadata: { revision: nextRevision } } });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.status(201).json({ data: revision });
}));

policyAdminRouter.get('/:slug/revisions/:revision', asyncHandler(async (request, response) => {
  const input = revisionParamsSchema.parse(request.params);
  const item = await prisma.policyRevision.findFirst({ where: { revision: input.revision, policy: { slug: input.slug } } });
  if (!item) throw new ApiError(404, 'POLICY_REVISION_NOT_FOUND', 'Không tìm thấy phiên bản chính sách.');
  response.json({ data: item });
}));

policyAdminRouter.post('/:slug/publish', asyncHandler(async (request, response) => {
  const { slug } = slugSchema.parse(request.params);
  const input = publishSchema.parse(request.body);
  const published = await prisma.$transaction(async (tx) => {
    const policy = await tx.policy.findUnique({ where: { slug } });
    if (!policy) throw new ApiError(404, 'POLICY_NOT_FOUND', 'Không tìm thấy chính sách.');
    const draft = await tx.policyRevision.findUnique({ where: { policyId_revision: { policyId: policy.id, revision: input.revision } } });
    if (!draft) throw new ApiError(404, 'POLICY_REVISION_NOT_FOUND', 'Không tìm thấy phiên bản chính sách.');
    if (draft.status !== PolicyRevisionStatus.DRAFT) throw new ApiError(409, 'POLICY_ALREADY_PUBLISHED', 'Phiên bản này đã được công bố.');
    if (draft.contentHash !== hash(cleanHtml(draft.contentHtml))) throw new ApiError(409, 'STALE_POLICY_REVISION', 'Nội dung phiên bản đã thay đổi; không thể công bố.');
    const changed = await tx.policyRevision.updateMany({ where: { id: draft.id, status: PolicyRevisionStatus.DRAFT, contentHash: draft.contentHash }, data: { status: PolicyRevisionStatus.PUBLISHED, publishedById: request.auth!.userId, publishedAt: new Date() } });
    if (changed.count !== 1) throw new ApiError(409, 'STALE_POLICY_REVISION', 'Phiên bản vừa thay đổi. Vui lòng tải lại.');
    await tx.auditLog.create({ data: { actorId: request.auth!.userId, action: 'POLICY_PUBLISHED', entityType: 'policy', entityId: policy.id, metadata: { revision: input.revision } } });
    return tx.policyRevision.findUniqueOrThrow({ where: { id: draft.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.json({ data: published });
}));
