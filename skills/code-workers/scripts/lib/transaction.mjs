import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const RECEIPT_VERSION = 1;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function errorCode(error) {
  return error && typeof error === 'object' ? error.code : undefined;
}

function isMissing(error) {
  return errorCode(error) === 'ENOENT';
}

function pathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function hashTarget(filePath) {
  return createHash('sha256').update(pathKey(filePath)).digest('hex');
}

function normalizeAbsolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return path.resolve(value);
}

function encoded(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function decodeBase64(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Invalid transaction receipt: ${label} is not base64`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (encoded(bytes) !== value) throw new Error(`Invalid transaction receipt: ${label} is not canonical base64`);
  return bytes;
}

function sameBytes(left, right) {
  return left !== null && right !== null && left.length === right.length && left.equals(right);
}

function makeReceiptPath(stateDir, id) {
  return path.join(stateDir, `transaction-${id}.json`);
}

let lockRootPromise;

async function getLockRoot() {
  lockRootPromise ??= (async () => {
    const canonicalTemp = await realpath(os.tmpdir());
    let username = process.env.USERNAME ?? process.env.USER ?? 'unknown';
    let uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    try {
      const user = os.userInfo();
      username = user.username;
      uid = user.uid;
    } catch {
      // Some restricted Windows runtimes cannot resolve the account record.
    }
    const identityHash = createHash('sha256').update(`${username}\0${uid}`).digest('hex');
    return path.join(canonicalTemp, `code-workers-locks-${identityHash}`);
  })();
  return lockRootPromise;
}

function makeLockPath(lockRoot, target) {
  return path.join(lockRoot, `${hashTarget(target)}.lock`);
}

function makeTargetTempPath(target, id, index, suffix) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.codeworkers-${id}-${index}.${suffix}.tmp`,
  );
}

function makeLockTempPath(lockPath, token) {
  return `${lockPath}.${token}.tmp`;
}

function makeReceiptTempPath(receiptPath) {
  return `${receiptPath}.${randomUUID()}.tmp`;
}

async function lstatOrNull(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function assertNoSymlinkAncestry(absolutePath, { statePath = false } = {}) {
  const ancestors = [];
  let current = absolutePath;
  for (;;) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const ancestor of ancestors.reverse()) {
    const info = await lstatOrNull(ancestor);
    if (!info) continue;
    if (info.isSymbolicLink()) {
      throw new Error(`Symlink or junction in path ancestry: ${ancestor}`);
    }
    if (ancestor !== absolutePath && !info.isDirectory()) {
      throw new Error(`Path ancestry contains a non-directory: ${ancestor}`);
    }
  }

  if (statePath) {
    const info = await lstatOrNull(absolutePath);
    if (info && !info.isDirectory()) throw new Error(`State location is not a directory: ${absolutePath}`);
  }
}

async function snapshotTarget(target) {
  const info = await lstatOrNull(target);
  if (!info) return { bytes: null, mode: null };
  if (info.isSymbolicLink()) throw new Error(`Target is a symlink or junction: ${target}`);
  if (info.isDirectory()) throw new Error(`Target is a directory: ${target}`);
  if (!info.isFile()) throw new Error(`Target is not a regular file: ${target}`);
  return {
    bytes: await readFile(target),
    mode: info.mode & 0o7777,
  };
}

async function missingParentDirectories(target) {
  const missing = [];
  let current = path.dirname(target);
  while (true) {
    const info = await lstatOrNull(current);
    if (info) {
      if (info.isSymbolicLink()) throw new Error(`Symlink or junction in target ancestry: ${current}`);
      if (!info.isDirectory()) throw new Error(`Target parent is not a directory: ${current}`);
      break;
    }
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`No existing directory ancestor for target: ${target}`);
    current = parent;
  }
  return missing.reverse();
}

