import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installFiles, rollback } from '../skills/code-workers/scripts/lib/transaction.mjs';

async function fixture(t) {
  const canonicalTemp = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(canonicalTemp, 'codeworkers-transaction-'));
  t.after(async () => {
    const absoluteRoot = path.resolve(root);
    const absoluteTemp = path.resolve(canonicalTemp);
    assert.ok(path.isAbsolute(absoluteRoot));
    assert.equal(path.dirname(absoluteRoot), absoluteTemp);
    await rm(absoluteRoot, { recursive: true, force: true });
  });

  return {
    root,
    stateDir: path.join(root, 'state'),
    target: path.join(root, 'nested', 'worker.toml'),
  };
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function receiptAt(receiptPath) {
  return JSON.parse(await readFile(receiptPath, 'utf8'));
}

test('installs a new file and rolls it back from its receipt', async (t) => {
  const { stateDir, target } = await fixture(t);

  const result = await installFiles({
    files: [{ path: target, content: 'worker = true\n' }],
    stateDir,
  });

  assert.equal(result.status, 'installed_pending_reload');
  assert.ok(path.isAbsolute(result.receipt));
  assert.deepEqual(result.paths, [path.resolve(target)]);
  assert.equal(await readFile(target, 'utf8'), 'worker = true\n');
  const record = await receiptAt(result.receipt);
  assert.equal(record.version, 1);
  assert.equal(record.items[0].originalBase64, null);
  assert.equal(record.items[0].intendedBase64, Buffer.from('worker = true\n').toString('base64'));
  assert.equal(record.status, 'installed_pending_reload');

  const undone = await rollback(result.receipt);
  assert.equal(undone.status, 'rolled_back');
  assert.deepEqual(undone.paths, result.paths);
  assert.equal(await fileExists(target), false);
  assert.equal((await receiptAt(result.receipt)).status, 'rolled_back');
});

test('replaces a regular file and restores its original bytes and mode', async (t) => {
  const { root, stateDir, target } = await fixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  const original = Buffer.from([0, 255, 1, 128, 42]);
  await writeFile(target, original);
  await (await import('node:fs/promises')).chmod(target, 0o640);
  const originalMode = (await stat(target)).mode & 0o7777;

  const result = await installFiles({
    files: [{ path: target, content: 'replacement' }],
    stateDir,
    replace: true,
  });

  assert.equal(await readFile(target, 'utf8'), 'replacement');
  assert.equal((await stat(target)).mode & 0o7777, originalMode);
  await rollback(result.receipt);
  assert.deepEqual(await readFile(target), original);
  assert.equal((await stat(target)).mode & 0o7777, originalMode);
  assert.equal(path.dirname(path.resolve(target)), path.resolve(root, 'nested'));
});

test('rejects conflicts and duplicate targets before changing files', async (t) => {
  const { stateDir, target } = await fixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'keep me');

  await assert.rejects(
    installFiles({ files: [{ path: target, content: 'different' }], stateDir }),
    /replace/i,
  );
  await assert.rejects(
    installFiles({ files: [
      { path: target, content: 'one' },
      { path: path.join(path.dirname(target), '.', path.basename(target)), content: 'two' },
    ], stateDir, replace: true }),
    /duplicate/i,
  );
  await assert.rejects(
    installFiles({ files: [{ path: 'relative.toml', content: 'x' }], stateDir }),
    /absolute/i,
  );
  assert.equal(await readFile(target, 'utf8'), 'keep me');
  assert.deepEqual(await readdir(path.dirname(target)), ['worker.toml']);
});

test('returns unchanged without a receipt when every target already has the requested content', async (t) => {
  const { stateDir, target } = await fixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'same');

  const result = await installFiles({ files: [{ path: target, content: 'same' }], stateDir });

  assert.deepEqual(result, {
    status: 'unchanged',
    receipt: null,
    paths: [path.resolve(target)],
  });
});

