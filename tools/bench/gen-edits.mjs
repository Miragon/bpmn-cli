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

function e3(model, path, avoid) {
  const ok = (node) => isTaskish(node) && node.incoming.length === 1 && node.outgoing.length === 1 && !boundariesOf(model, node.id).length && model.shapes.has(node.id) && !avoid.has(node.id) && predecessorOf(model, node) !== successorOf(model, node);
  const picked = pickNearMedian(model, path, ok);
  if (!picked) return na('no task with exactly 1 in / 1 out and no boundary event');
  const node = model.nodes.get(picked.id);
  const pred = predecessorOf(model, node), succ = successorOf(model, node);
  return {
    applicable: true, target: picked.id, onPath: picked.onPath,
    cli: [{ op: 'remove', ids: [picked.id] }],
    pr: [{ op: 'remove', id: picked.id, reconnect: true }],
    expect: { kind: 'removed', id: picked.id, pred, succ },
    touched: [], avoid: [picked.id, pred, succ],
  };
}

function e1(model, path, avoid) {
  const ok = (node) => !isGateway(node) && node.type !== 'BoundaryEvent' && node.outgoing.length === 1 && model.shapes.has(node.id) && !avoid.has(node.id) && !avoid.has(successorOf(model, node));
  const picked = pickNearMedian(model, path, ok);
  if (!picked) return na('no non-gateway node with exactly one outgoing flow');
  const node = model.nodes.get(picked.id);
  const id = 'Activity_BenchE1';
  return {
    applicable: true, target: picked.id, onPath: picked.onPath,
    cli: [{ op: 'add', kind: 'userTask', id, name: 'Bench inserted task', after: picked.id }],
    pr: [{ op: 'insertAfter', after: picked.id, element: { type: 'userTask', id, name: 'Bench inserted task' } }],
    expect: { kind: 'inserted', id, type: 'bpmn:UserTask', pred: picked.id, succ: successorOf(model, node) },
    touched: [], avoid: [picked.id],
  };
}

function e2(model, path, avoid) {
  const ok = (node) => node.type === 'ExclusiveGateway' && node.outgoing.length >= 2 && model.shapes.has(node.id) && !avoid.has(node.id);
  const picked = pickNearMedian(model, path, ok);
  if (!picked) return na('no exclusive gateway with >= 2 outgoing flows');
  const task = 'Activity_BenchE2', end = 'Event_BenchE2End';
  return {
    applicable: true, target: picked.id, onPath: picked.onPath,
    cli: [
      { op: 'add', kind: 'userTask', id: task, name: 'Bench branch task', after: picked.id, flowName: 'bench', condition: '${bench}' },
      { op: 'add', kind: 'endEvent', id: end, name: 'Bench branch end', after: task },
    ],
    pr: [
      { op: 'insertAfter', after: picked.id, branch: true, name: 'bench', condition: '${bench}', element: { type: 'userTask', id: task, name: 'Bench branch task', row: 'below' } },
      { op: 'insertAfter', after: task, element: { type: 'endEvent', id: end, name: 'Bench branch end' } },
    ],
    expect: { kind: 'branch', gateway: picked.id, task, end },
    touched: [], avoid: [picked.id],
  };
}

