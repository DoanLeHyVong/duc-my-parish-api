import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { RoleCode } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

type SyntheticAccount = { username: string; password: string; role: RoleCode };

const outputFile = process.env.SYNTHETIC_CREDENTIALS_FILE?.trim();
if (!outputFile || !path.isAbsolute(outputFile) || path.resolve(outputFile).startsWith(`${process.cwd()}${path.sep}`)) {
  throw new Error('SYNTHETIC_CREDENTIALS_FILE must be an absolute path outside the application directory.');
}

const accountDefinitions: Array<{ key: string; fallback: string; displayName: string; role: RoleCode }> = [
  { key: 'SYNTHETIC_SUPER_ADMIN_USERNAME', fallback: 'review_super_admin', displayName: 'Synthetic Review Super Admin', role: RoleCode.SUPER_ADMIN },
  { key: 'SYNTHETIC_PARISH_ADMIN_USERNAME', fallback: 'review_parish_admin', displayName: 'Synthetic Review Parish Admin', role: RoleCode.PARISH_ADMIN },
  { key: 'SYNTHETIC_TEACHER_USERNAME', fallback: 'review_teacher', displayName: 'Synthetic Review Teacher', role: RoleCode.TEACHER },
];

function usernameFor(definition: (typeof accountDefinitions)[number]): string {
  const username = process.env[definition.key]?.trim().toLowerCase() || definition.fallback;
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error(`${definition.key} is invalid.`);
  return username;
}

const generated: SyntheticAccount[] = accountDefinitions.map((definition) => ({
  username: usernameFor(definition),
  password: randomBytes(32).toString('base64url'),
  role: definition.role,
}));

const created = await prisma.$transaction(async (tx) => {
  const superAdmin = generated[0]!;
  const superHash = await bcrypt.hash(superAdmin.password, 12);
  const superUser = await tx.user.upsert({
    where: { username: superAdmin.username },
    update: { displayName: 'Synthetic Review Super Admin', passwordHash: superHash, isActive: true, deletedAt: null, authVersion: { increment: 1 } },
    create: { username: superAdmin.username, displayName: 'Synthetic Review Super Admin', passwordHash: superHash },
  });

  for (const account of generated) {
    const role = await tx.accessRole.upsert({
      where: { code: account.role },
      update: {},
      create: { code: account.role, name: account.role },
    });
    const user = account.role === RoleCode.SUPER_ADMIN
      ? superUser
      : await tx.user.upsert({
        where: { username: account.username },
        update: { displayName: account.role === RoleCode.TEACHER ? 'Synthetic Review Teacher' : 'Synthetic Review Parish Admin', passwordHash: await bcrypt.hash(account.password, 12), isActive: true, deletedAt: null, authVersion: { increment: 1 } },
        create: { username: account.username, displayName: account.role === RoleCode.TEACHER ? 'Synthetic Review Teacher' : 'Synthetic Review Parish Admin', passwordHash: await bcrypt.hash(account.password, 12) },
      });
    await tx.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { assignedBy: superUser.id },
      create: { userId: user.id, roleId: role.id, assignedBy: superUser.id },
    });
  }
  return generated;
});

writeFileSync(outputFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts: created }, null, 2)}\n`, { mode: 0o600 });
try { chmodSync(outputFile, 0o600); } catch { /* Windows ACLs are managed by the operator. */ }
console.log(`Synthetic accounts provisioned. Credentials were written to ${outputFile}; passwords are not printed.`);
await prisma.$disconnect();
