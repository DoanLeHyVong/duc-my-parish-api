import { createServer } from 'node:http';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/smoke.sh', import.meta.url));
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('public smoke verifies API and Web domain and rejects stale Web assets', async () => {
  const api = createServer((req, res) => {
    res.writeHead(req.url === '/api/v1/health' || req.url === '/api/v1/ready' ? 200 : 404);
    res.end('ok');
  });
  let staleWeb = false;
  let apiUrl;
  let webUrl;
  const web = createServer((req, res) => {
    if (req.url === '/') res.end('<script src="/assets/app.js"></script>');
    else if (req.url === '/assets/app.js') res.end(`${apiUrl}/api/v1 ${staleWeb ? 'https://old.invalid' : webUrl}`);
    else if (req.url === '/sitemap.xml') res.end(`<loc>${webUrl}/</loc>`);
    else if (req.url === '/robots.txt') res.end(`Sitemap: ${webUrl}/sitemap.xml`);
    else { res.writeHead(404); res.end(); }
  });
  try {
    apiUrl = await listen(api);
    webUrl = await listen(web);
    const env = { ...process.env, API_URL: apiUrl, EXPECTED_API_URL: `${apiUrl}/api/v1`, WEB_URL: webUrl };
    await run(shell, [script], { env });
    staleWeb = true;
    await assertRejects(() => run(shell, [script], { env }));
  } finally {
    await Promise.all([new Promise((resolve) => api.close(resolve)), new Promise((resolve) => web.close(resolve))]);
  }
});

async function assertRejects(action) {
  let failed = false;
  try { await action(); } catch { failed = true; }
  if (!failed) throw new Error('Smoke unexpectedly accepted a stale Web URL');
}