async function ensureDirectory(directoryPath, mode = PRIVATE_DIR_MODE) {
  await assertNoSymlinkAncestry(directoryPath, { statePath: true });
  const missing = [];
  let current = directoryPath;
  while (!(await lstatOrNull(current))) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const next of missing.reverse()) {
    try {
      await mkdir(next, { mode });
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    const info = await lstat(next);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Expected a real directory at ${next}`);
    }
  }
}

async function syncDirectory(directoryPath) {
  if (process.platform === 'win32') return;
  const handle = await open(directoryPath, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function persistReceipt(receiptPath, receipt) {
  const tempPath = makeReceiptTempPath(receiptPath);
  let created = false;
  let handle;
  try {
    handle = await open(tempPath, 'wx', PRIVATE_FILE_MODE);
    created = true;
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, receiptPath);
    created = false;
    await syncDirectory(path.dirname(receiptPath));
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (created) await unlink(tempPath).catch((cleanupError) => {
      if (!isMissing(cleanupError)) error.cleanupError = cleanupError;
    });
    throw error;
  }
}

async function createLock(entry) {
  let createdTemp = false;
  let handle;
  try {
    handle = await open(entry.tempPath, 'wx', PRIVATE_FILE_MODE);
    createdTemp = true;
    await handle.writeFile(`${JSON.stringify({
      transactionId: entry.transactionId,
      target: entry.target,
      pid: entry.pid,
      token: entry.token,
    })}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(entry.tempPath, entry.path);
    await unlink(entry.tempPath);
    createdTemp = false;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (createdTemp) await unlink(entry.tempPath).catch((cleanupError) => {
      if (!isMissing(cleanupError)) error.cleanupError = cleanupError;
    });
    throw error;
  }
}

