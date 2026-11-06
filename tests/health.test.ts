import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/prisma.js', () => ({ prisma: {} }));
import request from 'supertest';
import { app } from '../src/app.js';

describe('health', () => {
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
