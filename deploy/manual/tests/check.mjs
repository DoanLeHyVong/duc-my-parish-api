import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manual = path.join(root, 'deploy/manual');
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const source = (name) => readFileSync(path.join(manual, name), 'utf8');

test('CI cannot start automatic deployment or publish an image', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /branches: \[main\]/);
  assert.doesNotMatch(workflow, /staging|workflow_run|ssh-action|scp-action|build-push-action|docker\/login-action/);
  assert.match(workflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
});

test('production workflow prepares only and leaves migration behind evidence gate', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/deploy-production.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /api-release\.sh --prepare/);
  assert.doesNotMatch(workflow, /api-release\.sh --release|prisma migrate deploy.*ducmy_production|systemctl restart ducmy-api/);
  assert.ok(workflow.indexOf('Missing $variable') < workflow.indexOf('scp "${ssh_opts'));
});

test('release has two phases and no Prisma migration before evidence checks', () => {
  const release = source('api-release.sh');
  const backup = source('backup-db.sh');
  assert.match(release, /MODE.*--prepare.*--release/);
  assert.ok(release.indexOf('verify_backup_evidence "$SHA" "$BACKUP" true') < release.indexOf('prisma migrate deploy'));
  assert.ok(release.indexOf('printf.*"$BACKUP.used"') < release.indexOf('prisma migrate deploy'));
  assert.match(release, /sha256sum -c/);
  assert.match(release, /systemctl restart ducmy-api/);
  assert.match(release, /http:\/\/127\.0\.0\.1:5000\/ready/);
  assert.match(backup, /mariadb-dump .*--single-transaction.*ducmy_production/);
  assert.match(backup, /\[\[ -s "\$FILE" \]\]/);
  assert.match(backup, /openssl rand -hex 32/);
  assert.doesNotMatch(release + backup + source('backup-prune.sh'), /restic/);
});

