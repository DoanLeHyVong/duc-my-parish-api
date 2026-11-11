import { readFileSync } from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

test('CI cannot start an automatic deployment or publish an image', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /branches: \[main\]/);
  assert.doesNotMatch(workflow, /staging/);
  assert.doesNotMatch(workflow, /workflow_run|ssh-action|scp-action|build-push-action|docker\/login-action/);
  assert.match(workflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
});

test('API release backs up before migration and scheduled retention groups changing SQL paths', () => {
  const release = readFileSync(path.join(root, 'deploy/manual/api-release.sh'), 'utf8');
  const prune = readFileSync(path.join(root, 'deploy/manual/backup-prune.sh'), 'utf8');
  const backupAt = release.indexOf('restic backup "$BACKUP"');
  const migrateAt = release.indexOf('prisma migrate deploy');
  assert.ok(backupAt >= 0 && migrateAt > backupAt);
  assert.match(release, /An off-VPS restic repository is required/);
  assert.match(prune, /--group-by host --keep-within 30d --keep-monthly 6/);
});

test('API release fails closed when archive or backup configuration is missing', () => {
  const script = path.join(root, 'deploy/manual/api-release.sh');
  const result = spawnSync(shell, [script, 'missing.tar.gz', 'missing.sha256'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing/i);
});

test('rollback refuses an unknown API release', () => {
  const script = path.join(root, 'deploy/manual/api-rollback.sh');
  const result = spawnSync(shell, [script, 'invalid'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown/i);
});
