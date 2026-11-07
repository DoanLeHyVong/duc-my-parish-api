import type { PrismaClient } from '../../src/generated/prisma/client.js';

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type SuperAdminProvisioningInput = {
  sourceUsername: string;
  targetUsername: string;
  password: string;
  targetEmail?: string;
};

export type SuperAdminProvisioningResult = {
  userId: string;
  previousUsername: string;
  targetUsername: string;
  authVersion: number;
  revokedSessions: number;
  repeated: boolean;
};

export class SuperAdminProvisioningError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SuperAdminProvisioningError';
  }
}

function invalidVariable(name: string): never {
  throw new SuperAdminProvisioningError('INVALID_ENV', `Invalid environment variable: ${name}.`);
}

function requiredVariable(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new SuperAdminProvisioningError('MISSING_ENV', `Missing required environment variable: ${name}.`);
  }
  return value;
}

function normalizeUsername(value: string, variableName: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 64 || !USERNAME_PATTERN.test(normalized)) {
    invalidVariable(variableName);
  }
  return normalized;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    invalidVariable('SUPER_ADMIN_TARGET_EMAIL');
  }
  return normalized;
}

function validatePassword(value: string): string {
  if ([...value].length < 12 || Buffer.byteLength(value, 'utf8') > 72) {
    invalidVariable('SUPER_ADMIN_PASSWORD');
  }
  return value;
}

export function readSuperAdminProvisioningEnvironment(
  environment: NodeJS.ProcessEnv,
): SuperAdminProvisioningInput {
  const sourceUsername = normalizeUsername(
    requiredVariable(environment, 'SUPER_ADMIN_SOURCE_USERNAME'),
    'SUPER_ADMIN_SOURCE_USERNAME',
  );
  const targetUsername = normalizeUsername(
    requiredVariable(environment, 'SUPER_ADMIN_TARGET_USERNAME'),
    'SUPER_ADMIN_TARGET_USERNAME',
  );
  const password = validatePassword(requiredVariable(environment, 'SUPER_ADMIN_PASSWORD'));

  return {
    sourceUsername,
    targetUsername,
    password,
    targetEmail: normalizeEmail(environment.SUPER_ADMIN_TARGET_EMAIL),
  };
}

export function assertLocalDucmyDatabaseUrl(databaseUrl: string | undefined): void {
  if (!databaseUrl?.trim()) {
    throw new SuperAdminProvisioningError(
      'MISSING_ENV',
      'Missing required environment variable: DATABASE_URL.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    invalidVariable('DATABASE_URL');
  }

  if (
    parsed.protocol !== 'mysql:'
    || !LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())
    || parsed.pathname !== '/ducmy'
  ) {
    throw new SuperAdminProvisioningError(
      'UNSAFE_DATABASE',
      'DATABASE_URL must identify the local ducmy database.',
    );
  }
}

export async function provisionSuperAdmin(
  client: PrismaClient,
  rawInput: SuperAdminProvisioningInput,
): Promise<SuperAdminProvisioningResult> {
  const input = {
    sourceUsername: normalizeUsername(rawInput.sourceUsername, 'SUPER_ADMIN_SOURCE_USERNAME'),
    targetUsername: normalizeUsername(rawInput.targetUsername, 'SUPER_ADMIN_TARGET_USERNAME'),
    password: validatePassword(rawInput.password),
    targetEmail: normalizeEmail(rawInput.targetEmail),
  };

  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.default.hash(input.password, 12);

  return client.$transaction(async (tx) => {
    const source = await tx.user.findUnique({
      where: { username: input.sourceUsername },
      include: { roleAssignments: { include: { role: true } } },
    });
    const target = input.targetUsername === input.sourceUsername
      ? source
      : await tx.user.findUnique({
        where: { username: input.targetUsername },
        include: { roleAssignments: { include: { role: true } } },
      });

    if (source && target && source.id !== target.id) {
      throw new SuperAdminProvisioningError(
        'TARGET_USERNAME_COLLISION',
        'The target username belongs to another account; no changes were applied.',
      );
    }

    let candidate = source;
    if (!candidate && target) {
      const priorProvisioningAudits = await tx.auditLog.findMany({
        where: {
          action: 'SUPER_ADMIN_PROVISIONED',
          entityType: 'User',
          entityId: target.id,
        },
        select: { metadata: true },
      });
      const exactRenameWasProvisioned = priorProvisioningAudits.some(({ metadata }) => {
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
        return metadata.previousUsername === input.sourceUsername
          && metadata.newUsername === input.targetUsername;
      });
      if (exactRenameWasProvisioned) candidate = target;
    }
    if (!candidate) {
      throw new SuperAdminProvisioningError(
        'SOURCE_NOT_FOUND',
        'The source Super Admin locator did not match an account; no changes were applied.',
      );
    }
    if (!candidate.roleAssignments.some((assignment) => assignment.role.code === 'SUPER_ADMIN')) {
      throw new SuperAdminProvisioningError(
        'SOURCE_NOT_SUPER_ADMIN',
        'The located account is not a Super Admin; no changes were applied.',
      );
    }
    if (!candidate.isActive || candidate.deletedAt) {
      throw new SuperAdminProvisioningError(
        'SOURCE_NOT_ACTIVE',
        'The located Super Admin is not active; no changes were applied.',
      );
    }

    const superAdminCount = await tx.user.count({
      where: {
        deletedAt: null,
        roleAssignments: { some: { role: { code: 'SUPER_ADMIN' } } },
      },
    });
    if (superAdminCount !== 1) {
      throw new SuperAdminProvisioningError(
        'SUPER_ADMIN_IDENTITY_AMBIGUOUS',
        'The database does not contain exactly one Super Admin; no changes were applied.',
      );
    }

    if (input.targetEmail) {
      const emailOwner = await tx.user.findUnique({ where: { email: input.targetEmail } });
      if (emailOwner && emailOwner.id !== candidate.id) {
        throw new SuperAdminProvisioningError(
          'TARGET_EMAIL_COLLISION',
          'The target email belongs to another account; no changes were applied.',
        );
      }
    }

    const previousUsername = candidate.username;
    const repeated = previousUsername === input.targetUsername;
    const updated = await tx.user.update({
      where: { id: candidate.id },
      data: {
        username: input.targetUsername,
        passwordHash,
        authVersion: { increment: 1 },
        ...(input.targetEmail ? { email: input.targetEmail } : {}),
      },
    });
    const revoked = await tx.authSession.updateMany({
      where: { userId: candidate.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'SUPER_ADMIN_PROVISIONED',
        entityType: 'User',
        entityId: candidate.id,
        metadata: {
          previousUsername,
          newUsername: input.targetUsername,
          reason: 'local-super-admin-provisioning',
          initiatedBy: 'system',
          environment: 'local',
        },
      },
    });

    return {
      userId: updated.id,
      previousUsername,
      targetUsername: updated.username,
      authVersion: updated.authVersion,
      revokedSessions: revoked.count,
      repeated,
    };
  }, { isolationLevel: 'Serializable' });
}