async function readLock(lockPath) {
  try {
    const info = await lstat(lockPath);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Lock is not a regular file: ${lockPath}`);
    const data = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!data || !Number.isInteger(data.pid) || typeof data.token !== 'string') {
      throw new Error(`Malformed lock file: ${lockPath}`);
    }
    return data;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    if (errorCode(error) === 'EPERM' || errorCode(error) === 'EACCES') return true;
    // Windows and some restricted runtimes may report an indeterminate access
    // error for an existing PID. Keep the lock in that case.
    return true;
  }
}

async function unlinkOwnedLock(entry) {
  const existing = await readLock(entry.path);
  if (existing && existing.token === entry.token && existing.target === entry.target) {
    await unlink(entry.path);
  }
  await unlink(entry.tempPath).catch((error) => {
    if (!isMissing(error)) throw error;
  });
}

function newLockEntry(lockRoot, target, transactionId) {
  const lockPath = makeLockPath(lockRoot, target);
  const token = randomUUID();
  return {
    transactionId,
    target,
    path: lockPath,
    token,
    pid: process.pid,
    tempPath: makeLockTempPath(lockPath, token),
  };
}

function makeItem(file, target, snapshot, index, id) {
  const intended = Buffer.from(file.content, 'utf8');
  const originalBytes = snapshot.bytes;
  const item = {
    path: target,
    originalBase64: originalBytes === null ? null : encoded(originalBytes),
    originalMode: snapshot.mode,
    intendedBase64: encoded(intended),
    intendedHash: createHash('sha256').update(intended).digest('hex'),
    intendedMode: snapshot.mode === null ? PRIVATE_FILE_MODE : snapshot.mode,
    tempPath: makeTargetTempPath(target, id, index, 'install'),
    rollbackTempPath: makeTargetTempPath(target, id, index, 'rollback'),
    rolledBack: false,
  };
  if (file.expectedOriginalHash !== undefined) item.expectedOriginalHash = file.expectedOriginalHash;
  return item;
}

function bytesEqualCurrent(snapshot, bytes) {
  return snapshot.bytes === null ? bytes === null : sameBytes(snapshot.bytes, bytes);
}

async function preflightFiles(files, replace) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('files must be a non-empty array');
  const seen = new Set();
  const planned = [];

  for (const file of files) {
    if (!file || typeof file !== 'object') throw new Error('Each file must be an object');
    const target = normalizeAbsolute(file.path, 'File path');
    if (typeof file.content !== 'string') throw new Error(`File content must be a UTF-8 string: ${target}`);
    const key = pathKey(target);
    if (seen.has(key)) throw new Error(`Duplicate target path: ${target}`);
    seen.add(key);

    await assertNoSymlinkAncestry(target);
    const snapshot = await snapshotTarget(target);
    if (file.expectedOriginalHash !== undefined) {
      if (file.expectedOriginalHash !== null
        && (typeof file.expectedOriginalHash !== 'string' || !/^[0-9a-f]{64}$/.test(file.expectedOriginalHash))) {
        throw new Error(`expectedOriginalHash must be null or a lowercase SHA-256 hash: ${target}`);
      }
      const actualHash = snapshot.bytes === null
        ? null
        : createHash('sha256').update(snapshot.bytes).digest('hex');
      if (actualHash !== file.expectedOriginalHash) {
        throw new Error(`Stale expectedOriginalHash for target: ${target}`);
      }
    }
    const intended = Buffer.from(file.content, 'utf8');
    if (snapshot.bytes !== null && !sameBytes(snapshot.bytes, intended) && !replace) {
      throw new Error(`Target already exists with different content; set replace=true: ${target}`);
    }
    const directories = await missingParentDirectories(target);
    planned.push({ file, target, snapshot, directories });
  }
  return planned;
}

async function verifyReceiptPath(receiptPath) {
  const absoluteReceipt = normalizeAbsolute(receiptPath, 'Receipt path');
  await assertNoSymlinkAncestry(absoluteReceipt);
  const info = await lstatOrNull(absoluteReceipt);
  if (!info || !info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Transaction receipt is missing or is not a regular file: ${absoluteReceipt}`);
  }
  let receipt;
  try {
    receipt = JSON.parse(await readFile(absoluteReceipt, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid transaction receipt JSON: ${absoluteReceipt}`, { cause: error });
  }
  await validateReceipt(receipt, absoluteReceipt);
  return { absoluteReceipt, receipt };
}

async function validateReceipt(receipt, receiptPath) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('Invalid transaction receipt: expected an object');
  }
  if (receipt.version !== RECEIPT_VERSION) throw new Error('Invalid transaction receipt version');
  if (typeof receipt.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(receipt.id)) {
    throw new Error('Invalid transaction receipt id');
  }
  if (typeof receipt.stateDir !== 'string' || !path.isAbsolute(receipt.stateDir)) {
    throw new Error('Invalid transaction receipt state directory');
  }
  const stateDir = path.resolve(receipt.stateDir);
  if (makeReceiptPath(stateDir, receipt.id) !== receiptPath) {
    throw new Error('Transaction receipt path does not match its recorded identity');
  }
  if (!['prepared', 'writing', 'installed_pending_reload', 'rolling_back', 'rollback_failed', 'rolled_back', 'failed', 'recovery_required'].includes(receipt.status)) {
    throw new Error('Invalid transaction receipt status');
  }
  if (typeof receipt.mutationStarted !== 'boolean') {
    throw new Error('Invalid transaction receipt mutation marker');
  }
  if (['writing', 'installed_pending_reload', 'rolling_back', 'rollback_failed'].includes(receipt.status)
    && !receipt.mutationStarted) {
    throw new Error('Inconsistent transaction receipt mutation marker');
  }
  if (['prepared', 'failed'].includes(receipt.status) && receipt.mutationStarted) {
    throw new Error('Inconsistent pre-write transaction receipt mutation marker');
  }
  if (!Array.isArray(receipt.items) || receipt.items.length === 0) {
    throw new Error('Invalid transaction receipt items');
  }
  if (!Array.isArray(receipt.createdDirectories) || !Array.isArray(receipt.locks)) {
    throw new Error('Invalid transaction receipt directories or locks');
  }
  const expectedLockRoot = await getLockRoot();
  if (receipt.lockRoot !== expectedLockRoot) throw new Error('Invalid transaction receipt lock root');

  const seen = new Set();
  for (let index = 0; index < receipt.items.length; index += 1) {
    const item = receipt.items[index];
    if (!item || typeof item !== 'object') throw new Error('Invalid transaction receipt item');
    const target = normalizeAbsolute(item.path, 'Receipt target');
    if (target !== item.path || seen.has(pathKey(target))) throw new Error('Invalid or duplicate target in transaction receipt');
    seen.add(pathKey(target));
    const original = decodeBase64(item.originalBase64, 'originalBase64', true);
    const intended = decodeBase64(item.intendedBase64, 'intendedBase64');
    if (!/^[0-9a-f]{64}$/i.test(item.intendedHash) || createHash('sha256').update(intended).digest('hex') !== item.intendedHash) {
      throw new Error(`Invalid intended hash in transaction receipt: ${target}`);
    }
    for (const [name, mode] of [['originalMode', item.originalMode], ['intendedMode', item.intendedMode]]) {
      if (mode !== null && (!Number.isInteger(mode) || mode < 0 || mode > 0o7777)) {
        throw new Error(`Invalid ${name} in transaction receipt: ${target}`);
      }
    }
    if ((original === null) !== (item.originalMode === null)) {
      throw new Error(`Inconsistent original mode in transaction receipt: ${target}`);
    }
    if (Object.hasOwn(item, 'expectedOriginalHash')) {
      const expectedHash = item.expectedOriginalHash;
      if (expectedHash !== null && (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash))) {
        throw new Error(`Invalid expected original hash in transaction receipt: ${target}`);
      }
      const originalHash = original === null ? null : createHash('sha256').update(original).digest('hex');
      if (expectedHash !== originalHash) throw new Error(`Inconsistent expected original hash in transaction receipt: ${target}`);
    }
    const installTemp = makeTargetTempPath(target, receipt.id, index, 'install');
    const rollbackTemp = makeTargetTempPath(target, receipt.id, index, 'rollback');
    if (item.tempPath !== installTemp || item.rollbackTempPath !== rollbackTemp) {
      throw new Error(`Invalid temporary path in transaction receipt: ${target}`);
    }
    if (typeof item.rolledBack !== 'boolean') throw new Error(`Invalid rollback progress in transaction receipt: ${target}`);
  }

  const lockByTarget = new Map(receipt.locks.map((entry) => [entry?.target, entry]));
  if (receipt.locks.length !== receipt.items.length) throw new Error('Invalid transaction receipt lock count');
  for (const item of receipt.items) {
    const entry = lockByTarget.get(item.path);
    if (!entry || entry.transactionId !== receipt.id || entry.path !== makeLockPath(receipt.lockRoot, item.path)) {
      throw new Error(`Invalid lock metadata in transaction receipt: ${item.path}`);
    }
    if (typeof entry.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(entry.token) || !Number.isSafeInteger(entry.pid) || entry.pid <= 0) {
      throw new Error(`Invalid lock owner metadata in transaction receipt: ${item.path}`);
    }
    if (entry.tempPath !== makeLockTempPath(entry.path, entry.token)) {
      throw new Error(`Invalid lock temporary path in transaction receipt: ${item.path}`);
    }
  }

  const directories = new Set();
  for (const directory of receipt.createdDirectories) {
    const absolute = normalizeAbsolute(directory, 'Receipt directory');
    if (absolute !== directory || directories.has(pathKey(absolute))) {
      throw new Error('Invalid or duplicate directory in transaction receipt');
    }
    directories.add(pathKey(absolute));
    if (!receipt.items.some((item) => {
      const parent = path.dirname(item.path);
      return parent === absolute || parent.startsWith(`${absolute}${path.sep}`);
    })) {
      throw new Error(`Receipt directory is unrelated to its targets: ${directory}`);
    }
  }
}

async function cleanupReceiptTemps(receiptPath, receiptId) {
  const directory = path.dirname(receiptPath);
  const prefix = `${path.basename(receiptPath)}.`;
  const names = await readdir(directory);
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
    const candidate = path.join(directory, name);
    const info = await lstatOrNull(candidate);
    if (!info) continue;
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Refusing to remove non-file receipt temporary: ${candidate}`);
    // Receipt names are unique and the temp prefix comes from this exact receipt.
    if (!path.basename(candidate).startsWith(`transaction-${receiptId}.json.`)) continue;
    await unlink(candidate);
  }
}

