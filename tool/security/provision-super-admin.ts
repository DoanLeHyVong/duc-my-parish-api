import 'dotenv/config';
import {
  assertLocalDucmyDatabaseUrl,
  provisionSuperAdmin,
  readSuperAdminProvisioningEnvironment,
  SuperAdminProvisioningError,
} from './super-admin-provisioning.js';

async function main(): Promise<void> {
  const input = readSuperAdminProvisioningEnvironment(process.env);
  assertLocalDucmyDatabaseUrl(process.env.DATABASE_URL);

  const { prisma } = await import('../../src/lib/prisma.js');
  try {
    const result = await provisionSuperAdmin(prisma, input);
    const mode = result.repeated ? 'repeated safely' : 'completed';
    console.log(`Super Admin provisioning ${mode}; ${result.revokedSessions} session(s) revoked.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SuperAdminProvisioningError) {
    console.error(`Super Admin provisioning failed [${error.code}]: ${error.message}`);
  } else {
    console.error('Super Admin provisioning failed; no credential data was logged.');
  }
  process.exitCode = 1;
});
