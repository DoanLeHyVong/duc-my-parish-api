import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { RoleCode } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

type SyntheticAccount = { username: string; password: string; role: RoleCode; displayName: string };

const outputFile = process.env.SYNTHETIC_CREDENTIALS_FILE?.trim();
if (!outputFile || !path.isAbsolute(outputFile) || path.resolve(outputFile).startsWith(`${process.cwd()}${path.sep}`)) {
  throw new Error('SYNTHETIC_CREDENTIALS_FILE must be an absolute path outside the application directory.');
}
if (existsSync(outputFile)) throw new Error('SYNTHETIC_CREDENTIALS_FILE already exists; choose a new operator-controlled path.');

const accountDefinitions: Array<{ key: string; fallback: string; displayName: string; role: RoleCode }> = [
  { key: 'SYNTHETIC_SUPER_ADMIN_USERNAME', fallback: 'review_super_admin', displayName: 'Synthetic Review Super Admin', role: RoleCode.SUPER_ADMIN },
  { key: 'SYNTHETIC_PARISH_ADMIN_USERNAME', fallback: 'review_parish_admin', displayName: 'Synthetic Review Parish Admin', role: RoleCode.PARISH_ADMIN },
  { key: 'SYNTHETIC_TEACHER_USERNAME', fallback: 'review_teacher', displayName: 'Synthetic Review Teacher', role: RoleCode.TEACHER },
];

function usernameFor(definition: (typeof accountDefinitions)[number]): string {
  const username = process.env[definition.key]?.trim().toLowerCase() || definition.fallback;
  if (!/^review_[a-z0-9._-]{3,59}$/.test(username)) throw new Error(`${definition.key} must use the reserved review_ prefix.`);
  return username;
}

const generated: SyntheticAccount[] = accountDefinitions.map((definition) => ({
  username: usernameFor(definition),
  password: randomBytes(32).toString('base64url'),
  role: definition.role,
  displayName: definition.displayName,
}));
if (new Set(generated.map(({ username }) => username)).size !== generated.length) {
  throw new Error('Synthetic account usernames must be unique after normalization.');
}

const tempFile = `${outputFile}.${process.pid}.tmp`;
if (existsSync(tempFile)) throw new Error('A synthetic credential staging file already exists; remove it only after operator review.');
writeFileSync(tempFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts: generated }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
try { chmodSync(tempFile, 0o600); } catch { /* Windows ACLs are managed by the operator. */ }

let provisioned = false;
try {
  await prisma.$transaction(async (tx) => {
    const superAdmin = generated[0]!;
    const existingSuper = await tx.user.findUnique({ where: { username: superAdmin.username } });
    if (existingSuper && existingSuper.displayName !== superAdmin.displayName) {
      throw new Error(`Reserved synthetic username is already used by a non-synthetic account: ${superAdmin.username}`);
    }
    const superHash = await bcrypt.hash(superAdmin.password, 12);
    const superUser = await tx.user.upsert({
      where: { username: superAdmin.username },
      update: { displayName: superAdmin.displayName, passwordHash: superHash, isActive: true, deletedAt: null, authVersion: { increment: 1 } },
      create: { username: superAdmin.username, displayName: superAdmin.displayName, passwordHash: superHash },
    });

    for (const account of generated) {
      const role = await tx.accessRole.upsert({
        where: { code: account.role },
        update: {},
        create: { code: account.role, name: account.role },
      });
      const existing = await tx.user.findUnique({ where: { username: account.username } });
      if (existing && existing.displayName !== account.displayName) {
        throw new Error(`Reserved synthetic username is already used by a non-synthetic account: ${account.username}`);
      }
      const user = account.role === RoleCode.SUPER_ADMIN
        ? superUser
        : await tx.user.upsert({
          where: { username: account.username },
          update: { displayName: account.displayName, passwordHash: await bcrypt.hash(account.password, 12), isActive: true, deletedAt: null, authVersion: { increment: 1 } },
          create: { username: account.username, displayName: account.displayName, passwordHash: await bcrypt.hash(account.password, 12) },
        });
      await tx.userRoleAssignment.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: { assignedBy: superUser.id },
        create: { userId: user.id, roleId: role.id, assignedBy: superUser.id },
      });
    }
  });
  provisioned = true;
  renameSync(tempFile, outputFile);
  try { chmodSync(outputFile, 0o600); } catch { /* Windows ACLs are managed by the operator. */ }
  console.log(`Synthetic accounts provisioned. Credentials were written to ${outputFile}; passwords are not printed.`);
} catch (error) {
  if (!provisioned) rmSync(tempFile, { force: true });
  else console.error(`Provisioning succeeded but credential delivery failed; recover credentials from ${tempFile}.`);
  throw error;
} finally {
  await prisma.$disconnect();
}
