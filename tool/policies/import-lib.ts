import { PolicyRevisionStatus, Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import { hash, type LegacyPolicy } from './legacy.js';

export type ImportMode = '--apply' | '--check';
export function assertSafePolicyDatabase(database: string): void {
  const unsafePurpose = /(?:^|_)(?:prod|production|source|legacy)(?:_|$)/i.test(database);
  if (unsafePurpose || !/^appglv_(?:(?:unified|policy)(?:_[a-z0-9]+)*_)?(?:local|test|disposable)$/i.test(database)) {
    throw new Error('POLICY_DATABASE_URL database must be an explicitly safe AppGLV local/test/disposable name.');
  }
}

const auditMetadata = (item: LegacyPolicy, revision: number) => ({
  sourceFile: item.file,
  sourceSha256: item.sha256,
  contentSha256: item.contentHash,
  revision,
});

const sameMetadata = (actual: Prisma.JsonValue | null, expected: ReturnType<typeof auditMetadata>) =>
  actual !== null && typeof actual === 'object' && !Array.isArray(actual) &&
  Object.entries(expected).every(([key, value]) => actual[key] === value);

export async function importLegacyPolicies(
  client: PrismaClient,
  mode: ImportMode,
  actorId: string,
  policies: LegacyPolicy[],
) {
  return client.$transaction(async (tx) => {
    const actor = await tx.user.findFirst({
      where: {
        id: actorId,
        isActive: true,
        deletedAt: null,
        roleAssignments: { some: { role: { permissions: { some: { permission: { code: 'policies.manage' } } } } } },
      },
      select: { id: true },
    });
    if (!actor) throw new Error('POLICY_ACTOR_ID must identify an active user authorized for policies.manage.');

    const evidence = [];
    for (const item of policies) {
      let policy = await tx.policy.findUnique({ where: { slug: item.slug }, include: { revisions: true } });
      if (!policy && mode === '--apply') {
        policy = await tx.policy.create({
          data: {
            slug: item.slug,
            kind: item.kind,
            title: item.title,
            revisions: { create: { revision: 1, title: item.title, contentHtml: item.contentHtml, contentHash: item.contentHash, createdById: actorId } },
          },
          include: { revisions: true },
        });
      }
      if (!policy) throw new Error(`Missing policy: ${item.slug}`);
      if (policy.kind !== item.kind || policy.title !== item.title) throw new Error(`Policy identity/title mismatch: ${item.slug}`);

      const drafts = policy.revisions.filter((revision) => revision.status === PolicyRevisionStatus.DRAFT);
      const draft = drafts[0];
      if (drafts.length !== 1 || !draft || draft.title !== item.title || draft.contentHash !== item.contentHash || hash(draft.contentHtml) !== item.contentHash) {
        throw new Error(`Draft state differs; review before import: ${item.slug}`);
      }

      const audits = await tx.auditLog.findMany({
        where: { action: 'POLICY_LEGACY_DRAFT_IMPORTED', entityType: 'policy', entityId: policy.id },
      });
      const expectedMetadata = auditMetadata(item, draft.revision);
      if (audits.length === 0 && mode === '--apply') {
        await tx.auditLog.create({ data: { actorId, action: 'POLICY_LEGACY_DRAFT_IMPORTED', entityType: 'policy', entityId: policy.id, metadata: expectedMetadata } });
      } else if (audits.length !== 1 || audits[0]!.actorId !== actorId || !sameMetadata(audits[0]!.metadata, expectedMetadata)) {
        throw new Error(`Import audit provenance missing or conflicting: ${item.slug}`);
      }

      evidence.push({ slug: item.slug, status: draft.status, revision: draft.revision, sourceSha256: item.sha256, normalizedSha256: item.contentHash });
    }
    return evidence;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
