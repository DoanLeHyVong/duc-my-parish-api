import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { getEnv } from '../src/config/env.js';
import { RoleCode } from '../src/generated/prisma/client.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';

const app = createApp();
const userIds: string[] = [];
let profileId: number | undefined;
let adminToken: string;
let teacherToken: string;

beforeAll(async () => {
  if (getEnv().DATABASE_NAME !== 'appglv_unified_test') throw new Error('CMS integration tests require appglv_unified_test.');
  const passwordHash = await hashPassword('SyntheticCmsTest!123');
  const nonce = Date.now().toString(36);
  for (const [role, username] of [[RoleCode.PARISH_ADMIN, `cms.admin.${nonce}`], [RoleCode.TEACHER, `cms.teacher.${nonce}`]] as const) {
    const user = await prisma.user.create({ data: { username, displayName: 'CMS synthetic test', passwordHash, roleAssignments: { create: { role: { connect: { code: role } } } } } });
    userIds.push(user.id);
    const token = signAccessToken({ sub: user.id, av: user.authVersion });
    if (role === RoleCode.PARISH_ADMIN) adminToken = token;
    else teacherToken = token;
  }
});

afterAll(async () => {
  if (profileId) await prisma.parishProfile.delete({ where: { id: profileId } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('Parish CMS authorization and persistence', () => {
  it('denies Teacher CMS writes and media listing', async () => {
    expect((await request(app).get('/api/v1/admin/media').set('Authorization', `Bearer ${teacherToken}`)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/parish-profile').set('Authorization', `Bearer ${teacherToken}`).send({ name: 'Không được phép' })).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/media/upload').set('Authorization', `Bearer ${teacherToken}`).attach('files', Buffer.from('synthetic'), 'image.png')).status).toBe(403);
  });

  it('rejects unsafe URLs and publishes saved branding through the public API', async () => {
    const base = { name: 'Giáo xứ thử nghiệm', diocese: 'Giáo phận thử nghiệm', description: 'Nội dung giả lập', address: 'Địa chỉ giả lập' };
    const invalid = await request(app).post('/api/v1/admin/parish-profile').set('Authorization', `Bearer ${adminToken}`).send({ ...base, faviconUrl: 'javascript:alert(1)' });
    expect(invalid.status).toBe(422);
    const saved = await request(app).post('/api/v1/admin/parish-profile').set('Authorization', `Bearer ${adminToken}`).send({ ...base, faviconUrl: 'https://cdn.example.test/favicon.png', seoTitle: 'Tên thử nghiệm' });
    expect(saved.status).toBe(201);
    profileId = saved.body.data.id;
    const publicProfile = await request(app).get('/api/v1/public/parish-profile');
    expect(publicProfile.status).toBe(200);
    expect(publicProfile.body.data.faviconUrl).toBe('https://cdn.example.test/favicon.png');
    expect((await request(app).get('/api/v1/admin/media').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).post('/api/v1/admin/media/upload').set('Authorization', `Bearer ${adminToken}`).attach('files', Buffer.from('synthetic'), 'bad.txt')).status).toBe(415);
  });
});
