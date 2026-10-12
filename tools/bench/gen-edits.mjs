#!/usr/bin/env node
/**
 * Deterministic edit generator of the benchmark.
 *
 *   node tools/bench/gen-edits.mjs <file.bpmn>...     # prints the edit specs (for checking a model)
 *
 * Contract: `generate(xml)` picks the edit targets of one model (in the order
 * E3, E1, E2, E4, E5, E6, each avoiding the targets picked before, so that E7 =
 * all applicable edits in sequence never touches a removed element) and returns
 * { pathLength, flowNodes, leafLanes, edits } with per edit
 *   { applicable, reason?, target, onPath, cli: <bpmn apply ops>, pr: <PR #218 tool ops>,
 *     expect: <semantic check for measure.checkEdit>, touched: ids whose displacement is intended, note? }
 *  E1 userTask spliced after a non-gateway node with exactly one outgoing flow (nearest the middle of the longest
 *     start->end path); E2 new branch userTask + endEvent at an exclusive gateway with >= 2 outgoing flows;
 *  E3 remove a task with 1 in / 1 out (bridged); E4 boundary path on a task (bpmn-cli: timer boundary + end event,
 *     the PR tool: error boundary with end, it has no timer boundary op); E5 task to the neighbouring leaf lane
 *     (>= 2 leaf lanes); E6 rename a task to a long name; E7 all applicable edits of E1-E6 in sequence.
 *  E8 (one batch) a decision spliced into a branch of an existing exclusive split: a userTask into the
 *     gateway's outgoing flow to a non-gateway node X with one incoming flow, an exclusive gateway after it
 *     before X, and a new "no" branch (sendTask + endEvent) at that gateway; E9 E8 plus a non-interrupting timer
 *     boundary path (sendTask + endEvent) on the new task, in the same batch (the plugin eval's request).
 *     E8 / E9 are bpmn-cli batches only (no PR tool ops), not part of E7, and picked independently of E1-E6;
 *     bench --compare holds their runs adding crossings / backward flows to tools/bench/soft-budget.json.
 * New ids are fixed (Activity_BenchE1, ...). Same input, same output; no I/O in generate().
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readModel } from './lib/model.mjs';
import { longestPath, pickNearMedian, isTaskish, isGateway, successorOf, predecessorOf, boundariesOf } from './lib/graph.mjs';

export const LONG_NAME = 'Check all submitted documents thoroughly and inform the responsible clerk about the outcome';
export const EDITS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'];
/** batch edits run on their own (not part of E7) */
export const BATCH_EDITS = ['E8', 'E9'];
export const ALL_EDITS = [...EDITS, 'E7', ...BATCH_EDITS];

const na = (reason) => ({ applicable: false, reason });

function e3(m, path, avoid) {
  const ok = (n) => isTaskish(n) && n.incoming.length === 1 && n.outgoing.length === 1 && !boundariesOf(m, n.id).length && m.shapes.has(n.id) && !avoid.has(n.id) && predecessorOf(m, n) !== successorOf(m, n);
  const p = pickNearMedian(m, path, ok);
  if (!p) return na('no task with exactly 1 in / 1 out and no boundary event');
  const n = m.nodes.get(p.id);
  const pred = predecessorOf(m, n), succ = successorOf(m, n);
  return {
    applicable: true, target: p.id, onPath: p.onPath,
    cli: [{ op: 'remove', ids: [p.id] }],
    pr: [{ op: 'remove', id: p.id, reconnect: true }],
    expect: { kind: 'removed', id: p.id, pred, succ },
    touched: [], avoid: [p.id, pred, succ],
  };
}

function e1(m, path, avoid) {
  const ok = (n) => !isGateway(n) && n.type !== 'BoundaryEvent' && n.outgoing.length === 1 && m.shapes.has(n.id) && !avoid.has(n.id) && !avoid.has(successorOf(m, n));
  const p = pickNearMedian(m, path, ok);
  if (!p) return na('no non-gateway node with exactly one outgoing flow');
  const n = m.nodes.get(p.id);
  const id = 'Activity_BenchE1';
  return {
    applicable: true, target: p.id, onPath: p.onPath,
    cli: [{ op: 'add', kind: 'userTask', id, name: 'Bench inserted task', after: p.id }],
    pr: [{ op: 'insertAfter', after: p.id, element: { type: 'userTask', id, name: 'Bench inserted task' } }],
    expect: { kind: 'inserted', id, type: 'bpmn:UserTask', pred: p.id, succ: successorOf(m, n) },
    touched: [], avoid: [p.id],
  };
}

