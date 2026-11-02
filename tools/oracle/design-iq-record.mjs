import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CORPUS_DIR, MAIN_ROOT, ORACLE_DIR, WORK_DIR } from './lib/paths.mjs';
import { ensureMainBuilt } from './lib/main-build.mjs';
import { ORDER_TO_CASH, WRITTEN_BUILD, WRITTEN_CALLS } from './design-iq-written.mjs';

const SOURCE = process.argv[2] ?? join(homedir(), 'orca/miragon/design-iq');
const COPY = join(WORK_DIR, 'design-iq');
const LOG = join(WORK_DIR, 'design-iq-calls.jsonl');
const CORPUS = join(CORPUS_DIR, 'design-iq');
const LIVE_HOST = join(COPY, 'apps/live-host');
const TESTS = ['test/bpmn-edit.test.ts', 'test/bpmn-edit-tools.test.ts'];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function prepareCopy() {
  const commit = git(SOURCE, 'ls-remote', 'origin', 'HEAD').split(/\s/)[0];
  rmSync(COPY, { recursive: true, force: true });
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', SOURCE, COPY]);
  git(COPY, 'fetch', '--quiet', git(SOURCE, 'remote', 'get-url', 'origin'), commit);
  git(COPY, 'checkout', '--quiet', '--detach', commit);
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--filter', '@designiq/live-host...', '--ignore-scripts'], { cwd: COPY, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1', HUSKY: '0' } });
  return commit;
}

function installShim() {
  const installed = execFileSync('node', ['-p', 'require("node:fs").realpathSync("node_modules/@miragon/bpmn-cli")'], { cwd: LIVE_HOST, encoding: 'utf8' }).trim();
  const entry = join(installed, 'dist', 'index.js');
  rmSync(entry);
  writeFileSync(entry, `export * from ${JSON.stringify(join(ORACLE_DIR, 'design-iq-shim.mjs'))};\n`);
  return entry;
}

function runDesignIqTests() {
  const { stdout, stderr } = spawnSync('node', ['--test', '--test-concurrency=1', ...TESTS], { cwd: LIVE_HOST, encoding: 'utf8', env: { ...process.env, DESIGN_IQ_LOG: LOG } });
  const count = (word) => Number(new RegExp(`^ℹ ${word} (\\d+)$`, 'm').exec(stdout)?.[1] ?? -1);
  const failures = [...stdout.matchAll(/^✖ (.+?)(?: \([\d.]+ms\))?$/gm)].map((match) => match[1]);
  if (count('tests') < 0) {
    throw new Error(`design-iq's tests did not run:\n${stdout}\n${stderr}`);
  }
  return { tests: count('tests'), pass: count('pass'), fail: count('fail'), failures: [...new Set(failures)] };
}

async function runWrittenCalls(entry) {
  process.env.DESIGN_IQ_LOG = LOG;
  const shim = await import(entry);
  const orderToCash = readFileSync(join(COPY, ORDER_TO_CASH), 'utf8');
  for (const { row, function: name, xml, args } of WRITTEN_CALLS) {
    process.env.DESIGN_IQ_WRITTEN_ROW = row;
    await Promise.resolve(shim[name](xml ?? orderToCash, ...args)).catch(() => {});
  }
  process.env.DESIGN_IQ_WRITTEN_ROW = WRITTEN_BUILD.row;
  let { xml: built } = await shim.newXml({ id: 'Process_1', name: 'Built in steps' });
  for (const step of WRITTEN_BUILD.steps) {
    ({ xml: built } = await shim.applyToXml(built, step));
  }
  delete process.env.DESIGN_IQ_WRITTEN_ROW;
  return shim;
}

function stored(xml) {
  const name = `${createHash('sha256').update(xml).digest('hex').slice(0, 16)}.bpmn`;
  writeFileSync(join(CORPUS, 'files', name), xml);
  return `files/${name}`;
}

function kept(name, answer) {
  return name === 'kindsJson' ? { kinds: answer.kinds, triggers: answer.triggers } : answer;
}

function callRecord({ type: _type, validators, args, answer, ...call }) {
  const isDocument = (text) => typeof text === 'string' && text.startsWith('<');
  const [first, ...rest] = args;
  return {
    ...call,
    args: [isDocument(first) ? { file: stored(first) } : first, ...rest],
    ...(isDocument(answer?.xml) ? { answer: { ...answer, xml: { file: stored(answer.xml) } } } : { answer: kept(call.function, answer) }),
    validators: validators.map(({ xml: _xml, ...found }) => found),
  };
}

function uniqueCalls(records) {
  const unique = new Map();
  for (const record of records) {
    const { site: _site, ...call } = record;
    const key = JSON.stringify(call);
    const seen = unique.get(key);
    unique.set(key, seen ? { ...seen, count: seen.count + 1, sites: [...new Set([...seen.sites, record.site])] } : { ...call, count: 1, sites: [record.site].filter(Boolean) });
  }
  return [...unique.values()];
}

function valueAt(schema, path) {
  return path.reduce((value, key) => value?.[key], schema);
}

function schemaReads(entries, schema) {
  const reads = new Map();
  for (const { type, path } of entries) {
    const value = valueAt(schema, path);
    const read = type === 'keys' ? { keys: Object.keys(value) } : { value: typeof value === 'object' ? undefined : value };
    reads.set(JSON.stringify([type, path]), { read: type, path, ...read });
  }
  return [...reads.values()];
}

const { commit: mainCommit } = ensureMainBuilt({ log: console.log });
const commit = prepareCopy();
const entry = installShim();
rmSync(LOG, { force: true });
const tests = runDesignIqTests();
const shim = await runWrittenCalls(entry);

rmSync(CORPUS, { recursive: true, force: true });
mkdirSync(join(CORPUS, 'files'), { recursive: true });
const entries = readFileSync(LOG, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
const calls = uniqueCalls(entries.filter(({ type }) => type === 'call').map(callRecord));
const reads = schemaReads(entries.filter(({ type }) => type !== 'call'), JSON.parse(JSON.stringify(shim.OPS_SCHEMA)));
const { FORMAT_OP_NAMES } = await import(join(MAIN_ROOT, 'dist', 'index.js'));

writeFileSync(join(CORPUS, 'COMMIT'), `${commit}\n`);
writeFileSync(join(CORPUS, 'calls.json'), `${JSON.stringify({ main: mainCommit, tests, calls }, null, 1)}\n`);
writeFileSync(join(CORPUS, 'schema-reads.json'), `${JSON.stringify({ main: mainCommit, formatOperations: FORMAT_OP_NAMES, reads }, null, 1)}\n`);
console.log(`design-iq ${commit}: ${tests.pass} of ${tests.tests} tests pass, ${calls.length} calls, ${reads.length} schema reads`);
for (const failure of tests.failures) {
  console.log(`failed: ${failure}`);
}