async function cleanupTargetTemps(receipt) {
  for (const item of receipt.items) {
    for (const tempPath of [item.tempPath, item.rollbackTempPath]) {
      const info = await lstatOrNull(tempPath);
      if (!info) continue;
      if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Refusing to remove non-file transaction temporary: ${tempPath}`);
      await unlink(tempPath);
    }
  }
}

async function cleanupReceiptOwnedLocks(receipt) {
  for (const entry of receipt.locks) {
    const existing = await readLock(entry.path);
    if (existing && existing.token === entry.token && existing.target === entry.target) {
      if (!(await isProcessAlive(existing.pid))) await unlink(entry.path);
    }
    const tempInfo = await lstatOrNull(entry.tempPath);
    if (tempInfo) {
      if (tempInfo.isSymbolicLink() || !tempInfo.isFile()) throw new Error(`Refusing to remove non-file lock temporary: ${entry.tempPath}`);
      if (!(await isProcessAlive(entry.pid))) await unlink(entry.tempPath);
    }
  }
}

async function removeCreatedDirectories(receipt) {
  for (const directory of [...receipt.createdDirectories].reverse()) {
    const info = await lstatOrNull(directory);
    if (!info) continue;
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Refusing to remove changed transaction directory: ${directory}`);
    }
    try {
      await rmdir(directory);
      await syncDirectory(path.dirname(directory));
    } catch (error) {
      if (isMissing(error) || errorCode(error) === 'ENOTEMPTY' || errorCode(error) === 'EEXIST') continue;
      throw error;
    }
  }
}

