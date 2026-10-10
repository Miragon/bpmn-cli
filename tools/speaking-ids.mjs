#!/usr/bin/env node
/**
 * Speaking ids on a corpus (aggregate counts only: a private corpus stays
 * private). Every probe is a dry run in-process (dist/index.js):
 *
 *   npm run build
 *   node tools/speaking-ids.mjs <dir|file>...                       # tools/scenarios when none
 *   node tools/speaking-ids.mjs --baseline <other>/dist/index.js <dir>
 *
 * Per file with a task that has one outgoing flow (the anchor) it adds a
 * named user task after it, an unnamed parallel gateway after it, and an
 * unnamed timer boundary event on it, and reports:
 *   - speaking: the new ids (created, and the new ids of renamed flows) that
 *     are no Camunda Modeler hash, no number and no glued number;
 *   - renamed: flows whose ids named their old ends (src/ops/flows.ts);
 *   - with --baseline: the new ids whose prefix equals the one the other
 *     build gives the same element (step 2 learned the prefixes);
 *   - collisions: two independent edits of the file at the first and the
 *     last anchor (a different named task plus an unnamed gateway; the same
 *     name; an unnamed gateway plus a boundary event) that share a new id
 *     (a merge of the two branches would have a duplicate id).
 */
import { readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let baseline;
const inputs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--baseline') baseline = args[++i];
  else inputs.push(args[i]);
}
if (!inputs.length) inputs.push(join(ROOT, 'tools', 'scenarios'));

const lib = await import(pathToFileURL(join(ROOT, 'dist', 'index.js')).href);
const base = baseline ? await import(pathToFileURL(resolve(baseline)).href) : undefined;

function files(p) {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p, { recursive: true })
    .map((f) => join(p, String(f)))
    .filter((f) => f.endsWith('.bpmn') && statSync(f).isFile());
}

const TASKS = ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'manualTask', 'businessRuleTask'];
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const prefixOf = (id) => /^([A-Za-z][A-Za-z0-9]*)_/.exec(id)?.[1] ?? /^([A-Za-z]+?)(?=[A-Z0-9])/.exec(id)?.[1] ?? '';
const kindKey = (k) => (k === 'sequenceFlow' ? 'flow' : TASKS.includes(k) ? 'task' : k.endsWith('Gateway') ? 'gateway' : k.includes('Event') ? 'event' : 'other');

/** A hash, a number or a glued number says nothing; a collision suffix after a speaking body is fine. */
function speaking(id) {
  const body = (/^[A-Za-z][A-Za-z0-9]*_(.+)$/.exec(id)?.[1] ?? id).replace(/_\d+$/, '');
  if (/^[01][0-9a-z]{6}$/.test(body) || /^\d+$/.test(body) || /^[A-Za-z]+\d+$/.test(id)) return false;
  return /[A-Za-z]{2}/.test(body);
}

/** The ids an edit brought into the file, in order: created ones and the new ids of renamed flows. */
function newIds(changes) {
  const out = changes.created.map((c) => ({ id: c.id, kind: c.kind }));
  for (const c of changes.changed) if (/renamed from /.test(c.detail ?? '')) out.push({ id: c.id, kind: c.kind, renamed: true });
  return out;
}

const run = async (m, xml, ops) => (await m.mutateDoc(await m.Doc.fromXml(xml), ops, { dryRun: true, force: true, layout: false, platform: 'none' })).changes;
const pct = (a, n) => `${a}/${n} (${n ? ((100 * a) / n).toFixed(1) : 0} %)`;

