#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSupportedNodeRuntime, restoreBackup, testRestore, verifyDatabase } from './backup.mjs';

function usage() {
  return [
    'Uso:',
    '  node backup-cli.mjs verify <backup.sqlite>',
    '  node backup-cli.mjs restore <backup.sqlite> --stopped [--target-dir <nuova-directory>]',
    '  node backup-cli.mjs restore-test <backup.sqlite>',
  ].join('\n');
}

function parseArguments(argv) {
  const [command, source, ...rest] = argv;
  const parsed = { command, source, stopped: false, targetDir: undefined };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--stopped') parsed.stopped = true;
    else if (value === '--target-dir' && rest[index + 1]) parsed.targetDir = rest[++index];
    else throw new Error(`Argomento non riconosciuto: ${value}\n${usage()}`);
  }
  return parsed;
}

export function runBackupCli(argv = process.argv.slice(2)) {
  assertSupportedNodeRuntime();
  const args = parseArguments(argv);
  if (!args.command || !args.source) throw new Error(usage());
  const source = path.resolve(args.source);
  if (args.command === 'verify') return { command: 'verify', ...verifyDatabase(source) };
  if (args.command === 'restore') return { command: 'restore', ...restoreBackup(source, { stopped: args.stopped, targetDir: args.targetDir }) };
  if (args.command === 'restore-test') return { command: 'restore-test', ...testRestore(source) };
  throw new Error(`Comando non riconosciuto: ${args.command}\n${usage()}`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    console.log(JSON.stringify(runBackupCli(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