async function currentStateForItem(item) {
  await assertNoSymlinkAncestry(item.path);
  return snapshotTarget(item.path);
}

async function planRollback(receipt) {
  const actions = [];
  for (const item of receipt.items) {
    const original = decodeBase64(item.originalBase64, 'originalBase64', true);
    const intended = decodeBase64(item.intendedBase64, 'intendedBase64');
    const current = await currentStateForItem(item);

    if (original === null) {
      if (current.bytes === null) {
        actions.push({ item, action: 'none' });
      } else if (sameBytes(current.bytes, intended)) {
        actions.push({ item, action: 'remove' });
      } else {
        throw new Error(`Refusing rollback: target changed after install: ${item.path}`);
      }
      continue;
    }

    if (current.bytes === null) {
      actions.push({ item, action: 'restore', original });
    } else if (sameBytes(current.bytes, original)) {
      actions.push({
        item,
        action: current.mode === item.originalMode ? 'none' : 'restore',
        original,
      });
    } else if (sameBytes(current.bytes, intended)) {
      actions.push({ item, action: 'restore', original });
    } else {
      throw new Error(`Refusing rollback: target changed after install: ${item.path}`);
    }
  }
  return actions;
}

async function atomicWrite(target, tempPath, bytes, mode) {
  let handle;
  let created = false;
  try {
    handle = await open(tempPath, 'wx', mode ?? PRIVATE_FILE_MODE);
    created = true;
    await handle.writeFile(bytes);
    await handle.chmod(mode ?? PRIVATE_FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, target);
    created = false;
    await syncDirectory(path.dirname(target));
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (created) await unlink(tempPath).catch((cleanupError) => {
      if (!isMissing(cleanupError)) error.cleanupError = cleanupError;
    });
    throw error;
  }
}

