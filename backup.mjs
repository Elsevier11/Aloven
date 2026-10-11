import * as sqlite from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { DatabaseSync } = sqlite;
const BACKUP_PREFIX = 'aloven-backup-';
const BACKUP_FILE = /^aloven-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?\.sqlite$/;
const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_RETENTION = 14;

export function assertSupportedNodeRuntime(version = process.versions.node) {
  const [major, minor] = String(version).split('.').map(Number);
  if (!Number.isInteger(major) || major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`Backup SQLite richiede Node.js >=22.13 (runtime corrente: ${version}).`);
  }
}

function positiveNumber(value, label, fallback) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} deve essere un numero maggiore di zero.`);
  return number;
}

function positiveInteger(value, label, fallback) {
  const number = positiveNumber(value, label, fallback);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} deve essere un intero positivo.`);
  return number;
}

export function backupConfig(env = process.env, { dataDir = env.DATA_DIR || path.join(process.cwd(), 'data') } = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  return {
    dataDir: resolvedDataDir,
    backupDir: path.resolve(env.BACKUP_DIR || path.join(resolvedDataDir, 'backups')),
    intervalHours: positiveNumber(env.BACKUP_INTERVAL_HOURS, 'BACKUP_INTERVAL_HOURS', DEFAULT_INTERVAL_HOURS),
    retention: positiveInteger(env.BACKUP_RETENTION, 'BACKUP_RETENTION', DEFAULT_RETENTION),
  };
}

function checkedDirectory(directory) {
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) throw new Error('La directory dei backup non può essere la radice del filesystem.');
  mkdirSync(resolved, { recursive: true });
  if (!statSync(resolved).isDirectory()) throw new Error(`Il percorso backup non è una directory: ${resolved}`);
  return resolved;
}

function timestamp(date) {
  return date.toISOString().replaceAll(':', '-').replace('.', '-');
}

function availableDestination(directory, date) {
  const stem = `${BACKUP_PREFIX}${timestamp(date)}`;
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = path.join(directory, `${stem}${suffix ? `-${suffix}` : ''}.sqlite`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('Impossibile assegnare un nome univoco al backup.');
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function verifyDatabase(filePath) {
  assertSupportedNodeRuntime();
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`Database non trovato: ${resolved}`);
  let database;
  try {
    database = new DatabaseSync(resolved, { readOnly: true });
    const integrityRows = database.prepare('PRAGMA integrity_check').all();
    const integrityMessages = integrityRows.map(row => String(row.integrity_check ?? Object.values(row)[0]));
    if (integrityMessages.length !== 1 || integrityMessages[0].toLowerCase() !== 'ok') {
      throw new Error(`Controllo integrità fallito: ${integrityMessages.join('; ') || 'nessun risultato'}`);
    }
    database.exec('PRAGMA foreign_keys=ON');
    const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyErrors.length) throw new Error(`Controllo chiavi esterne fallito: ${foreignKeyErrors.length} violazioni.`);
    return { file: resolved, integrity: 'ok', foreignKeyViolations: 0, size: statSync(resolved).size };
  } catch (error) {
    throw new Error(`Database SQLite non valido (${resolved}): ${error.message}`, { cause: error });
  } finally {
    database?.close();
  }
}

function pruneBackups(directory, retention) {
  const known = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && BACKUP_FILE.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();
  const removed = [];
  for (const name of known.slice(retention)) {
    const target = path.join(directory, name);
    if (path.dirname(target) !== directory || !BACKUP_FILE.test(path.basename(target))) continue;
    unlinkSync(target);
    removed.push(target);
  }
  return removed;
}

