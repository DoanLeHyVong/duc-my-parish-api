import { RoleCode } from '../src/generated/prisma/client.js';
import { prisma } from '../src/lib/prisma.js';
import { getEnv } from '../src/config/env.js';

if (getEnv().DATABASE_NAME !== 'appglv_unified_test') {
  throw new Error('Tests refuse to modify a database other than appglv_unified_test.');
}

const permissionDefinitions = [
  ['parish.manage', 'Manage Parish content'],
  ['appglv.manage', 'Manage AppGLV'],
  ['appglv.teach', 'Use assigned Teacher scope'],
  ['policies.manage', 'Manage published policies'],
  ['security.manage', 'Manage users, roles, and permissions'],
] as const;

const rolePermissions: Record<RoleCode, string[]> = {
  SUPER_ADMIN: permissionDefinitions.map(([code]) => code),
  PARISH_ADMIN: ['parish.manage', 'policies.manage'],
  APPGLV_ADMIN: ['appglv.manage'],
  TEACHER: ['appglv.teach'],
};

for (const [code, description] of permissionDefinitions) {
  await prisma.permission.upsert({
    where: { code },
    update: { description },
    create: { code, description },
  });
}

for (const code of Object.values(RoleCode)) {
  const role = await prisma.accessRole.upsert({
    where: { code },
    update: { name: code },
    create: { code, name: code },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  for (const permissionCode of rolePermissions[code]) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permissionCode } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
}