test('backup evidence accepts only a matching fresh Windows copy and disposable restore', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ducmy-evidence-'));
  const sha = 'a'.repeat(40);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const name = `ducmy-${sha}-${stamp}.sql`;
  const file = path.join(dir, name);
  const toPosix = (p) => process.platform === 'win32' ? spawnSync(shell, ['-c', 'cygpath -u "$1"', '_', p], { encoding: 'utf8' }).stdout.trim() : p;
  const payload = 'CREATE TABLE `example` (`id` int);\n';
  const hash = createHash('sha256').update(payload).digest('hex');
  const challenge = randomBytes(32).toString('hex');
  const run = () => spawnSync(shell, ['-c', 'source "$1"; verify_backup_evidence "$2" "$3" true "$4"', '_', toPosix(path.join(manual, 'verify-backup-evidence.sh')), sha, toPosix(file), toPosix(dir)], { encoding: 'utf8' });
  try {
    writeFileSync(file, payload);
    writeFileSync(`${file}.sha256`, `${hash}  ${name}\n`);
    writeFileSync(`${file}.manifest`, `release_sha=${sha}\nbackup_sha256=${hash}\nchallenge=${challenge}\ncreated_unix=${Math.floor(Date.now() / 1000)}\n`);
    assert.notEqual(run().status, 0, 'missing receipt and restore proof must fail');
    writeFileSync(`${file}.copy-receipt`, `release_sha=${sha}\nbackup_sha256=${hash}\nchallenge=${challenge}\n`);
    assert.notEqual(run().status, 0, 'copy alone must fail');
    writeFileSync(`${file}.restore-proof`, `release_sha=${sha}\nbackup_sha256=${hash}\nchallenge=${challenge}\ndatabase=ducmy_restore_test\n`);
    const matching = run();
    assert.equal(matching.status, 0, `matching chain passes: ${matching.stderr}`);
    writeFileSync(`${file}.copy-receipt`, `release_sha=${sha}\nbackup_sha256=${hash}\nchallenge=${'b'.repeat(64)}\n`);
    assert.notEqual(run().status, 0, 'wrong challenge fails');
    writeFileSync(`${file}.copy-receipt`, `release_sha=${sha}\nbackup_sha256=${hash}\nchallenge=${challenge}\n`);
    writeFileSync(file, payload + 'tamper');
    assert.notEqual(run().status, 0, 'changed SQL fails checksum');
    writeFileSync(file, payload);
    writeFileSync(`${file}.manifest`, `release_sha=${sha}\nbackup_sha256=${hash}\nchallenge=${challenge}\ncreated_unix=${Math.floor(Date.now() / 1000) - 90000}\n`);
    assert.notEqual(run().status, 0, 'expired backup cannot authorize release');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backup prepare creates a nonempty dump and refuses an empty dump', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ducmy-dump-'));
  const bin = path.join(dir, 'bin');
  const backupDir = path.join(dir, 'backups');
  const cnf = path.join(dir, 'backup.cnf');
  const sha = 'c'.repeat(40);
  const toPosix = (p) => process.platform === 'win32' ? spawnSync(shell, ['-c', 'cygpath -u "$1"', '_', p], { encoding: 'utf8' }).stdout.trim() : p;
  try {
    mkdirSync(bin);
    writeFileSync(cnf, '[client]\n');
    writeFileSync(path.join(bin, 'mariadb'), '#!/usr/bin/env bash\nif [[ "$*" == *"engine <>"* ]]; then echo 0; elif [[ "$*" == *"SUM(data_length"* ]]; then echo 100; else echo 1; fi\n');
    writeFileSync(path.join(bin, 'mariadb-dump'), '#!/usr/bin/env bash\nprintf "CREATE TABLE \\`example\\` (id int);\\nINSERT INTO \\`example\\` VALUES (1);\\n"\n');
    writeFileSync(path.join(bin, 'df'), '#!/usr/bin/env bash\nprintf "Avail\\n10000000000\\n"\n');
    writeFileSync(path.join(bin, 'openssl'), '#!/usr/bin/env bash\nprintf "%064d\\n" 0\n');
    for (const name of ['mariadb', 'mariadb-dump', 'df', 'openssl']) {
      spawnSync(shell, ['-c', 'chmod +x "$1"', '_', toPosix(path.join(bin, name))]);
    }
    const script = source('backup-db.sh')
      .replace('DIR=/var/backups/ducmy', `DIR=${toPosix(backupDir)}`)
      .replace('CNF=/etc/ducmy/mariadb-backup.cnf', `CNF=${toPosix(cnf)}`);
    const scriptFile = path.join(dir, 'backup-db.sh');
    writeFileSync(scriptFile, script);
    const run = (releaseSha = sha) => spawnSync(shell, ['-c', 'PATH="$1:$PATH"; bash "$2" "$3"', '_', toPosix(bin), toPosix(scriptFile), releaseSha], { encoding: 'utf8' });
    const good = run();
    assert.equal(good.status, 0, good.stderr);
    const name = good.stdout.trim();
    assert.match(name, /^ducmy-[0-9a-f]{40}-\d{8}T\d{6}Z\.sql$/);
    assert.ok(readFileSync(path.join(backupDir, name)).length > 0);
    assert.ok(readFileSync(path.join(backupDir, `${name}.sha256`)).length > 0);
    assert.ok(readFileSync(path.join(backupDir, `${name}.manifest`)).length > 0);
    assert.match(readFileSync(path.join(backupDir, name), 'utf8'), /-- appglv-source-tables=1/);
    writeFileSync(path.join(bin, 'mariadb-dump'), '#!/usr/bin/env bash\nexit 0\n');
    const empty = run('d'.repeat(40));
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /Empty database dump/);
    writeFileSync(path.join(bin, 'mariadb'), '#!/usr/bin/env bash\necho 0\n');
    writeFileSync(path.join(bin, 'mariadb-dump'), '#!/usr/bin/env bash\nprintf "%s\\n" "-- MariaDB dump of empty ducmy_production" "CREATE DATABASE IF NOT EXISTS ducmy_production;"\n');
    const firstDeploy = run('e'.repeat(40));
    assert.equal(firstDeploy.status, 0, firstDeploy.stderr);
    const firstDump = readFileSync(path.join(backupDir, firstDeploy.stdout.trim()), 'utf8');
    assert.ok(firstDump.length > 0);
    assert.doesNotMatch(firstDump, /CREATE TABLE/);
    assert.match(firstDump, /-- appglv-source-tables=0/);
    writeFileSync(path.join(bin, 'mariadb'), '#!/usr/bin/env bash\nif [[ "$*" == *"engine <>"* ]]; then echo 0; elif [[ "$*" == *"SUM(data_length"* ]]; then echo 100; else echo 2; fi\n');
    writeFileSync(path.join(bin, 'mariadb-dump'), '#!/usr/bin/env bash\nprintf "CREATE TABLE \\`example\\` (id int);\\n"\n');
    const mismatched = run('f'.repeat(40));
    assert.notEqual(mismatched.status, 0);
    assert.match(mismatched.stderr, /SQL dump table count differs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows receipt is produced only after local SHA-256 verification', () => {
  const download = source('windows/Download-DbBackup.ps1');
  assert.ok(download.indexOf('Get-FileHash') < download.indexOf('WriteAllText'));
  assert.ok(download.indexOf('WriteAllText') < download.indexOf('copy-receipt"'));
  assert.match(download, /StrictHostKeyChecking=yes/);
  assert.match(download, /outside D:\\AppGLV/);
});

