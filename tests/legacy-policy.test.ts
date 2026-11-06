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
    ['privacy-policy', '1ef2c5cf55ae0aead13b5d44d6c8f32d0d976b2836141bc949d511ba5c76b1c0'],
    ['terms-of-use', 'ca357f6f84ef7949bcfa89eab3d39c316951fb4ef1429fa20152111cd3877754'],
    ['support', 'f81c0daaf236a9675a5da7c135c3518ca39299e6866921ef93700a4fe214e059'],
    ['data-request', 'b88306e4b9ba21fea534dcba16b0a26379e2cd8ba4c6b1df39080b07dd7988ac'],
  ]);
  for (const policy of policies) {
    expect(policy.contentHtml).not.toContain('{{');
    expect(policy.contentHtml).not.toMatch(/href="(?:privacy|terms|support|data-request)\.html"/);
    expect(policy.contentHash).toMatch(/^[a-f0-9]{64}$/);
  }
  const destinations = [...new Set(policies.flatMap((policy) => [...policy.contentHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1])))].sort();
  expect(destinations).toEqual(['/quyen-rieng-tu', '/yeu-cau-du-lieu']);
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