async function acquireInstallLocks(receipt, receiptPath) {
  await ensureDirectory(receipt.lockRoot);
  const owned = [];
  try {
    const ordered = [...receipt.locks].sort((a, b) => pathKey(a.target).localeCompare(pathKey(b.target)));
    for (const entry of ordered) {
      await persistReceipt(receiptPath, receipt);
      try {
        await createLock(entry);
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          throw new Error(`Target lock is held by another transaction: ${entry.target}`, { cause: error });
        }
        throw error;
      }
      owned.push(entry);
    }
    return owned;
  } catch (error) {
    for (const entry of owned.reverse()) {
      try {
        await unlinkOwnedLock(entry);
      } catch (cleanupError) {
        error.lockCleanupError ??= cleanupError;
      }
    }
    throw error;
  }
}

async function acquireRollbackLocks(receipt, receiptPath) {
  await ensureDirectory(receipt.lockRoot);
  const owned = [];
  try {
    const ordered = [...receipt.locks].sort((a, b) => pathKey(a.target).localeCompare(pathKey(b.target)));
    for (const entry of ordered) {
      const current = await readLock(entry.path);
      if (current) {
        const ownedByReceipt = current.token === entry.token
          && current.target === entry.target
          && current.transactionId === receipt.id;
        if (!ownedByReceipt) throw new Error(`Target lock is held by another transaction: ${entry.target}`);
        if (await isProcessAlive(current.pid)) throw new Error(`Target lock is held by a live process: ${entry.target}`);
        await unlink(entry.path);
      }

      entry.token = randomUUID();
      entry.pid = process.pid;
      entry.tempPath = makeLockTempPath(entry.path, entry.token);
      await persistReceipt(receiptPath, receipt);
      await createLock(entry);
      owned.push(entry);
    }
    return owned;
  } catch (error) {
    for (const entry of owned.reverse()) {
      try {
        await unlinkOwnedLock(entry);
      } catch (cleanupError) {
        error.lockCleanupError ??= cleanupError;
      }
    }
    throw error;
  }
}

