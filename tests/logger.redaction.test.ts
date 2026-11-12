import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('HTTP logging', () => {
  it('redacts authorization, request cookies, and refresh-token response cookies', () => {
    const script = `
      import { logger } from './dist/config/logger.js';
      logger.info({
        req: { headers: { authorization: 'SYNTHETIC_ACCESS', cookie: 'SYNTHETIC_REQUEST' } },
        res: { headers: { 'set-cookie': 'SYNTHETIC_REFRESH' } }
      }, 'redaction check');
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, LOG_LEVEL: 'info' },
    });
    expect(output).not.toContain('SYNTHETIC_ACCESS');
    expect(output).not.toContain('SYNTHETIC_REQUEST');
    expect(output).not.toContain('SYNTHETIC_REFRESH');
    expect(output).toContain('[Redacted]');
  });
});