test('automatically rolls back every target when post-write verification fails', async (t) => {
  const { root, stateDir, target } = await fixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'original');
  const secondTarget = path.join(root, 'second', 'new.toml');

  let installError;
  await assert.rejects(
    installFiles({
      files: [
        { path: target, content: 'changed' },
        { path: secondTarget, content: 'created' },
      ],
      stateDir,
      replace: true,
      verify: async () => { throw new Error('verification exploded'); },
    }),
    (error) => {
      installError = error;
      return /verification exploded/.test(error.message);
    },
  );

  const match = installError.message.match(/receipt:\s*(\S+)/i);
  assert.ok(match, 'error includes the recovery receipt path');
  const record = await receiptAt(match[1]);
  assert.equal(record.status, 'rolled_back');

  assert.equal(await readFile(target, 'utf8'), 'original');
  assert.equal(await fileExists(secondTarget), false);
  assert.equal(await fileExists(path.join(root, 'second')), false);
});

test('restores an old target that is absent when rollback resumes', async (t) => {
  const { stateDir, target } = await fixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'before');
  const result = await installFiles({
    files: [{ path: target, content: 'after' }],
    stateDir,
    replace: true,
  });
  await unlink(target);

  await rollback(result.receipt);

  assert.equal(await readFile(target, 'utf8'), 'before');
});

test('refuses to overwrite a target changed after installation', async (t) => {
  const { stateDir, target } = await fixture(t);
  const result = await installFiles({ files: [{ path: target, content: 'installed' }], stateDir });
  await writeFile(target, 'external edit');

  await assert.rejects(rollback(result.receipt), /changed|modified|match/i);
  assert.equal(await readFile(target, 'utf8'), 'external edit');
});

test('an older receipt cannot remove a newer install with identical bytes', async (t) => {
  const { root, stateDir, target } = await fixture(t);
  const first = await installFiles({ files: [{ path: target, content: 'desired' }], stateDir });
  await writeFile(target, 'intervening edit');
  const second = await installFiles({
    files: [{ path: target, content: 'desired' }],
    stateDir: path.join(root, 'newer-state'),
    replace: true,
  });

  await assert.rejects(rollback(first.receipt), /identity|changed|newer/i);
  assert.equal(await readFile(target, 'utf8'), 'desired');
  assert.equal((await receiptAt(first.receipt)).status, 'rollback_failed');
  await rollback(second.receipt);
  assert.equal(await readFile(target, 'utf8'), 'intervening edit');
});

test('an older receipt cannot restore old bytes over a newer install', async (t) => {
  const { root, stateDir, target } = await fixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'original');
  const first = await installFiles({
    files: [{ path: target, content: 'desired' }], stateDir, replace: true,
  });
  await writeFile(target, 'intervening edit');
  const second = await installFiles({
    files: [{ path: target, content: 'desired' }],
    stateDir: path.join(root, 'newer-state'),
    replace: true,
  });

  await assert.rejects(rollback(first.receipt), /identity|changed|newer/i);
  assert.equal(await readFile(target, 'utf8'), 'desired');
  await rollback(second.receipt);
  assert.equal(await readFile(target, 'utf8'), 'intervening edit');
});

test('rejects a malformed receipt without touching targets', async (t) => {
  const { root, target } = await fixture(t);
  const receiptPath = path.join(root, 'bad-receipt.json');
  await writeFile(target, 'keep me').catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'keep me');
  });
  await writeFile(receiptPath, '{not json');

  await assert.rejects(rollback(receiptPath), /receipt|json|invalid/i);
  assert.equal(await readFile(target, 'utf8'), 'keep me');
});

