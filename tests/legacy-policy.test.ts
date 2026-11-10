import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assertSafePolicyDatabase } from '../tool/policies/import-lib.js';
import { bundledLegacyPolicyDirectory, loadLegacyPolicies } from '../tool/policies/legacy.js';

it('preserves all fingerprinted policies as sanitized draft input', async () => {
  const policies = await loadLegacyPolicies(bundledLegacyPolicyDirectory);
  expect(policies.map(({ slug }) => slug)).toEqual([
    'privacy-policy',
    'terms-of-use',
    'support',
    'data-request',
  ]);
  expect(policies.map(({ slug, contentHash }) => [slug, contentHash])).toEqual([
    ['privacy-policy', 'd026ae89ba4d7aa539fa0b8afe221017148347c16caf5408e202b477a2b38c82'],
    ['terms-of-use', '041a7642bc2bb4fcae14d0727c1963a11e3b6eac33687b826194081f429b718f'],
    ['support', '7d8ca3a73c27c0a35c6861af5ff3771e8a87227debac78a237d4a1d78591fd3e'],
    ['data-request', 'b88306e4b9ba21fea534dcba16b0a26379e2cd8ba4c6b1df39080b07dd7988ac'],
  ]);
  for (const policy of policies) {
    expect(policy.contentHtml).not.toContain('{{');
    expect(policy.contentHtml).not.toMatch(/href="(?:privacy|terms|support|data-request)\.html"/);
    expect(policy.contentHash).toMatch(/^[a-f0-9]{64}$/);
  }
  const destinations = [...new Set(policies.flatMap((policy) => [...policy.contentHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1])))].sort();
  expect(destinations).toEqual(['/data-request', '/privacy']);
});

it('accepts only explicitly safe AppGLV database names', () => {
  expect(() => assertSafePolicyDatabase('appglv_unified_test')).not.toThrow();
  expect(() => assertSafePolicyDatabase('appglv_policy_import_disposable')).not.toThrow();
  for (const database of ['test', 'unified', 'production_test', 'appglv_production_test', 'appglv_unified_production_test', 'appglv_policy_legacy_disposable', 'my_appglv_test', 'appglv_test_production']) {
    expect(() => assertSafePolicyDatabase(database)).toThrow(/explicitly safe AppGLV/);
  }
});

it('rejects changed or unsupported policy source bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'policy-source-'));
  try {
    await Promise.all(['privacy.html', 'terms.html', 'support.html', 'data-request.html'].map((name) => writeFile(join(directory, name), '<main>changed</main>')));
    await expect(loadLegacyPolicies(directory)).rejects.toThrow(/Source changed or unsupported/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