async function releaseLocks(owned) {
  const errors = [];
  for (const entry of [...owned].reverse()) {
    try {
      await unlinkOwnedLock(entry);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Failed to release transaction locks');
}

async function rollbackUnderLocks(receipt, receiptPath) {
  try {
    if (!receipt.mutationStarted) {
      receipt.status = 'rolled_back';
      await persistReceipt(receiptPath, receipt);
      await cleanupReceiptTemps(receiptPath, receipt.id);
      return {
        status: 'rolled_back',
        receipt: receiptPath,
        paths: receipt.items.map((item) => item.path),
      };
    }
    await cleanupTargetTemps(receipt);
    const actions = await planRollback(receipt);
    receipt.status = 'rolling_back';
    await persistReceipt(receiptPath, receipt);

    for (const { item, action, original } of actions) {
      if (action === 'remove') {
        await unlink(item.path);
        await syncDirectory(path.dirname(item.path));
      } else if (action === 'restore') {
        await atomicWrite(item.path, item.rollbackTempPath, original, item.originalMode);
      }
      item.rolledBack = true;
      await persistReceipt(receiptPath, receipt);
    }

    await cleanupTargetTemps(receipt);
    await removeCreatedDirectories(receipt);
    receipt.status = 'rolled_back';
    await persistReceipt(receiptPath, receipt);
    await cleanupReceiptTemps(receiptPath, receipt.id);
    return {
      status: 'rolled_back',
      receipt: receiptPath,
      paths: receipt.items.map((item) => item.path),
    };
  } catch (error) {
    receipt.status = 'rollback_failed';
    try {
      await persistReceipt(receiptPath, receipt);
    } catch (receiptError) {
      error.receiptUpdateError = receiptError;
    }
    throw error;
  }
}

function appendReceipt(error, receiptPath, rollbackError, rollbackAttempted) {
  const originalMessage = error instanceof Error ? error.message : String(error);
  const suffix = rollbackError
    ? `; automatic rollback failed: ${rollbackError.message}`
    : rollbackAttempted
      ? '; automatic rollback completed'
      : '; automatic rollback was not attempted';
  return new Error(`Install failed: ${originalMessage}${suffix}; receipt: ${receiptPath}`, {
    cause: error,
  });
}

export async function installFiles({ files, stateDir, replace = false, verify } = {}) {
  if (verify !== undefined && typeof verify !== 'function') throw new Error('verify must be an async function');
  if (replace !== undefined && typeof replace !== 'boolean') throw new Error('replace must be a boolean');
  const absoluteStateDir = normalizeAbsolute(stateDir, 'stateDir');
  await assertNoSymlinkAncestry(absoluteStateDir, { statePath: true });
  const planned = await preflightFiles(files, replace);
  const paths = planned.map(({ target }) => target);

  await ensureDirectory(absoluteStateDir);
  await assertNoSymlinkAncestry(absoluteStateDir, { statePath: true });
  const id = randomUUID();
  const receiptPath = makeReceiptPath(absoluteStateDir, id);
  const lockRoot = await getLockRoot();
  const receipt = {
    version: RECEIPT_VERSION,
    id,
    stateDir: absoluteStateDir,
    lockRoot,
    status: 'prepared',
    mutationStarted: false,
    createdAt: new Date().toISOString(),
    items: planned.map(({ file, target, snapshot }, index) => makeItem(file, target, snapshot, index, id)),
    createdDirectories: [...new Set(planned.flatMap(({ directories }) => directories))]
      .sort((a, b) => pathKey(a).localeCompare(pathKey(b))),
    locks: planned.map(({ target }) => newLockEntry(lockRoot, target, id)),
  };

  await persistReceipt(receiptPath, receipt);
  let ownedLocks = [];
  let targetMutationStarted = false;
  let terminalError = null;
  let result = null;
  let removeReceiptAfterRelease = false;
  try {
    ownedLocks = await acquireInstallLocks(receipt, receiptPath);

    const refreshed = [];
    for (const item of receipt.items) {
      await assertNoSymlinkAncestry(item.path);
      const snapshot = await snapshotTarget(item.path);
      const original = decodeBase64(item.originalBase64, 'originalBase64', true);
      if (!bytesEqualCurrent(snapshot, original) || snapshot.mode !== item.originalMode) {
        throw new Error(`Target changed after initial inspection; refusing stale transaction: ${item.path}`);
      }
      if (Object.hasOwn(item, 'expectedOriginalHash')) {
        const actualHash = snapshot.bytes === null
          ? null
          : createHash('sha256').update(snapshot.bytes).digest('hex');
        if (actualHash !== item.expectedOriginalHash) {
          throw new Error(`Stale expectedOriginalHash under lock: ${item.path}`);
        }
      }
      const intended = decodeBase64(item.intendedBase64, 'intendedBase64');
      if (snapshot.bytes !== null && !sameBytes(snapshot.bytes, intended) && !replace) {
        throw new Error(`Target changed to different content before installation; set replace=true: ${item.path}`);
      }
      refreshed.push({ item, snapshot });
    }

    for (const { item, snapshot } of refreshed) {
      item.intendedMode = snapshot.mode === null ? PRIVATE_FILE_MODE : snapshot.mode;
    }
    receipt.createdDirectories = [...new Set(await Promise.all(
      receipt.items.map((item) => missingParentDirectories(item.path)),
    ).then((groups) => groups.flat()))].sort((a, b) => pathKey(a).localeCompare(pathKey(b)));

    if (receipt.items.every((item) => sameBytes(
      decodeBase64(item.originalBase64, 'originalBase64', true),
      decodeBase64(item.intendedBase64, 'intendedBase64'),
    ))) {
      result = { status: 'unchanged', receipt: null, paths };
      removeReceiptAfterRelease = true;
    } else {
      await cleanupTargetTemps(receipt);
      receipt.status = 'writing';
      receipt.mutationStarted = true;
      targetMutationStarted = true;
      await persistReceipt(receiptPath, receipt);

      for (const directory of receipt.createdDirectories) {
        await ensureDirectory(directory);
      }

      for (const item of receipt.items) {
        const intended = decodeBase64(item.intendedBase64, 'intendedBase64');
        await atomicWrite(item.path, item.tempPath, intended, item.intendedMode);
      }

      for (const item of receipt.items) {
        await assertNoSymlinkAncestry(item.path);
        const written = await readFile(item.path);
        const intended = decodeBase64(item.intendedBase64, 'intendedBase64');
        if (!sameBytes(written, intended)) throw new Error(`Read-back bytes did not match requested content: ${item.path}`);
      }
      if (verify) await verify();

      receipt.status = 'installed_pending_reload';
      await persistReceipt(receiptPath, receipt);
      result = { status: 'installed_pending_reload', receipt: receiptPath, paths };
    }
  } catch (error) {
    let rollbackError = null;
    const rollbackAttempted = targetMutationStarted && ownedLocks.length === receipt.items.length;
    if (rollbackAttempted) {
      try {
        await rollbackUnderLocks(receipt, receiptPath);
      } catch (failure) {
        rollbackError = failure;
      }
    } else {
      receipt.status = 'failed';
      try {
        await persistReceipt(receiptPath, receipt);
      } catch (failure) {
        error.receiptUpdateError = failure;
      }
    }
    terminalError = appendReceipt(error, receiptPath, rollbackError, rollbackAttempted);
  }

  if (ownedLocks.length) {
    try {
      await releaseLocks(ownedLocks);
      ownedLocks = [];
    } catch (cleanupError) {
      receipt.status = 'recovery_required';
      try {
        await persistReceipt(receiptPath, receipt);
      } catch (receiptError) {
        cleanupError.receiptUpdateError = receiptError;
      }
      const prior = terminalError
        ? `${terminalError.message.replace(/; receipt: .+$/i, '')}; `
        : '';
      terminalError = new Error(
        `${prior}lock cleanup failed; recovery required; receipt: ${receiptPath}`,
        { cause: terminalError ?? cleanupError },
      );
      terminalError.cleanupError = cleanupError;
    }
  }

  if (terminalError) throw terminalError;
  if (removeReceiptAfterRelease) {
    await unlink(receiptPath);
    await cleanupReceiptTemps(receiptPath, id);
  }
  return result;
}

export async function rollback(receiptPath) {
  const { absoluteReceipt, receipt } = await verifyReceiptPath(receiptPath);
  await assertNoSymlinkAncestry(receipt.stateDir, { statePath: true });
  if (receipt.status === 'rolled_back') {
    if (receipt.mutationStarted) await cleanupTargetTemps(receipt);
    await cleanupReceiptOwnedLocks(receipt);
    await cleanupReceiptTemps(absoluteReceipt, receipt.id);
    return {
      status: 'rolled_back',
      receipt: absoluteReceipt,
      paths: receipt.items.map((item) => item.path),
    };
  }

  let ownedLocks = [];
  let result;
  let rollbackError = null;
  try {
    ownedLocks = await acquireRollbackLocks(receipt, absoluteReceipt);
    result = await rollbackUnderLocks(receipt, absoluteReceipt);
  } catch (error) {
    rollbackError = error;
  }
  if (ownedLocks.length) {
    try {
      await releaseLocks(ownedLocks);
      ownedLocks = [];
    } catch (cleanupError) {
      receipt.status = 'recovery_required';
      try {
        await persistReceipt(absoluteReceipt, receipt);
      } catch (receiptError) {
        cleanupError.receiptUpdateError = receiptError;
      }
      throw new Error(
        `Rollback cleanup failed; recovery required; receipt: ${absoluteReceipt}`,
        { cause: rollbackError ?? cleanupError },
      );
    }
  }
  if (rollbackError) throw rollbackError;
  return result;
}