test('rejects target paths that traverse a symlink when the platform permits symlinks', async (t) => {
  const { root, stateDir } = await fixture(t);
  const realDir = path.join(root, 'real');
  const linkDir = path.join(root, 'link');
  await mkdir(realDir);
  try {
    await symlink(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip(`symlink creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const target = path.join(linkDir, 'worker.toml');
  await assert.rejects(
    installFiles({ files: [{ path: target, content: 'no write' }], stateDir }),
    /symlink|symbolic|junction/i,
  );
  assert.equal(await fileExists(path.join(realDir, 'worker.toml')), false);
});

test('leaves an existing live lock in place and rejects a competing install', async (t) => {
  const { stateDir, target } = await fixture(t);
  const first = await installFiles({ files: [{ path: target, content: 'first' }], stateDir });
  const record = await receiptAt(first.receipt);
  const lock = record.locks.find((entry) => entry.target === path.resolve(target));
  assert.ok(lock, 'receipt records each acquired lock');
  await writeFile(lock.path, JSON.stringify({ pid: process.pid, token: 'someone-else', target: lock.target }));

  let competingError;
  await assert.rejects(
    installFiles({ files: [{ path: target, content: 'second' }], stateDir, replace: true }),
    (error) => {
      competingError = error;
      return /lock/i.test(error.message);
    },
  );

  assert.doesNotMatch(competingError.message, /automatic rollback completed/i);
  assert.equal(await readFile(target, 'utf8'), 'first');
  assert.equal(await fileExists(lock.path), true);
});

test('keeps a failed rollback receipt that can be retried after the conflict is resolved', async (t) => {
  const { stateDir, target } = await fixture(t);
  let transactionReceipt;

  await assert.rejects(
    installFiles({
      files: [{ path: target, content: 'intended' }],
      stateDir,
      verify: async () => {
        await writeFile(target, 'temporary external change');
        throw new Error('verify interrupted');
      },
    }),
    (error) => {
      assert.match(error.message, /verify interrupted/);
      assert.match(error.message, /rollback failed/i);
      const match = error.message.match(/receipt:\s*(\S+)/i);
      assert.ok(match);
      transactionReceipt = match[1];
      return true;
    },
  );

  assert.equal((await receiptAt(transactionReceipt)).status, 'rollback_failed');
  await writeFile(target, 'intended');
  await rollback(transactionReceipt);
  assert.equal(await fileExists(target), false);
});

test('rollback is idempotent and retains its receipt', async (t) => {
  const { stateDir, target } = await fixture(t);
  const result = await installFiles({ files: [{ path: target, content: 'installed' }], stateDir });

  await rollback(result.receipt);
  const second = await rollback(result.receipt);

  assert.equal(second.status, 'rolled_back');
  assert.equal(await fileExists(target), false);
  assert.equal((await receiptAt(result.receipt)).status, 'rolled_back');
});

test('locks the same target across different state directories', async (t) => {
  const { root, stateDir, target } = await fixture(t);
  const otherStateDir = path.join(root, 'other-state');
  let releaseFirst;
  let enteredVerify;
  const verifyEntered = new Promise((resolve) => { enteredVerify = resolve; });
  const verifyGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstInstall = installFiles({
    files: [{ path: target, content: 'first' }],
    stateDir,
    verify: async () => {
      enteredVerify();
      await verifyGate;
    },
  });

  await verifyEntered;
  try {
    await assert.rejects(
      installFiles({ files: [{ path: target, content: 'first' }], stateDir: otherStateDir }),
      /lock/i,
      'an identical-content call must wait for or reject the active transaction',
    );
    await assert.rejects(
      installFiles({ files: [{ path: target, content: 'second' }], stateDir: otherStateDir, replace: true }),
      /lock/i,
    );
    assert.equal(await readFile(target, 'utf8'), 'first');
  } finally {
    releaseFirst();
  }
  await firstInstall;
  assert.equal(await readFile(target, 'utf8'), 'first');
});

test('a failed pre-write receipt cannot undo a later successful install', async (t) => {
  const { root, stateDir, target } = await fixture(t);
  let enterVerify;
  let finishVerify;
  const entered = new Promise((resolve) => { enterVerify = resolve; });
  const gate = new Promise((resolve) => { finishVerify = resolve; });
  const first = installFiles({
    files: [{ path: target, content: 'intermediate' }], stateDir,
    verify: async () => { enterVerify(); await gate; },
  });
  await entered;
  let failedReceipt;
  try {
    await assert.rejects(
      installFiles({files:[{path:target,content:'final'}],stateDir:path.join(root,'failed-state'),replace:true}),
      (error) => {
        assert.match(error.message,/lock/i);
        failedReceipt=error.message.match(/receipt:\s*(\S+)/i)?.[1];
        assert.ok(failedReceipt);
        return true;
      },
    );
  } finally { finishVerify(); }
  await first;
  assert.equal((await receiptAt(failedReceipt)).mutationStarted,false);
  await installFiles({files:[{path:target,content:'final'}],stateDir:path.join(root,'final-state'),replace:true});
  assert.equal(await readFile(target,'utf8'),'final');
  await rollback(failedReceipt);
  assert.equal(await readFile(target,'utf8'),'final');
  await rollback(failedReceipt);
  assert.equal(await readFile(target,'utf8'),'final');
});

test('rollback of a lock-losing receipt preserves a later install with matching intended bytes', async (t) => {
  const { root, stateDir, target } = await fixture(t);
  let releaseFirst;
  let enteredVerify;
  const verifyEntered = new Promise((resolve) => { enteredVerify = resolve; });
  const verifyGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstInstall = installFiles({
    files: [{ path: target, content: 'intermediate' }],
    stateDir,
    verify: async () => {
      enteredVerify();
      await verifyGate;
    },
  });

  await verifyEntered;
  let losingReceipt;
  try {
    await assert.rejects(
      installFiles({ files: [{ path: target, content: 'final' }], stateDir, replace: true }),
      (error) => {
        losingReceipt = error.message.match(/receipt:\s*(\S+)/i)?.[1];
        return /lock/i.test(error.message) && Boolean(losingReceipt);
      },
    );
  } finally {
    releaseFirst();
  }
  await firstInstall;

  await installFiles({ files: [{ path: target, content: 'final' }], stateDir, replace: true });
  await rollback(losingReceipt);

  assert.equal(await readFile(target, 'utf8'), 'final');
});

test('checks expectedOriginalHash before accepting a replacement', async (t) => {
  const { stateDir, target } = await fixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'current');
  const wrongHash = '0'.repeat(64);

  await assert.rejects(
    installFiles({
      files: [{ path: target, content: 'replacement', expectedOriginalHash: wrongHash }],
      stateDir,
      replace: true,
    }),
    /expectedOriginalHash|stale|changed/i,
  );
  assert.equal(await readFile(target, 'utf8'), 'current');
});

test('explicit rollback recovers after process exit and removes receipt-owned stale target temps', async (t) => {
  const { root, stateDir, target } = await fixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'before');
  const moduleUrl = new URL('../skills/code-workers/scripts/lib/transaction.mjs', import.meta.url).href;
  const script = `import { installFiles } from ${JSON.stringify(moduleUrl)};\nawait installFiles({ files: [{ path: ${JSON.stringify(target)}, content: 'after' }], stateDir: ${JSON.stringify(stateDir)}, replace: true, verify: async () => process.exit(0) });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await readFile(target, 'utf8'), 'after');

  const receiptName = (await readdir(stateDir)).find((name) => /^transaction-.*\.json$/.test(name));
  assert.ok(receiptName, 'interrupted install leaves a receipt');
  const receiptPath = path.join(stateDir, receiptName);
  const record = await receiptAt(receiptPath);
  const staleTemp = record.items[0].rollbackTempPath;
  await writeFile(staleTemp, 'interrupted rollback temp');

  await rollback(receiptPath);

  assert.equal(await readFile(target, 'utf8'), 'before');
  assert.equal(await fileExists(staleTemp), false);
});

test('reports recovery required when lock cleanup fails without hiding the install failure', async (t) => {
  const { stateDir, target } = await fixture(t);
  let lockDirectory;
  let installError;

  await assert.rejects(
    installFiles({
      files: [{ path: target, content: 'installed' }],
      stateDir,
      verify: async () => {
        const receiptName = (await readdir(stateDir)).find((name) => /^transaction-.*\.json$/.test(name));
        const record = await receiptAt(path.join(stateDir, receiptName));
        const lock = record.locks[0];
        await unlink(lock.path);
        await mkdir(lock.path);
        lockDirectory = lock.path;
        throw new Error('verification must remain visible');
      },
    }),
    (error) => {
      installError = error;
      return /verification must remain visible/.test(error.message)
        && /recovery|required|cleanup/i.test(error.message)
        && /receipt:/i.test(error.message);
    },
  );

  const receiptPath = installError.message.match(/receipt:\s*(\S+)/i)?.[1];
  assert.ok(receiptPath);
  assert.equal((await receiptAt(receiptPath)).status, 'recovery_required');
  assert.equal(await fileExists(target), false, 'the original write was rolled back');
  const canonicalTemp = await import('node:fs/promises').then(({ realpath }) => realpath(os.tmpdir()));
  assert.equal(path.dirname(lockDirectory), path.join(canonicalTemp, path.basename(path.dirname(lockDirectory))));
  assert.match(path.basename(path.dirname(lockDirectory)), /^code-workers-locks-/);
  await rm(lockDirectory, { recursive: true, force: true });
});
