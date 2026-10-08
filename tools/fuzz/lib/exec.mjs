/**
 * Executors: how the fuzzer runs one step (a batch of ops) on a model.
 *
 * Contract: an executor is `{ label, run(xml, ops, { mode }) }`; `run`
 * resolves to
 *   { status: 'ok', xml, layout, ms }                    the step was written
 *   { status: 'refused', code, message, ms, readBack? }  a regular refusal
 *   { status: 'usage' | 'crash', code, message, ms, readBack? }
 * where `layout` is the `layout` block of the mutation result and `readBack`
 * (CLI only) is the file content after a failed run, to detect a write on
 * failure. Modes other than 'auto' are passed as `--layout <mode>`.
 *  - `cliExecutor({ bin, workDir, via })` spawns `node <bin>`: a one-op step
 *    with an equivalent command runs as that command (`via: 'commands'`,
 *    default), everything else as `apply <file> <ops.json>`; `via: 'apply'`
 *    always uses apply. Exit 1 = usage, 70 / signal / timeout = crash.
 *  - `libExecutor(api)` runs in-process: `api` = { Doc, parseOps, mutateDoc,
 *    CliError } from src/index.ts (tests) or dist/index.js (tool). A lossy
 *    import is refused like the CLI's loadDoc does (E_IMPORT_LOSSY); the ops go
 *    through parseOps like `bpmn apply`, then mutateDoc with dryRun, so nothing
 *    touches the disk. A CliError of category usage = usage, E_INTERNAL or any
 *    other exception = crash.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toArgv } from './generate.mjs';

const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

const tryJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

/** The `error` of the CLI's JSON error output (whole text or its last line). */
function parseError(text) {
  const e = (tryJson(text) ?? tryJson(text.trim().split('\n').pop() ?? ''))?.error;
  if (e?.code) return { code: e.code, message: String(e.message ?? '').slice(0, 300) };
  return { code: 'E_UNPARSED', message: text.trim().split('\n')[0]?.slice(0, 300) ?? '' };
}

function classify(res) {
  if (res.signal || res.status === null || res.status === 70) return 'crash';
  return res.status === 1 ? 'usage' : 'refused';
}

export function cliExecutor({ bin, workDir, via = 'commands', timeout = 300_000 }) {
  mkdirSync(workDir, { recursive: true });
  const file = join(workDir, 'work.bpmn');
  const opsFile = join(workDir, 'ops.json');
  const argvFor = (ops) => {
    const argv = via === 'commands' ? toArgv(ops) : undefined;
    if (argv) return argv.map((x) => (x === '%F' ? file : x));
    writeFileSync(opsFile, JSON.stringify(ops, null, 1));
    return ['apply', file, opsFile];
  };
  return {
    label: `cli:${via}`,
    async run(xml, ops, { mode }) {
      writeFileSync(file, xml);
      const argv = [bin, ...argvFor(ops), '--json', ...(mode === 'auto' ? [] : ['--layout', mode])];
      const t0 = process.hrtime.bigint();
      const res = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
      if (res.status === 0) {
        let layout;
        try { layout = JSON.parse(res.stdout).layout; } catch { /* layout stays undefined */ }
        return { status: 'ok', xml: readFileSync(file, 'utf8'), layout, ms: ms(t0) };
      }
      const err = parseError(res.stderr || res.stdout || '');
      if (res.signal) err.message = `signal ${res.signal} ${err.message}`;
      return { status: classify(res), ...err, ms: ms(t0), readBack: readFileSync(file, 'utf8') };
    },
  };
}

export function libExecutor(api, { label = 'lib' } = {}) {
  return {
    label,
    async run(xml, ops, { mode }) {
      const t0 = process.hrtime.bigint();
      try {
        const doc = await api.Doc.fromXml(xml);
        // the CLI's loadDoc guard (Doc.fromXml has none)
        if (doc.lossyImportWarnings?.length) return { status: 'refused', code: 'E_IMPORT_LOSSY', message: 'lossy import', ms: ms(t0) };
        const result = await api.mutateDoc(doc, api.parseOps(ops), { dryRun: true, layout: mode });
        return { status: 'ok', xml: result.xml, layout: result.layout, ms: ms(t0) };
      } catch (e) {
        if (!(e instanceof api.CliError)) return { status: 'crash', code: 'E_EXCEPTION', message: String(e?.stack ?? e).slice(0, 500), ms: ms(t0) };
        const status = e.code === 'E_INTERNAL' || e.category === 'internal' ? 'crash' : e.category === 'usage' ? 'usage' : 'refused';
        return { status, code: e.code, message: String(e.message).slice(0, 300), ms: ms(t0) };
      }
    },
  };
}
