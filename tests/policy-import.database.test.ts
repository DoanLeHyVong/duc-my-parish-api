import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PolicyKind, PolicyRevisionStatus, RoleCode } from '../src/generated/prisma/client.js';
import { getEnv } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { importLegacyPolicies } from '../tool/policies/import-lib.js';
import { bundledLegacyPolicyDirectory, loadLegacyPolicies } from '../tool/policies/legacy.js';

const actorId = 'policy_import_test_actor';
const policies = await loadLegacyPolicies(bundledLegacyPolicyDirectory);

async function clean() {
  if (getEnv().DATABASE_NAME !== 'appglv_unified_test') throw new Error('Policy import tests refuse any database other than appglv_unified_test.');
  await prisma.policyRevision.deleteMany();
  await prisma.policy.deleteMany();
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId }, { action: 'POLICY_LEGACY_DRAFT_IMPORTED' }] } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: actorId } });
  await prisma.user.deleteMany({ where: { id: actorId } });
}

async function createActor(active = true, role = RoleCode.PARISH_ADMIN) {
  return prisma.user.create({
    data: {
      id: actorId,
      username: actorId,
      displayName: 'Policy import test actor',
      passwordHash: 'not-used-by-this-test',
      isActive: active,
      roleAssignments: { create: { role: { connect: { code: role } } } },
    },
  });
}

beforeEach(clean);
afterAll(async () => { await clean(); await prisma.$disconnect(); });

describe('legacy policy database import', () => {
  it('applies and checks idempotently without publishing', async () => {
    await createActor();
    await importLegacyPolicies(prisma, '--apply', actorId, policies);
    await importLegacyPolicies(prisma, '--apply', actorId, policies);
    await importLegacyPolicies(prisma, '--check', actorId, policies);

    expect(await prisma.policy.count()).toBe(4);
    expect(await prisma.policyRevision.count()).toBe(4);
    expect(await prisma.policyRevision.count({ where: { status: PolicyRevisionStatus.PUBLISHED } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'POLICY_LEGACY_DRAFT_IMPORTED' } })).toBe(4);
  });

  it('requires an active policies.manage actor', async () => {
    await createActor(false);
    await expect(importLegacyPolicies(prisma, '--apply', actorId, policies)).rejects.toThrow(/active user authorized/);
    expect(await prisma.policy.count()).toBe(0);
  });

  it('requires provenance for a matching pre-existing draft and adds it once on apply', async () => {
    await createActor();
    const item = policies[0]!;
    await prisma.policy.create({ data: { kind: item.kind, slug: item.slug, title: item.title, revisions: { create: { revision: 1, title: item.title, contentHtml: item.contentHtml, contentHash: item.contentHash, createdById: actorId } } } });
    await expect(importLegacyPolicies(prisma, '--check', actorId, [item])).rejects.toThrow(/provenance/);
    await importLegacyPolicies(prisma, '--apply', actorId, [item]);
    await importLegacyPolicies(prisma, '--apply', actorId, [item]);
    expect(await prisma.auditLog.count({ where: { action: 'POLICY_LEGACY_DRAFT_IMPORTED' } })).toBe(1);
  });

  it('rolls back earlier writes when later draft state conflicts', async () => {
    await createActor();
    const conflict = policies[1]!;
    await prisma.policy.create({ data: { kind: PolicyKind.TERMS, slug: conflict.slug, title: conflict.title, revisions: { create: { revision: 1, title: 'Conflicting draft', contentHtml: '<p>Conflict</p>', contentHash: '0'.repeat(64), createdById: actorId } } } });
    await expect(importLegacyPolicies(prisma, '--apply', actorId, policies)).rejects.toThrow(/Draft state differs/);
    expect(await prisma.policy.findUnique({ where: { slug: policies[0]!.slug } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'POLICY_LEGACY_DRAFT_IMPORTED' } })).toBe(0);
  });
});