export async function createConsistentBackup(db, options = {}) {
  assertSupportedNodeRuntime();
  if (!db || typeof db.exec !== 'function') throw new Error('Connessione SQLite non valida.');
  const dataDir = path.resolve(options.dataDir || path.join(process.cwd(), 'data'));
  const directory = checkedDirectory(options.backupDir || path.join(dataDir, 'backups'));
  const retention = positiveInteger(options.retention, 'retention', DEFAULT_RETENTION);
  const now = options.now instanceof Date ? options.now : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Data backup non valida.');
  const destination = availableDestination(directory, now);
  const temporary = path.join(directory, `.${path.basename(destination)}.tmp-${randomBytes(6).toString('hex')}`);
  try {
    if (typeof options.sqliteBackup === 'function') await options.sqliteBackup(db, temporary);
    else if (typeof sqlite.backup === 'function') await sqlite.backup(db, temporary);
    else db.exec(`VACUUM INTO ${sqlString(temporary)}`);
    const verification = verifyDatabase(temporary);
    renameSync(temporary, destination);
    const removed = pruneBackups(directory, retention);
    return { file: destination, createdAt: now.toISOString(), size: verification.size, removed };
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

export function restoreBackup(source, options = {}) {
  assertSupportedNodeRuntime();
  if (options.stopped !== true) throw new Error('Ripristino rifiutato: arresta il server e specifica esplicitamente --stopped.');
  const sourcePath = path.resolve(source);
  const sourceVerification = verifyDatabase(sourcePath);
  const defaultName = `aloven-restored-${timestamp(new Date())}`;
  const targetDir = path.resolve(options.targetDir || path.join(path.dirname(sourcePath), defaultName));
  if (targetDir === path.parse(targetDir).root) throw new Error('La directory di ripristino non può essere la radice del filesystem.');
  if (existsSync(targetDir)) throw new Error(`La directory di ripristino esiste già: ${targetDir}`);
  mkdirSync(targetDir, { recursive: false });
  const target = path.join(targetDir, options.targetName || 'aloven.sqlite');
  try {
    copyFileSync(sourcePath, target, fsConstants.COPYFILE_EXCL);
    const verification = verifyDatabase(target);
    return { source: sourcePath, target, size: verification.size, integrity: verification.integrity, sourceSize: sourceVerification.size };
  } catch (error) {
    if (existsSync(targetDir) && path.dirname(target) === targetDir) rmSync(targetDir, { recursive: true, force: true });
    throw error;
  }
}

export function testRestore(source, options = {}) {
  const root = checkedDirectory(options.tempRoot || path.dirname(path.resolve(source)));
  const temporary = mkdtempSync(path.join(root, '.aloven-restore-test-'));
  if (path.dirname(temporary) !== root) throw new Error('Directory temporanea di verifica non sicura.');
  try {
    const result = restoreBackup(source, { stopped: true, targetDir: path.join(temporary, 'restored') });
    return { ...result, temporaryDirectory: temporary, cleaned: true };
  } finally {
    if (existsSync(temporary) && path.dirname(temporary) === root && path.basename(temporary).startsWith('.aloven-restore-test-')) {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

function serializedError(error) {
  return { name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error) };
}

export function startBackupSchedule(db, options = {}) {
  assertSupportedNodeRuntime();
  const config = {
    ...backupConfig(options.env || process.env, { dataDir: options.dataDir }),
    ...options,
  };
  const intervalMs = positiveNumber(config.intervalHours, 'intervalHours', DEFAULT_INTERVAL_HOURS) * 3_600_000;
  const retryDelayMs = positiveNumber(config.retryDelayMs, 'retryDelayMs', Math.min(intervalMs, 3_600_000));
  const logger = config.logger || console;
  const createBackup = config.createBackup || createConsistentBackup;
  const runRestoreTest = config.restoreTest === false ? null : (config.runRestoreTest || testRestore);
  let timer = null;
  let stopped = false;
  let active = null;
  const initial = config.initialBackup || null;
  const status = {
    running: false,
    lastSuccessAt: initial?.createdAt || null,
    lastFailureAt: null,
    lastError: null,
    lastFile: initial?.file || null,
    nextAt: null,
    targetDirectory: path.resolve(config.backupDir),
  };

  const schedule = delay => {
    if (stopped) return;
    status.nextAt = new Date(Date.now() + delay).toISOString();
    timer = setTimeout(() => { void runNow().catch(() => {}); }, delay);
    timer.unref?.();
  };

  const runNow = () => {
    if (active) return active;
    if (timer) clearTimeout(timer);
    timer = null;
    status.nextAt = null;
    status.running = true;
    active = Promise.resolve()
      .then(() => createBackup(db, config))
      .then(result => {
        if (runRestoreTest) runRestoreTest(result.file, { tempRoot: config.backupDir });
        status.lastSuccessAt = result.createdAt || new Date().toISOString();
        status.lastFile = result.file;
        status.lastError = null;
        schedule(intervalMs);
        return result;
      })
      .catch(error => {
        status.lastFailureAt = new Date().toISOString();
        status.lastError = serializedError(error);
        logger.error?.('[backup] Backup automatico fallito.', status.lastError);
        schedule(retryDelayMs);
        throw error;
      })
      .finally(() => {
        status.running = false;
        active = null;
      });
    return active;
  };

  schedule(config.runImmediately ? 0 : intervalMs);
  return {
    getStatus: () => structuredClone(status),
    runNow,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      status.nextAt = null;
    },
  };
}

export const backupDefaults = Object.freeze({ intervalHours: DEFAULT_INTERVAL_HOURS, retention: DEFAULT_RETENTION });