function e2(m, path, avoid) {
  const ok = (n) => n.type === 'ExclusiveGateway' && n.outgoing.length >= 2 && m.shapes.has(n.id) && !avoid.has(n.id);
  const p = pickNearMedian(m, path, ok);
  if (!p) return na('no exclusive gateway with >= 2 outgoing flows');
  const task = 'Activity_BenchE2', end = 'Event_BenchE2End';
  return {
    applicable: true, target: p.id, onPath: p.onPath,
    cli: [
      { op: 'add', kind: 'userTask', id: task, name: 'Bench branch task', after: p.id, flowName: 'bench', condition: '${bench}' },
      { op: 'add', kind: 'endEvent', id: end, name: 'Bench branch end', after: task },
    ],
    pr: [
      { op: 'insertAfter', after: p.id, branch: true, name: 'bench', condition: '${bench}', element: { type: 'userTask', id: task, name: 'Bench branch task', row: 'below' } },
      { op: 'insertAfter', after: task, element: { type: 'endEvent', id: end, name: 'Bench branch end' } },
    ],
    expect: { kind: 'branch', gateway: p.id, task, end },
    touched: [], avoid: [p.id],
  };
}

function e4(m, path, avoid) {
  const base = (n) => isTaskish(n) && m.shapes.has(n.id) && !avoid.has(n.id);
  const p = pickNearMedian(m, path, (n) => base(n) && !boundariesOf(m, n.id).length) ?? pickNearMedian(m, path, base);
  if (!p) return na('no task');
  const ev = 'Event_BenchE4', end = 'Event_BenchE4End';
  return {
    applicable: true, target: p.id, onPath: p.onPath,
    cli: [
      { op: 'add', kind: 'boundaryEvent:timer', id: ev, name: 'Bench timeout', on: p.id, timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', id: end, name: 'Bench timed out', after: ev },
    ],
    pr: [{ op: 'addErrorBoundary', attachTo: p.id, id: ev, name: 'Bench timeout', errorCode: 'BENCH_TIMEOUT', end: { id: end, name: 'Bench timed out' } }],
    expect: { kind: 'boundary', host: p.id, event: ev, end },
    note: 'trigger differs: bpmn-cli timer boundary, bpmn-edit error boundary (no timer op)',
    touched: [], avoid: [p.id],
  };
}

function e5(m, path, avoid) {
  const leaves = (processId) => [...m.lanes.values()].filter((l) => l.leaf && l.processId === processId);
  const ok = (n) => isTaskish(n) && n.laneId && m.lanes.get(n.laneId)?.leaf && leaves(n.processId).length >= 2 && m.shapes.has(n.id) && !avoid.has(n.id);
  if (![...m.nodes.values()].some((n) => n.laneId && leaves(n.processId).length >= 2)) return na('fewer than 2 lanes');
  const p = pickNearMedian(m, path, ok);
  if (!p) return na('no task in a lane');
  const n = m.nodes.get(p.id);
  const list = leaves(n.processId);
  const i = list.findIndex((l) => l.id === n.laneId);
  const to = (list[i + 1] ?? list[i - 1]).id;
  return {
    applicable: true, target: p.id, onPath: p.onPath,
    cli: [{ op: 'set', id: p.id, values: { lane: to } }],
    pr: [{ op: 'moveToLane', id: p.id, lane: to }],
    expect: { kind: 'lane', id: p.id, from: n.laneId, to },
    touched: [p.id, ...boundariesOf(m, p.id)], avoid: [p.id],
  };
}

function e6(m, path, avoid) {
  const p = pickNearMedian(m, path, (n) => isTaskish(n) && m.shapes.has(n.id) && !avoid.has(n.id))
    ?? pickNearMedian(m, path, (n) => isTaskish(n) && m.shapes.has(n.id) && !avoid.has(`removed:${n.id}`));
  if (!p) return na('no task');
  return {
    applicable: true, target: p.id, onPath: p.onPath,
    cli: [{ op: 'set', id: p.id, values: { name: LONG_NAME } }],
    pr: [{ op: 'rename', id: p.id, name: LONG_NAME }],
    expect: { kind: 'name', id: p.id, name: LONG_NAME },
    touched: [], avoid: [p.id],
  };
}

/** E8 / E9: a decision spliced into one branch of an existing exclusive split (E9: plus a timer reminder path). */
function e8(m, path, timer) {
  const branchOf = (g) => g.outgoing.map((f) => m.flows.get(f)).find((f) => {
    const x = f && m.nodes.get(f.targetId);
    return x && m.shapes.has(x.id) && x.scope === g.scope && !isGateway(x) && x.type !== 'BoundaryEvent' && x.incoming.length === 1;
  });
  const p = pickNearMedian(m, path, (n) => n.type === 'ExclusiveGateway' && n.outgoing.length >= 2 && m.shapes.has(n.id) && !!branchOf(n));
  if (!p) return na('no exclusive split with a branch into a non-gateway node with one incoming flow');
  const f = branchOf(m.nodes.get(p.id));
  const task = 'Activity_BenchE8', gw = 'Gateway_BenchE8', no = 'Activity_BenchE8No', noEnd = 'Event_BenchE8NoEnd';
  const ev = 'Event_BenchE9Timer', remind = 'Activity_BenchE9Remind', remindEnd = 'Event_BenchE9Reminded';
  const cli = [
    { op: 'add', kind: 'userTask', id: task, name: 'Bench approval', flow: f.id },
    { op: 'add', kind: 'exclusiveGateway', id: gw, name: 'Bench approved?', after: task, before: f.targetId },
    { op: 'add', kind: 'sendTask', id: no, name: 'Bench rejection', after: gw, flowName: 'no' },
    { op: 'add', kind: 'endEvent', id: noEnd, name: 'Bench rejected', after: no },
  ];
  if (timer) {
    cli.push(
      { op: 'add', kind: 'boundaryEvent:timer', id: ev, name: 'Bench 3 days', on: task, timer: 'P3D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', id: remind, name: 'Bench reminder', after: ev },
      { op: 'add', kind: 'endEvent', id: remindEnd, name: 'Bench reminded', after: remind },
    );
  }
  return {
    applicable: true, target: p.id, onPath: p.onPath, cli, pr: null,
    expect: { kind: 'decision', gateway: p.id, task, decision: gw, succ: f.targetId, no, noEnd, ...(timer ? { timer: { event: ev, task: remind, end: remindEnd } } : {}) },
    touched: [], avoid: [],
  };
}

export async function generate(xml) {
  const m = await readModel(xml);
  const path = longestPath(m);
  const avoid = new Set();
  const out = {};
  for (const [key, fn] of [['E3', e3], ['E1', e1], ['E2', e2], ['E4', e4], ['E5', e5], ['E6', e6]]) {
    const r = fn(m, path, avoid);
    if (r.applicable) {
      for (const id of r.avoid) if (id) avoid.add(id);
      if (key === 'E3') avoid.add(`removed:${r.target}`);
    }
    delete r.avoid;
    out[key] = r;
  }
  const edits = Object.fromEntries(EDITS.map((k) => [k, out[k]]));
  edits.E7 = { applicable: EDITS.filter((k) => out[k].applicable).length >= 2, steps: EDITS.filter((k) => out[k].applicable) };
  for (const [key, timer] of [['E8', false], ['E9', true]]) {
    const r = e8(m, path, timer);
    delete r.avoid;
    edits[key] = r;
  }
  return { pathLength: path.length, flowNodes: m.nodes.size, leafLanes: [...m.lanes.values()].filter((l) => l.leaf).length, edits };
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node tools/bench/gen-edits.mjs <file.bpmn>...');
    process.exit(2);
  }
  for (const f of files) console.log(JSON.stringify({ file: f, ...(await generate(readFileSync(f, 'utf8'))) }, null, 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
