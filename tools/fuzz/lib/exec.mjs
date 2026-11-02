import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toArgv } from './generate.mjs';

const USAGE_EXIT = 1;
const INTERNAL_EXIT = 70;
const INTERNAL_CATEGORY = 'internal';
const CRASH_CODES = new Set(['E_INTERNAL']);

const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseError(text) {
  const error = (tryJson(text) ?? tryJson(text.trim().split('\n').pop() ?? ''))?.error;
  if (error?.code) {
    return { code: error.code, message: String(error.message ?? '').slice(0, 300) };
  }
  return { code: 'E_UNPARSED', message: text.trim().split('\n')[0]?.slice(0, 300) ?? '' };
}

function classify(res) {
  if (res.signal || res.status === null || res.status === INTERNAL_EXIT) {
    return 'crash';
  }
  return res.status === USAGE_EXIT ? 'usage' : 'refused';
}

export function cliExecutor({ bin, workDir, via = 'commands', timeout = 300_000, env = process.env }) {
  mkdirSync(workDir, { recursive: true });
  const file = join(workDir, 'work.bpmn');
  const opsFile = join(workDir, 'ops.json');
  const argvFor = (ops) => {
    const argv = via === 'commands' ? toArgv(ops) : undefined;
    if (argv) {
      return argv.map((arg) => (arg === '%F' ? file : arg));
    }
    writeFileSync(opsFile, JSON.stringify(ops, null, 1));
    return ['apply', file, opsFile];
  };
  return {
    label: `cli:${via}`,
    run(xml, ops) {
      writeFileSync(file, xml);
      const t0 = process.hrtime.bigint();
      const res = spawnSync(process.execPath, [bin, ...argvFor(ops), '--json'], { encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, env });
      if (res.status === 0) {
        return { status: 'ok', xml: readFileSync(file, 'utf8'), result: tryJson(res.stdout), ms: ms(t0) };
      }
      const err = parseError(res.stderr || res.stdout || '');
      if (res.signal) {
        err.message = `signal ${res.signal} ${err.message}`;
      }
      return { status: classify(res), ...err, ms: ms(t0), readBack: readFileSync(file, 'utf8') };
    },
  };
}

export function libExecutor(api, { label = 'lib' } = {}) {
  return {
    label,
    async run(xml, ops) {
      const t0 = process.hrtime.bigint();
      try {
        const result = await api.applyToXml(xml, ops);
        return { status: 'ok', xml: result.xml, result, ms: ms(t0) };
      } catch (error) {
        if (!(error instanceof api.BpmnError)) {
          return { status: 'crash', code: 'E_EXCEPTION', message: String(error?.stack ?? error).slice(0, 500), ms: ms(t0) };
        }
        const status = CRASH_CODES.has(error.code) || error.category === INTERNAL_CATEGORY ? 'crash' : error.category === 'usage' ? 'usage' : 'refused';
        return { status, code: error.code, message: String(error.message).slice(0, 300), ms: ms(t0) };
      }
    },
  };
}
