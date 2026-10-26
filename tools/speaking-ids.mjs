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
 *   - renamed: flows whose ids named their old ends (src/ops/flows/FlowIdFollower.ts);
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
for (let argIndex = 0; argIndex < args.length; argIndex++) {
  if (args[argIndex] === '--baseline') baseline = args[++argIndex];
  else inputs.push(args[argIndex]);
}
if (!inputs.length) inputs.push(join(ROOT, 'tools', 'scenarios'));

const lib = await import(pathToFileURL(join(ROOT, 'dist', 'index.js')).href);
const base = baseline ? await import(pathToFileURL(resolve(baseline)).href) : undefined;

function files(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { recursive: true })
    .map((entry) => join(path, String(entry)))
    .filter((candidate) => candidate.endsWith('.bpmn') && statSync(candidate).isFile());
}

const TASKS = ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'manualTask', 'businessRuleTask'];
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const prefixOf = (id) => /^([A-Za-z][A-Za-z0-9]*)_/.exec(id)?.[1] ?? /^([A-Za-z]+?)(?=[A-Z0-9])/.exec(id)?.[1] ?? '';
const kindKey = (kind) => (kind === 'sequenceFlow' ? 'flow' : TASKS.includes(kind) ? 'task' : kind.endsWith('Gateway') ? 'gateway' : kind.includes('Event') ? 'event' : 'other');

/** A hash, a number or a glued number says nothing; a collision suffix after a speaking body is fine. */
function speaking(id) {
  const body = (/^[A-Za-z][A-Za-z0-9]*_(.+)$/.exec(id)?.[1] ?? id).replace(/_\d+$/, '');
  if (/^[01][0-9a-z]{6}$/.test(body) || /^\d+$/.test(body) || /^[A-Za-z]+\d+$/.test(id)) return false;
  return /[A-Za-z]{2}/.test(body);
}

/** The ids an edit brought into the file, in order: created ones and the new ids of renamed flows. */
function newIds(changes) {
  const out = changes.created.map((change) => ({ id: change.id, kind: change.kind }));
  for (const change of changes.changed) if (/renamed from /.test(change.detail ?? '')) out.push({ id: change.id, kind: change.kind, renamed: true });
  return out;
}

const run = async (cliModule, xml, ops) => (await cliModule.mutateDoc(await cliModule.Doc.fromXml(xml), ops, { dryRun: true, force: true, layout: false, platform: 'none' })).changes;
const pct = (count, total) => `${count}/${total} (${total ? ((100 * count) / total).toFixed(1) : 0} %)`;

const st = { files: 0, probed: 0, failed: 0, kinds: new Map(), renamed: 0, pairs: { different: [0, 0, 0], sameName: [0, 0, 0], unnamed: [0, 0, 0] } };
for (const file of inputs.flatMap(files)) {
  const xml = readFileSync(file, 'utf8');
  st.files++;
  const outgoing = new Map();
  for (const match of xml.matchAll(/<(?:[A-Za-z0-9]+:)?sequenceFlow\b[^>]*>/g)) outgoing.set(attr(match[0], 'sourceRef'), (outgoing.get(attr(match[0], 'sourceRef')) ?? 0) + 1);
  const anchors = [...xml.matchAll(new RegExp(`<(?:[A-Za-z0-9]+:)?(${TASKS.join('|')})\\b[^>]*>`, 'g'))].map((match) => attr(match[0], 'id')).filter((id) => id && outgoing.get(id) === 1);
  if (!anchors.length) continue;
  st.probed++;
  const anchor = anchors[0];
  const probes = [[{ op: 'add', kind: 'userTask', name: 'Pack goods', after: anchor }], [{ op: 'add', kind: 'parallelGateway', after: anchor }], [{ op: 'add', kind: 'boundaryEvent:timer', on: anchor, timer: 'PT1H' }]];
  try {
    for (const ops of probes) {
      const mine = newIds(await run(lib, xml, ops));
      const theirs = base ? newIds(await run(base, xml, ops)).filter((theirId) => !theirId.renamed) : undefined;
      mine.forEach((newId, idIndex) => {
        const kindName = kindKey(newId.kind);
        let kindStats = st.kinds.get(kindName);
        if (!kindStats) st.kinds.set(kindName, (kindStats = { n: 0, speaking: 0, compared: 0, samePrefix: 0 }));
        kindStats.n++;
        if (speaking(newId.id)) kindStats.speaking++;
        if (newId.renamed) st.renamed++;
        const other = theirs && !newId.renamed ? theirs[idIndex] : undefined;
        if (other && other.kind === newId.kind) {
          kindStats.compared++;
          if (prefixOf(other.id) === prefixOf(newId.id)) kindStats.samePrefix++;
        }
      });
    }
  } catch {
    st.failed++;
    continue;
  }
  if (anchors.length < 2) continue;
  const leftAnchor = anchors[0];
  const rightAnchor = anchors[anchors.length - 1];
  const pairs = {
    different: [[{ op: 'add', kind: 'userTask', name: 'Left branch', after: leftAnchor }, { op: 'add', kind: 'parallelGateway', after: leftAnchor }], [{ op: 'add', kind: 'userTask', name: 'Right branch', after: rightAnchor }, { op: 'add', kind: 'parallelGateway', after: rightAnchor }]],
    sameName: [[{ op: 'add', kind: 'userTask', name: 'Review', after: leftAnchor }], [{ op: 'add', kind: 'userTask', name: 'Review', after: rightAnchor }]],
    unnamed: [[{ op: 'add', kind: 'exclusiveGateway', after: leftAnchor }, { op: 'add', kind: 'boundaryEvent:timer', on: leftAnchor, timer: 'PT1H' }], [{ op: 'add', kind: 'exclusiveGateway', after: rightAnchor }, { op: 'add', kind: 'boundaryEvent:timer', on: rightAnchor, timer: 'PT1H' }]],
  };
  for (const [name, [opsL, opsR]] of Object.entries(pairs)) {
    try {
      const leftIds = newIds(await run(lib, xml, opsL)).map((newId) => newId.id);
      const rightIds = newIds(await run(lib, xml, opsR)).map((newId) => newId.id);
      const shared = leftIds.filter((id) => rightIds.includes(id));
      st.pairs[name][0]++;
      if (shared.length) st.pairs[name][1]++;
      st.pairs[name][2] += shared.length;
    } catch {}
  }
}

let total = 0;
let sp = 0;
let cmp = 0;
let same = 0;
console.log(`files ${st.files}, probed ${st.probed}, failed ${st.failed}`);
for (const [kindName, kindStats] of st.kinds) {
  total += kindStats.n;
  sp += kindStats.speaking;
  cmp += kindStats.compared;
  same += kindStats.samePrefix;
  console.log(`  ${kindName.padEnd(8)} speaking ${pct(kindStats.speaking, kindStats.n)}${base ? `, prefix as the baseline ${pct(kindStats.samePrefix, kindStats.compared)}` : ''}`);
}
console.log(`new ids speaking ${pct(sp, total)}${base ? `; prefix as the baseline ${pct(same, cmp)}` : ''}; renamed flows ${st.renamed}`);
for (const [name, [pairs, colliding, shared]] of Object.entries(st.pairs)) console.log(`two edits, ${name.padEnd(9)} ${pct(colliding, pairs)} share a new id (${shared} id(s))`);