test('disposable restore writes proof only after import and verification', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ducmy-restore-'));
  const bin = path.join(dir, 'bin');
  const sha = 'e'.repeat(40);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const name = `ducmy-${sha}-${stamp}.sql`;
  const file = path.join(dir, name);
  const payload = 'CREATE TABLE `example` (id int);\nINSERT INTO `example` VALUES (1);\n';
  const hash = createHash('sha256').update(payload).digest('hex');
  const challenge = 'f'.repeat(64);
  const toPosix = (p) => process.platform === 'win32' ? spawnSync(shell, ['-c', 'cygpath -u "$1"', '_', p], { encoding: 'utf8' }).stdout.trim() : p;
  try {
    mkdirSync(bin);
    writeFileSync(path.join(dir, 'restore.cnf'), '[client]\n');
    writeFileSync(file, payload);
    writeFileSync(`${file}.sha256`, `${hash}  ${name}\n`);
    writeFileSync(`${file}.manifest`, `release_sha=${sha}\nbackup_sha256=${hash}\nchallenge=${challenge}\ncreated_unix=${Math.floor(Date.now() / 1000)}\n`);
    writeFileSync(`${file}.copy-receipt`, `release_sha=${sha}\nbackup_sha256=${hash}\nchallenge=${challenge}\n`);
    writeFileSync(path.join(bin, 'mariadb'), '#!/usr/bin/env bash\nif [[ "$*" == *"SHOW DATABASES"* && "${MOCK_EXISTING:-}" == 1 ]]; then echo ducmy_restore_test; fi\nexit 0\n');
    writeFileSync(path.join(bin, 'python3'), '#!/usr/bin/env bash\nexit 0\n');
    for (const executable of ['mariadb', 'python3']) spawnSync(shell, ['-c', 'chmod +x "$1"', '_', toPosix(path.join(bin, executable))]);
    writeFileSync(path.join(dir, 'verify-backup-evidence.sh'), source('verify-backup-evidence.sh').replace('dir=${4:-/var/backups/ducmy}', `dir=${toPosix(dir)}`));
    writeFileSync(path.join(dir, 'restore-check.sh'), source('restore-check.sh')
      .replaceAll('/var/backups/ducmy', toPosix(dir))
      .replace('/etc/ducmy/mariadb-restore.cnf', toPosix(path.join(dir, 'restore.cnf'))));
    const run = (existing = false) => spawnSync(shell, ['-c', 'PATH="$1:$PATH"; bash "$2" "$3" "$4" ducmy_restore_test', '_', toPosix(bin), toPosix(path.join(dir, 'restore-check.sh')), toPosix(file), toPosix(`${file}.sha256`)], { encoding: 'utf8', env: { ...process.env, MOCK_EXISTING: existing ? '1' : '' } });
    const good = run();
    assert.equal(good.status, 0, good.stderr);
    assert.match(readFileSync(`${file}.restore-proof`, 'utf8'), /database=ducmy_restore_test/);
    const replay = run();
    assert.notEqual(replay.status, 0, 'existing restore proof blocks replay');
    rmSync(`${file}.restore-proof`);
    const existing = run(true);
    assert.notEqual(existing.status, 0, 'existing disposable database cannot be overwritten');
    assert.match(existing.stderr, /already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restore refuses production and existing targets; release fails closed on missing artifact', () => {
  const restore = source('restore-check.sh');
  assert.match(restore, /CREATE DATABASE/);
  assert.match(restore, /DROP DATABASE/);
  assert.match(restore, /verify-restore\.py/);
  assert.match(source('verify-restore.py'), /Foreign-key orphan found/);
  const script = path.join(manual, 'restore-check.sh');
  const invalid = spawnSync(shell, [script, 'missing.sql', 'missing.sha256', 'ducmy_production'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Only a new ducmy_restore_/);
  const release = spawnSync(shell, [path.join(manual, 'api-release.sh'), '--release', 'missing.tar.gz', 'missing.sha256'], { encoding: 'utf8' });
  assert.notEqual(release.status, 0);
  assert.match(release.stderr, /missing/i);
});

test('retired scheduled backup cannot run and local SQL retention is bounded', () => {
  assert.match(source('systemd/ducmy-backup.service'), /ExecCondition=\/usr\/bin\/false/);
  assert.match(source('backup-prune.sh'), /172800/);
});

test('rollback refuses an unknown API release', () => {
  const result = spawnSync(shell, [path.join(manual, 'api-rollback.sh'), 'invalid'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown/i);
});
