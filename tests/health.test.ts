import { describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
vi.mock('../src/config/prisma.js', () => ({ prisma: { $queryRaw: query } }));
import request from 'supertest';
import { app } from '../src/app.js';

describe('health', () => {
  it('reports readiness and database failure on both probe paths', async () => {
    for (const path of ['/ready', '/api/v1/ready']) {
      query.mockResolvedValueOnce([{ 1: 1 }]);
      const ready = await request(app).get(path);
      expect(ready.body.data.status).toBe('ready');
      expect(ready.headers['x-ratelimit-limit']).toBe('500');
      query.mockRejectedValueOnce(new Error('unavailable'));
      expect((await request(app).get(path)).status).toBe(503);
    }
  });
  it('keeps the legacy root health contract available', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('returns API status', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