function e4(model, path, avoid) {
  const base = (node) => isTaskish(node) && model.shapes.has(node.id) && !avoid.has(node.id);
  const picked = pickNearMedian(model, path, (node) => base(node) && !boundariesOf(model, node.id).length) ?? pickNearMedian(model, path, base);
  if (!picked) return na('no task');
  const ev = 'Event_BenchE4', end = 'Event_BenchE4End';
  return {
    applicable: true, target: picked.id, onPath: picked.onPath,
    cli: [
      { op: 'add', kind: 'boundaryEvent:timer', id: ev, name: 'Bench timeout', on: picked.id, timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', id: end, name: 'Bench timed out', after: ev },
    ],
    pr: [{ op: 'addErrorBoundary', attachTo: picked.id, id: ev, name: 'Bench timeout', errorCode: 'BENCH_TIMEOUT', end: { id: end, name: 'Bench timed out' } }],
    expect: { kind: 'boundary', host: picked.id, event: ev, end },
    note: 'trigger differs: bpmn-cli timer boundary, bpmn-edit error boundary (no timer op)',
    touched: [], avoid: [picked.id],
  };
}

function e5(model, path, avoid) {
  const leaves = (processId) => [...model.lanes.values()].filter((lane) => lane.leaf && lane.processId === processId);
  const ok = (node) => isTaskish(node) && node.laneId && model.lanes.get(node.laneId)?.leaf && leaves(node.processId).length >= 2 && model.shapes.has(node.id) && !avoid.has(node.id);
  if (![...model.nodes.values()].some((node) => node.laneId && leaves(node.processId).length >= 2)) return na('fewer than 2 lanes');
  const picked = pickNearMedian(model, path, ok);
  if (!picked) return na('no task in a lane');
  const node = model.nodes.get(picked.id);
  const list = leaves(node.processId);
  const laneIndex = list.findIndex((lane) => lane.id === node.laneId);
  const to = (list[laneIndex + 1] ?? list[laneIndex - 1]).id;
  return {
    applicable: true, target: picked.id, onPath: picked.onPath,
    cli: [{ op: 'set', id: picked.id, values: { lane: to } }],
    pr: [{ op: 'moveToLane', id: picked.id, lane: to }],
    expect: { kind: 'lane', id: picked.id, from: node.laneId, to },
    touched: [picked.id, ...boundariesOf(model, picked.id)], avoid: [picked.id],
  };
}

function e6(model, path, avoid) {
  const picked = pickNearMedian(model, path, (node) => isTaskish(node) && model.shapes.has(node.id) && !avoid.has(node.id))
    ?? pickNearMedian(model, path, (node) => isTaskish(node) && model.shapes.has(node.id) && !avoid.has(`removed:${node.id}`));
  if (!picked) return na('no task');
  return {
    applicable: true, target: picked.id, onPath: picked.onPath,
    cli: [{ op: 'set', id: picked.id, values: { name: LONG_NAME } }],
    pr: [{ op: 'rename', id: picked.id, name: LONG_NAME }],
    expect: { kind: 'name', id: picked.id, name: LONG_NAME },
    touched: [], avoid: [picked.id],
  };
}

/** E8 / E9: a decision spliced into one branch of an existing exclusive split (E9: plus a timer reminder path). */
function e8(model, path, timer) {
  const branchOf = (gateway) => gateway.outgoing.map((flowId) => model.flows.get(flowId)).find((flow) => {
    const branchTarget = flow && model.nodes.get(flow.targetId);
    return branchTarget && model.shapes.has(branchTarget.id) && branchTarget.scope === gateway.scope && !isGateway(branchTarget) && branchTarget.type !== 'BoundaryEvent' && branchTarget.incoming.length === 1;
  });
  const picked = pickNearMedian(model, path, (node) => node.type === 'ExclusiveGateway' && node.outgoing.length >= 2 && model.shapes.has(node.id) && !!branchOf(node));
  if (!picked) return na('no exclusive split with a branch into a non-gateway node with one incoming flow');
  const branchFlow = branchOf(model.nodes.get(picked.id));
  const task = 'Activity_BenchE8', gw = 'Gateway_BenchE8', no = 'Activity_BenchE8No', noEnd = 'Event_BenchE8NoEnd';
  const ev = 'Event_BenchE9Timer', remind = 'Activity_BenchE9Remind', remindEnd = 'Event_BenchE9Reminded';
  const cli = [
    { op: 'add', kind: 'userTask', id: task, name: 'Bench approval', flow: branchFlow.id },
    { op: 'add', kind: 'exclusiveGateway', id: gw, name: 'Bench approved?', after: task, before: branchFlow.targetId },
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
    applicable: true, target: picked.id, onPath: picked.onPath, cli, pr: null,
    expect: { kind: 'decision', gateway: picked.id, task, decision: gw, succ: branchFlow.targetId, no, noEnd, ...(timer ? { timer: { event: ev, task: remind, end: remindEnd } } : {}) },
    touched: [], avoid: [],
  };
}

export async function generate(xml) {
  const model = await readModel(xml);
  const path = longestPath(model);
  const avoid = new Set();
  const out = {};
  for (const [key, fn] of [['E3', e3], ['E1', e1], ['E2', e2], ['E4', e4], ['E5', e5], ['E6', e6]]) {
    const generated = fn(model, path, avoid);
    if (generated.applicable) {
      for (const id of generated.avoid) if (id) avoid.add(id);
      if (key === 'E3') avoid.add(`removed:${generated.target}`);
    }
    delete generated.avoid;
    out[key] = generated;
  }
  const edits = Object.fromEntries(EDITS.map((editKey) => [editKey, out[editKey]]));
  edits.E7 = { applicable: EDITS.filter((editKey) => out[editKey].applicable).length >= 2, steps: EDITS.filter((editKey) => out[editKey].applicable) };
  for (const [key, timer] of [['E8', false], ['E9', true]]) {
    const generated = e8(model, path, timer);
    delete generated.avoid;
    edits[key] = generated;
  }
  return { pathLength: path.length, flowNodes: model.nodes.size, leafLanes: [...model.lanes.values()].filter((lane) => lane.leaf).length, edits };
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node tools/bench/gen-edits.mjs <file.bpmn>...');
    process.exit(2);
  }
  for (const file of files) console.log(JSON.stringify({ file, ...(await generate(readFileSync(file, 'utf8'))) }, null, 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