const st = { files: 0, probed: 0, failed: 0, kinds: new Map(), renamed: 0, pairs: { different: [0, 0, 0], sameName: [0, 0, 0], unnamed: [0, 0, 0] } };
for (const file of inputs.flatMap(files)) {
  const xml = readFileSync(file, 'utf8');
  st.files++;
  const outgoing = new Map();
  for (const m of xml.matchAll(/<(?:[A-Za-z0-9]+:)?sequenceFlow\b[^>]*>/g)) outgoing.set(attr(m[0], 'sourceRef'), (outgoing.get(attr(m[0], 'sourceRef')) ?? 0) + 1);
  const anchors = [...xml.matchAll(new RegExp(`<(?:[A-Za-z0-9]+:)?(${TASKS.join('|')})\\b[^>]*>`, 'g'))].map((m) => attr(m[0], 'id')).filter((id) => id && outgoing.get(id) === 1);
  if (!anchors.length) continue;
  st.probed++;
  const a = anchors[0];
  const probes = [[{ op: 'add', kind: 'userTask', name: 'Pack goods', after: a }], [{ op: 'add', kind: 'parallelGateway', after: a }], [{ op: 'add', kind: 'boundaryEvent:timer', on: a, timer: 'PT1H' }]];
  try {
    for (const ops of probes) {
      const mine = newIds(await run(lib, xml, ops));
      const theirs = base ? newIds(await run(base, xml, ops)).filter((x) => !x.renamed) : undefined;
      mine.forEach((x, i) => {
        const k = kindKey(x.kind);
        let s = st.kinds.get(k);
        if (!s) st.kinds.set(k, (s = { n: 0, speaking: 0, compared: 0, samePrefix: 0 }));
        s.n++;
        if (speaking(x.id)) s.speaking++;
        if (x.renamed) st.renamed++;
        const other = theirs && !x.renamed ? theirs[i] : undefined;
        if (other && other.kind === x.kind) {
          s.compared++;
          if (prefixOf(other.id) === prefixOf(x.id)) s.samePrefix++;
        }
      });
    }
  } catch {
    st.failed++;
    continue;
  }
  if (anchors.length < 2) continue;
  const l = anchors[0];
  const r = anchors[anchors.length - 1];
  const pairs = {
    different: [[{ op: 'add', kind: 'userTask', name: 'Left branch', after: l }, { op: 'add', kind: 'parallelGateway', after: l }], [{ op: 'add', kind: 'userTask', name: 'Right branch', after: r }, { op: 'add', kind: 'parallelGateway', after: r }]],
    sameName: [[{ op: 'add', kind: 'userTask', name: 'Review', after: l }], [{ op: 'add', kind: 'userTask', name: 'Review', after: r }]],
    unnamed: [[{ op: 'add', kind: 'exclusiveGateway', after: l }, { op: 'add', kind: 'boundaryEvent:timer', on: l, timer: 'PT1H' }], [{ op: 'add', kind: 'exclusiveGateway', after: r }, { op: 'add', kind: 'boundaryEvent:timer', on: r, timer: 'PT1H' }]],
  };
  for (const [name, [opsL, opsR]] of Object.entries(pairs)) {
    try {
      const L = newIds(await run(lib, xml, opsL)).map((x) => x.id);
      const R = newIds(await run(lib, xml, opsR)).map((x) => x.id);
      const shared = L.filter((id) => R.includes(id));
      st.pairs[name][0]++;
      if (shared.length) st.pairs[name][1]++;
      st.pairs[name][2] += shared.length;
    } catch {}
  }
}

let n = 0;
let sp = 0;
let cmp = 0;
let same = 0;
console.log(`files ${st.files}, probed ${st.probed}, failed ${st.failed}`);
for (const [k, s] of st.kinds) {
  n += s.n;
  sp += s.speaking;
  cmp += s.compared;
  same += s.samePrefix;
  console.log(`  ${k.padEnd(8)} speaking ${pct(s.speaking, s.n)}${base ? `, prefix as the baseline ${pct(s.samePrefix, s.compared)}` : ''}`);
}
console.log(`new ids speaking ${pct(sp, n)}${base ? `; prefix as the baseline ${pct(same, cmp)}` : ''}; renamed flows ${st.renamed}`);
for (const [name, [pairs, colliding, shared]] of Object.entries(st.pairs)) console.log(`two edits, ${name.padEnd(9)} ${pct(colliding, pairs)} share a new id (${shared} id(s))`);
