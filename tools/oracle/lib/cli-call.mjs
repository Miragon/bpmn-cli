import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCorpus } from './corpus.mjs';
import { WORK_DIR } from './paths.mjs';

const RUNS = join(WORK_DIR, 'cli-runs');
const MODEL = 'model.bpmn';
const OUTPUT = 'out.bpmn';
const REPORTS_AS_JSON = new Set(['new', 'show', 'find', 'diagram', 'conventions', 'validate', 'add', 'connect', 'set', 'remove', 'retype', 'move', 'order', 'apply', 'ext', 'layout', 'tidy', 'compact', 'place', 'color', 'label', 'route', 'space', 'render']);
const VERDICT = /^(?:valid|\d+ error\(s\)), \d+ warning\(s\)/m;
const REFUSED_AT_DEPLOY = /- (\d+) refused at deploy/;

function spawned(binary, args, cwd) {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [binary, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    const [stdout, stderr] = [[], []];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', failed);
    child.on('close', (exit) => done({ exit, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
  });
}

function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function findingRows(report) {
  const row = (finding, severity) => ({ code: finding.code, severity, element: finding.element ?? '-' });
  if (report.findings) {
    return report.findings.map((finding) => row(finding, finding.severity ?? 'warning'));
  }
  return [...report.errors.map((finding) => row(finding, 'error')), ...report.warnings.map((finding) => row(finding, finding.severity ?? 'warning'))];
}

function changesOf(report) {
  return { created: report.created, changed: report.changed, removed: report.removed };
}

function reportFacts(words, report) {
  if (!report) {
    return {};
  }
  if (words[0] === 'validate') {
    return { rows: findingRows(report) };
  }
  return report.created && words[0] !== 'new' ? changesOf(report) : {};
}

function textFacts({ stdout }) {
  return { verdict: VERDICT.exec(stdout)?.[0], refusedAtDeploy: REFUSED_AT_DEPLOY.exec(stdout)?.[1] };
}

function writtenFile(folder) {
  const written = [OUTPUT, MODEL].map((name) => join(folder, name)).find(existsSync);
  return written && readFileSync(written, 'utf8');
}

function inFolder(folder, { model, ops }) {
  mkdirSync(folder, { recursive: true });
  if (model) {
    writeFileSync(join(folder, MODEL), readCorpus(model));
  }
  if (ops) {
    writeFileSync(join(folder, 'ops.json'), JSON.stringify(ops));
  }
}

async function facts(binary, words, cwd) {
  const asJson = REPORTS_AS_JSON.has(words[0]) ? [...words, '--json'] : words;
  const run = await spawned(binary, asJson, cwd);
  const report = parsed(run.stdout);
  const code = parsed(run.stderr)?.error?.code ?? /^error (\S+):/m.exec(run.stderr)?.[1];
  return { exit: run.exit, ...(code ? { code } : {}), ...reportFacts(words, report) };
}

export async function callCli(binary, call, words) {
  mkdirSync(RUNS, { recursive: true });
  const folder = mkdtempSync(join(RUNS, 'call-'));
  try {
    inFolder(folder, call);
    const answer = await facts(binary, words, folder);
    const xml = writtenFile(folder);
    const text = words[0] === 'validate' ? textFacts(await spawned(binary, words, folder)) : {};
    return { ...answer, ...text, ...(xml ? { xml } : {}) };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export async function validateInProject(binary, folder, file) {
  const words = ['validate', file];
  return { ...(await facts(binary, words, folder)), ...textFacts(await spawned(binary, words, folder)) };
}
