/**
 * The benchmark's arms: which tool writes the result files, and how.
 *
 * Contract: `resolveArms(names, { layout })` -> one arm per name:
 *   new       this repository's CLI (bin/bpmn.js, so `npm run build` first)
 *   baseline  another bpmn-cli build, env BASELINE_BIN (path to its bin/bpmn.js)
 *   pr        the PR #218 tool (Miragon/design-iq `@bpmiq/bpmn-edit`), env
 *             BPMN_EDIT_MAIN (path to its src/main.ts; run with Node's type stripping)
 * `defaultArmNames()` = new, plus baseline / pr when their variable is set.
 * An arm is { name, key, path, kind, edit(file, opsFile, force) -> argv,
 * global: { variant: (file) -> argv }, error(stderr) -> {code, message},
 * info(stdout) -> {...}, forceable, features }. For bpmn-cli arms the options
 * are feature-detected from `--help`: `--layout <mode>` is passed only when the
 * build has it (key `<name>-<mode>`, else `<name>`), global variants are
 * `layout` (full redraw) plus `tidy` and `engine-auto` when supported. A run
 * refused with a FORCEABLE code is repeated with --force by the runner.
 * Throws when a requested arm's variable is not set.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './metrics.mjs';

export const FORCEABLE = new Set(['E_IMPORT_LOSSY', 'E_VALIDATION']);

const help = (bin, cmd) => spawnSync(process.execPath, [bin, cmd, '--help'], { encoding: 'utf8' }).stdout ?? '';

function cliFeatures(bin) {
  const layout = help(bin, 'layout');
  return { layoutModes: /--layout <mode>/.test(help(bin, 'apply')), tidy: /--tidy/.test(layout), engine: /--engine/.test(layout) };
}

function cliError(stderr) {
  const tryJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  const e = (tryJson(stderr) ?? tryJson(stderr.trim().split('\n').pop() ?? ''))?.error;
  return e?.code ? { code: e.code, message: String(e.message).slice(0, 200) } : { code: 'E_UNPARSED', message: stderr.trim().split('\n')[0]?.slice(0, 200) };
}

function cliInfo(stdout) {
  try {
    const j = JSON.parse(stdout);
    return { layout: j.layout ? { status: j.layout.status, mode: j.layout.mode, reason: j.layout.reason } : undefined, warnings: (j.warnings || []).length, validationWarnings: (j.validation?.warnings || []).length };
  } catch {
    return {};
  }
}

function cliArm(name, bin, layout) {
  if (!existsSync(bin)) throw new Error(`${name}: ${bin} does not exist${name === 'new' ? ' (npm run build?)' : ''}`);
  const f = cliFeatures(bin);
  const mode = f.layoutModes ? ['--layout', layout] : [];
  const global = { layout: (file) => [bin, 'layout', file, '--force', '--json'] };
  if (f.tidy) global.tidy = (file) => [bin, 'layout', file, '--tidy', '--force', '--json'];
  if (f.engine) global['engine-auto'] = (file) => [bin, 'layout', file, '--force', '--engine', 'auto', '--json'];
  return {
    name, key: f.layoutModes ? `${name}-${layout}` : name, path: bin, kind: 'cli', features: f, forceable: true, global,
    edit: (file, ops, force) => [bin, 'apply', file, ops, '--json', ...mode, ...(force ? ['--force'] : [])],
    error: cliError, info: cliInfo,
  };
}

function prArm(main) {
  if (!existsSync(main)) throw new Error(`pr: ${main} does not exist`);
  return {
    name: 'pr', key: 'pr', path: main, kind: 'pr', features: {}, forceable: false,
    edit: (file, ops) => [main, 'edit', file, '--ops', ops, '--json'],
    global: { layout: (f) => [main, 'layout', f, '--mode', 'layout', '--json'], tidy: (f) => [main, 'layout', f, '--mode', 'tidy', '--json'] },
    error: (stderr) => ({ code: 'E_PR', message: (stderr.trim().split('\n').find((l) => l.startsWith('[bpmn-edit]')) ?? stderr.trim().split('\n')[0] ?? '').slice(0, 200) }),
    info: (stdout) => { try { const j = JSON.parse(stdout); return { diagnostics: (j.diagnostics || j.result?.diagnostics || []).length, moved: (j.movedIds || []).length }; } catch { return {}; } },
  };
}

export function defaultArmNames(env = process.env) {
  return ['new', ...(env.BASELINE_BIN ? ['baseline'] : []), ...(env.BPMN_EDIT_MAIN ? ['pr'] : [])];
}

export function resolveArms(names, { layout = 'auto', env = process.env } = {}) {
  return names.map((name) => {
    if (name === 'new') return cliArm('new', join(ROOT, 'bin', 'bpmn.js'), layout);
    if (name === 'baseline') {
      if (!env.BASELINE_BIN) throw new Error('arm baseline needs env BASELINE_BIN=<path to another bpmn-cli bin/bpmn.js>');
      return cliArm('baseline', env.BASELINE_BIN, layout);
    }
    if (name === 'pr') {
      if (!env.BPMN_EDIT_MAIN) throw new Error('arm pr needs env BPMN_EDIT_MAIN=<path to the PR #218 tool src/main.ts>');
      return prArm(env.BPMN_EDIT_MAIN);
    }
    throw new Error(`unknown arm ${name} (new | baseline | pr)`);
  });
}
