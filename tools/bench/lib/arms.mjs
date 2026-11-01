import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MAIN_ROOT } from '../../oracle/lib/paths.mjs';
import { ROOT } from '../../fuzz/lib/setup.mjs';

export const FORCEABLE = new Set(['E_IMPORT_LOSSY', 'E_VALIDATION']);

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function cliError(stderr) {
  const reportedError = (tryJson(stderr) ?? tryJson(stderr.trim().split('\n').pop() ?? ''))?.error;
  return reportedError?.code ? { code: reportedError.code, message: String(reportedError.message).slice(0, 200) } : { code: 'E_UNPARSED', message: stderr.trim().split('\n')[0]?.slice(0, 200) };
}

function newArm() {
  const bin = join(ROOT, 'bin', 'bpmn.js');
  return {
    key: 'new', bin, cliOf: (spec, edit) => spec.edits[edit].cli,
    global: { layout: (file) => [bin, 'layout', file, '--force', '--json'], tidy: (file) => [bin, 'tidy', file, '--force', '--json'] },
    edit: (file, ops, force) => [bin, 'apply', file, ops, '--json', ...(force ? ['--force'] : [])],
  };
}

function baselineArm() {
  const bin = join(MAIN_ROOT, 'bin', 'bpmn.js');
  const noLint = ['--no-lint-config'];
  return {
    key: 'baseline', bin, cliOf: (spec, edit) => spec.mainEdits[edit].cli,
    global: { layout: (file) => [bin, 'layout', file, '--force', '--json', ...noLint], tidy: (file) => [bin, 'layout', file, '--tidy', '--force', '--json', ...noLint] },
    edit: (file, ops, force) => [bin, 'apply', file, ops, '--json', '--layout', 'auto', ...noLint, ...(force ? ['--force'] : [])],
  };
}

const ARMS = { new: newArm, baseline: baselineArm };

export function resolveArms(names) {
  return names.map((name) => {
    if (!ARMS[name]) {
      throw new Error(`unknown arm ${name} (new | baseline)`);
    }
    const arm = ARMS[name]();
    if (!existsSync(arm.bin) || spawnSync(process.execPath, [arm.bin, '--version']).status !== 0) {
      throw new Error(`${name}: ${arm.bin} does not run (npm run build?)`);
    }
    return { ...arm, error: cliError };
  });
}
