import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sanitizeHtml from 'sanitize-html';

export const bundledLegacyPolicyDirectory = fileURLToPath(new URL('./legacy-source', import.meta.url));

const pages = [
  { file: 'privacy.html', slug: 'privacy-policy', kind: 'PRIVACY', sha256: 'ce5878854c28fa1a0094b65b8d575352e485dea5219183f670e4cb151aaeb1c1' },
  { file: 'terms.html', slug: 'terms-of-use', kind: 'TERMS', sha256: '5d8c1b77a85ec7558f71b62fa9c9ab202180e9aa1c76bb1cc05a23d7495527be' },
  { file: 'support.html', slug: 'support', kind: 'SUPPORT', sha256: '6769b44b7a04d3834ada0d7b8e5e0ae8f88b89b715c5ff0c2274a1b0326365da' },
  { file: 'data-request.html', slug: 'data-request', kind: 'DATA_REQUEST', sha256: '1ec560848f543608828bccaa9c61d469a3ccd60d32b23fc6e1565eca590ebb6b' },
] as const;
export type LegacyPolicy = Awaited<ReturnType<typeof loadLegacyPolicies>>[number];
const links: Record<string, string> = { 'privacy.html': '/privacy', 'terms.html': '/terms', 'support.html': '/support', 'data-request.html': '/data-request' };
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export async function loadLegacyPolicies(directory: string) {
  return Promise.all(pages.map(async (page) => {
    const bytes = await readFile(resolve(directory, page.file));
    if (hash(bytes) !== page.sha256) throw new Error(`Source changed or unsupported: ${page.file}`);
    const source = bytes.toString('utf8');
    const main = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
    const title = main?.match(/<h1>([^<]+)<\/h1>/i)?.[1];
    if (!main || !title || (main.match(/\{\{CONTACT_CHANNELS\}\}/g) ?? []).length !== 1) throw new Error(`Unsupported page structure: ${page.file}`);
    const stripped = main.replace('{{CONTACT_CHANNELS}}', '').replace(/href="([^"]+)"/g, (_all, href: string) => {
      if (!links[href]) throw new Error(`Unsupported policy link in ${page.file}`);
      return `href="${links[href]}"`;
    });
    const contentHtml = sanitizeHtml(stripped, {
      allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'figure', 'figcaption', 'h1', 'h2'],
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'loading'] },
      allowedSchemes: ['http', 'https', 'mailto'],
    });
    if (contentHtml.includes('{{') || !contentHtml.trim()) throw new Error(`Unsupported placeholder in ${page.file}`);
    return { ...page, title, contentHtml, contentHash: hash(contentHtml) };
  }));
}
