/**
 * Format operations (src/diagram/ops.ts) through the write pipeline: place,
 * align, color, label, route, space, tidy and lane order, their refusals,
 * batch semantics (after the semantic ops, in batch order, all or nothing)
 * and the persistence of formatting over later writes; plus the read side
 * (layoutView, `show --layout`).
 *
 * Fixtures are drawn by the clean engine; "hand" fixtures are moved by a few
 * pixels so `auto` keeps them (see test/diagram-incremental.test.ts).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPS_SCHEMA, parseOps } from '../src/batch.js';
import { kindsJson } from '../src/guide.js';
import { FORMAT_OP_NAMES } from '../src/ops/types.js';
import { Doc } from '../src/document.js';
import { readPlanes, type DEdge, type DShape } from '../src/diagram/plane.js';
import { layoutView } from '../src/diagram/view.js';
import { isCliError } from '../src/errors.js';
import { renderLayoutView } from '../src/format.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateFile } from '../src/node/files.js';
import { mutateDoc, type MutationOptions, type MutationResult } from '../src/pipeline.js';

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

const BASE: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

const WITH_SUB: Op[] = [
  ...BASE,
  { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'B' },
  { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' },
  { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' },
  { op: 'add', kind: 'endEvent', id: 'SE', name: 'Inner done', after: 'ST' },
  { op: 'add', kind: 'boundaryEvent:timer', id: 'TB', name: 'Late', on: 'Sub', timer: 'PT1H' },
  { op: 'add', kind: 'endEvent', id: 'TE', name: 'Too late', after: 'TB' },
];

const POOLED: Op[] = [
  ...BASE,
  { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' },
  { op: 'add', kind: 'lane', id: 'L1', name: 'Clerk', in: 'Pool', members: ['S', 'A', 'G', 'B', 'E', 'C', 'E2'] },
  { op: 'add', kind: 'lane', id: 'L2', name: 'Boss', in: 'Pool' },
];

async function engineXml(ops: Op[]): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  return r.xml;
}

/** The engine drawing with every coordinate moved: hand-made as far as `auto` is concerned. */
async function handXml(ops: Op[], dx = 13, dy = 7): Promise<string> {
  const doc = await Doc.fromXml(await engineXml(ops));
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      const b = pe.get<El | undefined>('bounds');
      if (b) {
        b.set('x', b.get<number>('x') + dx);
        b.set('y', b.get<number>('y') + dy);
      }
      const lb = pe.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (lb) {
        lb.set('x', lb.get<number>('x') + dx);
        lb.set('y', lb.get<number>('y') + dy);
      }
      for (const w of pe.get<El[] | undefined>('waypoint') ?? []) {
        w.set('x', w.get<number>('x') + dx);
        w.set('y', w.get<number>('y') + dy);
      }
    }
  }
  return doc.toXml();
}

let pooledHand: string;
let pooledEngine: string;
let plainHand: string;

beforeAll(async () => {
  pooledHand = await handXml(POOLED);
  pooledEngine = await engineXml(POOLED);
  plainHand = await handXml(BASE);
});

async function run(xml: string, ops: Op[], opts: MutationOptions = {}): Promise<{ r: MutationResult; after: Doc }> {
  const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
  const after = await Doc.fromXml(r.xml);
  expect(after.importWarnings).toEqual([]);
  return { r, after };
}

async function failure(xml: string, ops: Op[], opts: MutationOptions = {}): Promise<{ code: string; message: string; op?: number; hint?: string; candidates?: string[]; related?: string[] }> {
  try {
    await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
  } catch (err) {
    if (isCliError(err)) return { code: err.code, message: err.message, ...err.details } as Awaited<ReturnType<typeof failure>>;
    throw err;
  }
  throw new Error('expected the mutation to fail');
}

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const p of readPlanes(doc.definitions)) for (const s of p.shapes.values()) out.set(s.id, s);
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const p of readPlanes(doc.definitions)) for (const e of p.edges.values()) out.set(e.id, e);
  return out;
}

async function shapesOf(xml: string): Promise<Map<string, DShape>> {
  return shapes(await Doc.fromXml(xml));
}

const right = (s: DShape): number => s.bounds.x + s.bounds.width;
const bottom = (s: DShape): number => s.bounds.y + s.bounds.height;
const cx = (s: DShape): number => s.bounds.x + s.bounds.width / 2;
const cy = (s: DShape): number => s.bounds.y + s.bounds.height / 2;
const inside = (s: DShape, f: DShape): boolean => s.bounds.x >= f.bounds.x && s.bounds.y >= f.bounds.y && right(s) <= right(f) && bottom(s) <= bottom(f);

function orthogonal(e: DEdge): boolean {
  return e.points.length >= 2 && e.points.every((p, i) => i === 0 || p.x === e.points[i - 1]!.x || p.y === e.points[i - 1]!.y);
}

/** Hard defects a format op must never add. */
const HARD = ['overlaps', 'through', 'outsideLane', 'outsidePool', 'outsideSub', 'diagonal', 'missing'];
function hardAdded(r: MutationResult): string[] {
  return (r.layout.metrics?.added ?? []).filter((p) => HARD.includes(p.kind)).map((p) => `${p.kind} ${p.ids.join(',')}`);
}

function keptExcept(before: Map<string, DShape>, after: Map<string, DShape>, except: string[]): string[] {
  const moved: string[] = [];
  for (const [id, s] of before) {
    if (except.includes(id)) continue;
    const t = after.get(id);
    if (!t || JSON.stringify(t.bounds) !== JSON.stringify(s.bounds)) moved.push(id);
  }
  return moved;
}

/* ------------------------------------------------------------------ */
/* color                                                                */
/* ------------------------------------------------------------------ */

describe('color', () => {
  it('writes the colour picker attributes on shapes and edges and keeps the drawing', async () => {
    const before = await shapesOf(pooledHand);
    const { r, after } = await run(pooledHand, [{ op: 'color', ids: ['A', 'F_yes', 'E'], color: 'red' }]);
    expect(r.layout).toMatchObject({ status: 'ok', mode: 'incremental', reason: 'format operations only: drawing kept' });
    expect(r.layout.format).toEqual([{ op: 'color', index: 0, moved: [], rerouted: [], colored: ['A', 'F_yes', 'E'] }]);
    expect(keptExcept(before, shapes(after), [])).toEqual([]);
    expect(r.xml).toMatch(/xmlns:bioc="http:\/\/bpmn\.io\/schema\/bpmn\/biocolor\/1\.0"/);
    expect(r.xml).toMatch(/xmlns:color="http:\/\/www\.omg\.org\/spec\/BPMN\/non-normative\/color\/1\.0"/);
    expect(r.xml).toMatch(/bpmnElement="A" bioc:stroke="#831311" bioc:fill="#ffcdd2" color:background-color="#ffcdd2" color:border-color="#831311"/);
    expect(r.xml).toMatch(/bpmnElement="F_yes" bioc:stroke="#831311" color:border-color="#831311">/);
    // the external label of the end event gets the stroke colour too
    expect(r.xml).toMatch(/bpmnElement="E"[^>]*>\s*<dc:Bounds[^>]*\/>\s*<bpmndi:BPMNLabel color:color="#831311">/);
    expect(layoutView(after.definitions).colors).toEqual([
      { id: 'A', color: 'red', fill: '#ffcdd2', stroke: '#831311' },
      { id: 'E', color: 'red', fill: '#ffcdd2', stroke: '#831311' },
      { id: 'F_yes', color: 'red', stroke: '#831311' },
    ]);
  });

  it('default removes every colour; colouring twice reports no change', async () => {
    const { r: red } = await run(pooledHand, [{ op: 'color', ids: ['A'], color: 'blue' }]);
    const { r, after } = await run(red.xml, [
      { op: 'color', ids: ['A'], color: 'blue' },
      { op: 'color', ids: ['A', 'B'], color: 'default' },
    ]);
    expect(r.layout.format?.map((f) => f.colored)).toEqual([[], ['A']]);
    expect(r.xml).not.toMatch(/bioc:|color:border|color:background/);
    expect(layoutView(after.definitions).colors).toEqual([]);
  });

  it('colours a pool and a lane, and survives a full redraw', async () => {
    const { r } = await run(pooledHand, [{ op: 'color', ids: ['Pool', 'L2'], color: 'green' }]);
    const { after } = await run(r.xml, [{ op: 'add', kind: 'task', name: 'More', after: 'B' }], { layout: 'full' });
    expect(layoutView(after.definitions).colors.map((c) => `${c.id} ${c.color}`)).toEqual(['Pool green', 'L2 green']);
  });

  it('refuses unknown ids, the process of a pool and files without diagram', async () => {
    const unknown = await failure(pooledHand, [{ op: 'color', ids: ['A'], color: 'red' }, { op: 'color', ids: ['Nope'], color: 'red' }]);
    expect(unknown).toMatchObject({ code: 'E_NOT_FOUND', op: 1 });
    const process = await failure(pooledHand, [{ op: 'color', ids: ['P'], color: 'red' }]);
    expect(process).toMatchObject({ code: 'E_NO_SHAPE', op: 0 });
    expect(process.hint).toMatch(/participant id Pool/);
    const bare = (await engineXml(BASE)).replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '');
    expect(await failure(bare, [{ op: 'color', ids: ['A'], color: 'red' }], { layout: false })).toMatchObject({ code: 'E_NO_DIAGRAM', op: 0 });
    // without --no-layout a file without diagram is drawn first, then coloured
    const { r } = await run(bare, [{ op: 'color', ids: ['A'], color: 'red' }]);
    expect(r.layout).toMatchObject({ mode: 'full', format: [{ op: 'color', colored: ['A'] }] });
  });
});

/* ------------------------------------------------------------------ */
/* place                                                                */
/* ------------------------------------------------------------------ */

describe('place', () => {
  it('moves a rigid group onto the row of one element and right of another; the frame grows', async () => {
    const before = await shapesOf(pooledHand);
    const { r, after } = await run(pooledHand, [{ op: 'place', ids: ['C', 'E2'], rowOf: 'B', after: 'E' }]);
    const s = shapes(after);
    expect(cy(s.get('C')!)).toBe(cy(s.get('B')!));
    expect(s.get('C')!.bounds.x).toBeGreaterThanOrEqual(right(s.get('E')!) + 40);
    // the group keeps its shape
    expect(s.get('E2')!.bounds.x - s.get('C')!.bounds.x).toBe(before.get('E2')!.bounds.x - before.get('C')!.bounds.x);
    expect(s.get('E2')!.bounds.y - s.get('C')!.bounds.y).toBe(before.get('E2')!.bounds.y - before.get('C')!.bounds.y);
    for (const id of ['C', 'E2']) expect(inside(s.get(id)!, s.get('L1')!), id).toBe(true);
    expect(inside(s.get('L1')!, s.get('Pool')!)).toBe(true);
    const f = r.layout.format![0]!;
    expect(f).toMatchObject({ op: 'place', index: 0 });
    expect(f.moved).toEqual(expect.arrayContaining(['C', 'E2', 'L1', 'Pool']));
    expect(f.rerouted).toContain('F_no');
    expect(orthogonal(edges(after).get('F_no')!)).toBe(true);
    expect(keptExcept(before, s, ['C', 'E2', 'L1', 'L2', 'Pool'])).toEqual([]);
    expect(hardAdded(r)).toEqual([]);
  });

  it('puts a branch one row below an element and the others give way', async () => {
    // C into row 1 right after A, where G sits: G gives way (down: nothing is pushed left), B (the row reference) slides right
    const before = await shapesOf(pooledHand);
    const { r, after } = await run(pooledHand, [{ op: 'place', ids: ['C'], rowOf: 'B', after: 'A' }]);
    const s = shapes(after);
    expect(cy(s.get('C')!)).toBe(cy(s.get('B')!));
    expect(cy(s.get('B')!)).toBe(cy(before.get('B')!));
    expect(s.get('C')!.bounds.x).toBe(right(before.get('A')!) + 60);
    expect(s.get('G')!.bounds.y).toBeGreaterThanOrEqual(bottom(s.get('C')!) + 20);
    expect(s.get('B')!.bounds.x).toBeGreaterThanOrEqual(right(s.get('C')!) + 20);
    expect(r.layout.format![0]!.moved).toEqual(expect.arrayContaining(['C', 'G', 'B']));
    expect(hardAdded(r)).toEqual([]);
    // onto the reference itself: no room for that
    expect(await failure(pooledHand, [{ op: 'place', ids: ['E2'], rowOf: 'E', columnOf: 'E' }])).toMatchObject({ code: 'E_NO_ROOM', element: 'E2', related: ['E', 'E'] });
    // below: one row under the element, clear of it
    const { r: r2, after: a2 } = await run(pooledHand, [{ op: 'place', ids: ['C'], below: 'A' }]);
    const t = shapes(a2);
    expect(t.get('C')!.bounds.y).toBeGreaterThanOrEqual(bottom(t.get('A')!) + 20);
    expect(t.get('C')!.bounds.x).toBe(before.get('C')!.bounds.x);
    expect(hardAdded(r2)).toEqual([]);
  });

  it('refuses to leave the lane and names the lane at the target', async () => {
    const e = await failure(pooledHand, [{ op: 'color', ids: ['A'], color: 'red' }, { op: 'place', ids: ['C'], rowOf: 'L2' }]);
    expect(e).toMatchObject({ code: 'E_LEAVES_CONTAINER', op: 1, element: 'C', related: ['L1', 'L2'] });
    expect(e.message).toMatch(/out of its lane L1 \(into lane L2\)/);
    expect(e.hint).toMatch(/move <file> C --lane L2/);
    // the last row of L1 with L2 below: no room below without leaving the lane
    expect(await failure(pooledHand, [{ op: 'place', ids: ['C'], below: 'E2' }])).toMatchObject({ code: 'E_LEAVES_CONTAINER', related: ['L1', 'L2'] });
    // before the start of the lane
    expect(await failure(pooledHand, [{ op: 'place', ids: ['A'], before: 'S' }])).toMatchObject({ code: 'E_LEAVES_CONTAINER', related: ['L1'] });
    // after a lane change in the same batch it is allowed
    const { r, after } = await run(pooledHand, [
      { op: 'move', ids: ['C'], lane: 'L2' },
      { op: 'place', ids: ['C'], rowOf: 'L2' },
    ]);
    const s = shapes(after);
    expect(inside(s.get('C')!, s.get('L2')!)).toBe(true);
    expect(cy(s.get('C')!)).toBe(cy(s.get('L2')!));
    expect(hardAdded(r)).toEqual([]);
  });

  it('refuses boundary events, pools, connections and shapes of another diagram', async () => {
    const withBoundary = await handXml([...BASE, { op: 'add', kind: 'boundaryEvent:timer', id: 'T', on: 'A', timer: 'PT1H' }]);
    expect(await failure(withBoundary, [{ op: 'place', ids: ['T'], rowOf: 'B' }])).toMatchObject({ code: 'E_WRONG_KIND', related: ['A'] });
    expect(await failure(pooledHand, [{ op: 'place', ids: ['Pool'], rowOf: 'B' }])).toMatchObject({ code: 'E_WRONG_KIND' });
    expect(await failure(pooledHand, [{ op: 'place', ids: ['F_no'], rowOf: 'B' }])).toMatchObject({ code: 'E_WRONG_KIND' });
    const collapsed = await handXml([
      ...BASE,
      { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'B', collapsed: true },
      { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' },
      { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' },
    ]);
    expect(await failure(collapsed, [{ op: 'place', ids: ['ST'], rowOf: 'A' }])).toMatchObject({ code: 'E_DIFFERENT_DIAGRAM', element: 'ST', related: ['A'] });
  });
});

/* ------------------------------------------------------------------ */
/* align                                                                */
/* ------------------------------------------------------------------ */

describe('align', () => {
  it('puts shapes on one column (each on its own) and reroutes their flows', async () => {
    const before = await shapesOf(plainHand);
    const { r, after } = await run(plainHand, [{ op: 'align', ids: ['A', 'C'], axis: 'column' }]);
    const s = shapes(after);
    expect(cx(s.get('C')!)).toBe(cx(s.get('A')!));
    expect(cy(s.get('C')!)).toBe(cy(before.get('C')!));
    expect(s.get('A')!.bounds).toEqual(before.get('A')!.bounds);
    expect(r.layout.format![0]!.rerouted).toEqual(expect.arrayContaining(['F_no']));
    for (const e of edges(after).values()) expect(orthogonal(e), e.id).toBe(true);
    expect(hardAdded(r)).toEqual([]);
  });

  it('aligns on a row with an explicit reference', async () => {
    const { r, after } = await run(plainHand, [{ op: 'align', ids: ['E2', 'C'], axis: 'row', to: 'S' }]);
    const s = shapes(after);
    expect(cy(s.get('E2')!)).toBe(cy(s.get('S')!));
    expect(cy(s.get('C')!)).toBe(cy(s.get('S')!));
    expect(hardAdded(r)).toEqual([]);
    const done = await run(r.xml, [{ op: 'align', ids: ['E2', 'C'], axis: 'row', to: 'S' }]);
    expect(done.r.layout.format![0]).toMatchObject({ moved: [], notes: ['already aligned on the row of S'] });
  });

  it('refuses a column the sub-process would have to grow over (E_NO_ROOM) and aligns inside it', async () => {
    const xml = await handXml(WITH_SUB);
    const e = await failure(xml, [{ op: 'align', ids: ['E', 'SE'], axis: 'column' }]);
    expect(e).toMatchObject({ code: 'E_NO_ROOM', element: 'SE' });
    const { r, after } = await run(xml, [{ op: 'align', ids: ['ST', 'SS'], axis: 'row', to: 'SE' }]);
    expect(cy(shapes(after).get('SS')!)).toBe(cy(shapes(after).get('SE')!));
    expect(hardAdded(r)).toEqual([]);
  });

  it('refuses to align out of the lane', async () => {
    const e = await failure(pooledHand, [{ op: 'align', ids: ['L2', 'A'], axis: 'row' }]);
    expect(e).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'A' });
  });
});

/* ------------------------------------------------------------------ */
/* label / route                                                        */
/* ------------------------------------------------------------------ */

describe('label', () => {
  it('puts the label of an event, a gateway and a flow on the requested side', async () => {
    const { r, after } = await run(pooledHand, [
      { op: 'label', id: 'E', side: 'right' },
      { op: 'label', id: 'G', side: 'below' },
      { op: 'label', id: 'F_no', side: 'right' },
    ]);
    expect(r.layout.format!.map((f) => f.labels)).toEqual([['E'], ['G'], ['F_no']]);
    const s = shapes(after);
    expect(s.get('E')!.label!.x).toBeGreaterThanOrEqual(right(s.get('E')!));
    expect(s.get('G')!.label!.y).toBeGreaterThanOrEqual(bottom(s.get('G')!));
    const labels = layoutView(after.definitions).labels;
    expect(labels).toEqual(expect.arrayContaining([
      { id: 'E', side: 'right', default: 'below' },
      { id: 'G', side: 'below', default: 'above' },
      { id: 'F_no', side: 'right', default: 'above' },
    ]));
  });

  it('refuses tasks, unnamed elements and sides a flow has no segment for', async () => {
    expect(await failure(pooledHand, [{ op: 'label', id: 'A', side: 'below' }])).toMatchObject({ code: 'E_WRONG_KIND', element: 'A' });
    const unnamed = await handXml([...BASE, { op: 'add', kind: 'intermediateThrowEvent', id: 'I', after: 'B' }]);
    expect(await failure(unnamed, [{ op: 'label', id: 'I', side: 'below' }])).toMatchObject({ code: 'E_NO_LABEL', element: 'I' });
    // F_yes runs straight from G to B: no vertical segment to stand beside
    expect(await failure(pooledHand, [{ op: 'label', id: 'F_yes', side: 'left' }])).toMatchObject({ code: 'E_INVALID_VALUE', element: 'F_yes' });
  });
});

describe('route', () => {
  it('routes a flow again with forced exit and entry sides', async () => {
    const { r, after } = await run(plainHand, [{ op: 'route', id: 'F_no', exit: 'bottom', entry: 'bottom' }]);
    const s = shapes(after);
    const e = edges(after).get('F_no')!;
    expect(e.points[0]!.y).toBe(bottom(s.get('G')!));
    expect(e.points[e.points.length - 1]!.y).toBe(bottom(s.get('C')!));
    expect(orthogonal(e)).toBe(true);
    expect(r.layout.format).toEqual([{ op: 'route', index: 0, moved: [], rerouted: ['F_no'] }]);
    const top = await run(plainHand, [{ op: 'route', id: 'F_yes', exit: 'top', entry: 'left' }]);
    const t = edges(top.after).get('F_yes')!;
    expect(t.points[0]!.y).toBe(shapes(top.after).get('G')!.bounds.y);
    expect(t.points[t.points.length - 1]!.x).toBe(shapes(top.after).get('B')!.bounds.x);
  });

  it('refuses a node', async () => {
    expect(await failure(plainHand, [{ op: 'route', id: 'A' }])).toMatchObject({ code: 'E_WRONG_KIND' });
  });
});

/* ------------------------------------------------------------------ */
/* space / tidy                                                         */
/* ------------------------------------------------------------------ */

describe('space', () => {
  it('inserts one column right of an element: the right part moves, the pool grows', async () => {
    const before = await shapesOf(pooledHand);
    const { r, after } = await run(pooledHand, [{ op: 'space', after: 'A' }]);
    const s = shapes(after);
    const d = s.get('G')!.bounds.x - before.get('G')!.bounds.x;
    expect(d).toBeGreaterThanOrEqual(100);
    for (const id of ['B', 'E', 'C', 'E2']) expect(s.get(id)!.bounds.x - before.get(id)!.bounds.x, id).toBe(d);
    for (const id of ['S', 'A']) expect(s.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(s.get('Pool')!.bounds.width - before.get('Pool')!.bounds.width).toBe(d);
    expect(hardAdded(r)).toEqual([]);
    for (const e of edges(after).values()) expect(orthogonal(e), e.id).toBe(true);
  });

  it('makes a lane taller with --below <lane> and pixels', async () => {
    const before = await shapesOf(pooledHand);
    const { r, after } = await run(pooledHand, [{ op: 'space', below: 'L1', by: 50 }]);
    const s = shapes(after);
    expect(s.get('L1')!.bounds.height).toBe(before.get('L1')!.bounds.height + 50);
    expect(s.get('L2')!.bounds.y).toBe(before.get('L2')!.bounds.y + 50);
    expect(s.get('Pool')!.bounds.height).toBe(before.get('Pool')!.bounds.height + 50);
    expect(keptExcept(before, s, ['L1', 'L2', 'Pool'])).toEqual([]);
    expect(hardAdded(r)).toEqual([]);
  });
});

describe('tidy', () => {
  /** The hand drawing with C pushed onto B. */
  async function overlapping(): Promise<string> {
    const doc = await Doc.fromXml(pooledHand);
    for (const pe of doc.definitions.get<El[]>('diagrams')[0]!.get<El>('plane').get<El[]>('planeElement')) {
      if (pe.get<El>('bpmnElement').get<string>('id') === 'C') pe.get<El>('bounds').set('y', shapes(doc).get('B')!.bounds.y + 30);
    }
    return doc.toXml();
  }

  it('leaves a boundary event on an expanded sub-process with its host', async () => {
    const xml = await handXml(WITH_SUB);
    const before = await shapesOf(xml);
    const { r, after } = await run(xml, [{ op: 'tidy' }]);
    expect(r.layout.format![0]!.moved).toEqual([]);
    expect(keptExcept(before, shapes(after), [])).toEqual([]);
  });

  it('removes overlaps with minimal moves', async () => {
    const xml = await overlapping();
    const before = (await run(xml, [{ op: 'tidy' }])).r;
    expect(before.layout.metrics!.before!.counts.overlaps).toBe(1);
    expect(before.layout.metrics!.after.counts.overlaps).toBe(0);
    expect(before.layout.format![0]!.moved.length).toBeGreaterThan(0);
    expect(hardAdded(before)).toEqual([]);
    // only the given shapes
    const some = (await run(xml, [{ op: 'tidy', ids: ['A', 'S'] }])).r;
    expect(some.layout.metrics!.after.counts.overlaps).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* lane order                                                           */
/* ------------------------------------------------------------------ */

describe('order lanes', () => {
  it('reorders laneSet.lanes and the bands of a kept drawing; content moves with its lane', async () => {
    const before = await shapesOf(pooledHand);
    const { r, after } = await run(pooledHand, [{ op: 'order', id: 'Pool', lanes: ['L2', 'L1'] }]);
    expect(r.layout.mode).toBe('incremental');
    expect(r.changes.changed.map((c) => c.detail)).toEqual(['lane order: L2, L1']);
    const process = after.get('P')!;
    expect(process.get<El[]>('laneSets')[0]!.get<El[]>('lanes').map((l) => l.get<string>('id'))).toEqual(['L2', 'L1']);
    const s = shapes(after);
    const pool = before.get('Pool')!;
    expect(s.get('L2')!.bounds.y).toBe(pool.bounds.y);
    expect(s.get('L1')!.bounds.y).toBe(pool.bounds.y + before.get('L2')!.bounds.height);
    const dy = s.get('L1')!.bounds.y - before.get('L1')!.bounds.y;
    for (const id of ['S', 'A', 'G', 'B', 'E', 'C', 'E2']) {
      expect(s.get(id)!.bounds.y - before.get(id)!.bounds.y, id).toBe(dy);
      expect(inside(s.get(id)!, s.get('L1')!), id).toBe(true);
    }
    expect(r.layout.format![0]).toMatchObject({ op: 'order', index: 0 });
    // flows inside the lane were translated, not rerouted
    expect(r.layout.format![0]!.rerouted).toEqual([]);
    expect(edges(after).get('F_yes')!.points[0]!.y - edges(await Doc.fromXml(pooledHand)).get('F_yes')!.points[0]!.y).toBe(dy);
    expect(hardAdded(r)).toEqual([]);
    expect(r.layout.metrics!.after.score).toBe(r.layout.metrics!.before!.score);
  });

  it('accepts lane ids as positional flows (the CLI form) and redraws an engine-owned drawing in the new order', async () => {
    const { r, after } = await run(pooledEngine, [{ op: 'order', id: 'Pool', flows: ['L2'] }]);
    expect(r.layout.mode).toBe('full');
    const s = shapes(after);
    expect(s.get('L2')!.bounds.y).toBeLessThan(s.get('L1')!.bounds.y);
    expect(r.layout.format).toEqual([{ op: 'order', index: 0, moved: [], rerouted: [] }]);
  });

  it('orders nested lanes by their parent lane and refuses lanes of another level', async () => {
    const nested = await handXml([
      ...POOLED,
      { op: 'add', kind: 'lane', id: 'L1a', name: 'Front', in: 'L1', members: ['S', 'A', 'G'] },
      { op: 'add', kind: 'lane', id: 'L1b', name: 'Back', in: 'L1', members: ['B', 'E', 'C', 'E2'] },
    ]);
    const before = await shapesOf(nested);
    expect(before.get('L1a')!.bounds.y).toBeLessThan(before.get('L1b')!.bounds.y);
    const { r, after } = await run(nested, [{ op: 'order', id: 'L1', lanes: ['L1b', 'L1a'] }]);
    const s = shapes(after);
    expect(s.get('L1b')!.bounds.y).toBe(before.get('L1a')!.bounds.y);
    for (const id of ['S', 'A', 'G']) expect(inside(s.get(id)!, s.get('L1a')!), id).toBe(true);
    for (const id of ['B', 'E', 'C', 'E2']) expect(inside(s.get(id)!, s.get('L1b')!), id).toBe(true);
    expect(hardAdded(r)).toEqual([]);
    const wrong = await failure(nested, [{ op: 'order', id: 'Pool', lanes: ['L1b'] }]);
    expect(wrong).toMatchObject({ code: 'E_NOT_CHILD_LANE', element: 'Pool', candidates: ['L1', 'L2'] });
    expect(await failure(nested, [{ op: 'order', id: 'L2', lanes: ['L1a'] }])).toMatchObject({ code: 'E_NOT_CHILD_LANE' });
    expect(await failure(nested, [{ op: 'order', id: 'A', lanes: ['L1a'] }])).toMatchObject({ code: 'E_WRONG_KIND' });
  });
});

/* ------------------------------------------------------------------ */
/* batches and persistence                                              */
/* ------------------------------------------------------------------ */

describe('format ops in a batch', () => {
  it('run after the semantic ops and the layout, in batch order', async () => {
    const { r, after } = await run(pooledHand, [
      { op: 'place', ids: ['X'], above: 'C' },
      { op: 'add', kind: 'task', id: 'X', name: 'Extra', after: 'C', before: 'E2' },
      { op: 'color', ids: ['X'], color: 'purple' },
    ]);
    expect(r.layout.mode).toBe('incremental');
    expect(r.layout.placed).toContain('X');
    expect(r.layout.format!.map((f) => `${f.op}#${f.index}`)).toEqual(['place#0', 'color#2']);
    const s = shapes(after);
    expect(bottom(s.get('X')!)).toBeLessThanOrEqual(s.get('C')!.bounds.y - 20);
    expect(inside(s.get('X')!, s.get('L1')!)).toBe(true);
    expect(layoutView(after.definitions).colors).toEqual([{ id: 'X', color: 'purple', fill: '#e1bee7', stroke: '#5b176d' }]);
    expect(hardAdded(r)).toEqual([]);
  });

  it('on a new file: drawn in full first, then formatted', async () => {
    const r = await mutateDoc(Doc.create({ processId: 'P' }), [...BASE, { op: 'color', ids: ['A'], color: 'orange' }, { op: 'label', id: 'E', side: 'above' }], { dryRun: true });
    expect(r.layout.mode).toBe('full');
    expect(r.layout.format!.map((f) => f.op)).toEqual(['color', 'label']);
    expect(layoutView((await Doc.fromXml(r.xml)).definitions).labels).toEqual([{ id: 'E', side: 'above', default: 'below' }]);
  });

  it('are all or nothing: a failing format op writes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bpmn-format-'));
    try {
      const file = join(dir, 'f.bpmn');
      writeFileSync(file, pooledHand);
      await expect(
        mutateFile(file, [
          { op: 'add', kind: 'task', id: 'X', name: 'Extra', after: 'C', before: 'E2' },
          { op: 'color', ids: ['A'], color: 'red' },
          { op: 'place', ids: ['C'], rowOf: 'L2' },
        ]),
      ).rejects.toMatchObject({ code: 'E_LEAVES_CONTAINER', details: { op: 2 } });
      expect(readFileSync(file, 'utf8')).toBe(pooledHand);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with --no-layout they apply to the existing drawing', async () => {
    const { r } = await run(pooledHand, [{ op: 'color', ids: ['A'], color: 'red' }], { layout: false });
    expect(r.layout).toMatchObject({ status: 'skipped', format: [{ op: 'color', colored: ['A'] }] });
  });

  it('formatting survives later writes: colour + place, then an add in auto mode keeps both', async () => {
    // an engine-owned drawing: auto would redraw it ...
    const owned = await run(pooledEngine, [{ op: 'set', id: 'A', values: { name: 'Check order' } }]);
    expect(owned.r.layout.mode).toBe('full');
    // ... until a format op changes it
    const formatted = await run(pooledEngine, [
      { op: 'color', ids: ['A', 'F_yes'], color: 'red' },
      { op: 'place', ids: ['C', 'E2'], below: 'E', after: 'E' },
    ]);
    expect(formatted.r.layout.format![1]!.moved).toEqual(expect.arrayContaining(['C', 'E2']));
    const placed = shapes(formatted.after);
    const next = await run(formatted.r.xml, [{ op: 'add', kind: 'userTask', id: 'R', name: 'Review', after: 'B' }]);
    expect(next.r.layout).toMatchObject({ mode: 'incremental', reason: expect.stringMatching(/hand-made/) });
    const s = shapes(next.after);
    expect(s.get('R')).toBeDefined();
    // the placed branch keeps its place relative to the row it was put under (the space tool may shift the columns)
    expect(s.get('C')!.bounds.y).toBe(placed.get('C')!.bounds.y);
    expect(s.get('E2')!.bounds.y).toBe(placed.get('E2')!.bounds.y);
    expect(s.get('C')!.bounds.y).toBeGreaterThanOrEqual(bottom(s.get('E')!) + 20);
    expect(layoutView(next.after.definitions).colors.map((c) => `${c.id} ${c.color}`)).toEqual(['A red', 'F_yes red']);
  });
});

/* ------------------------------------------------------------------ */
/* read side                                                            */
/* ------------------------------------------------------------------ */

describe('layoutView (show --layout)', () => {
  it('lists the rows of node ids per pool and lane, left to right', async () => {
    const hand = await Doc.fromXml(pooledHand);
    const collab = hand.collaboration()!.get<string>('id');
    const view = layoutView(hand.definitions);
    expect(view.diagrams).toHaveLength(1);
    expect(view.diagrams[0]!.groups).toEqual([
      { id: 'Pool', kind: 'participant', name: 'Org', rows: [], columns: [] },
      { id: 'L1', kind: 'lane', name: 'Clerk', parent: 'Pool', rows: [['S', 'A', 'G', 'B', 'E'], ['C', 'E2']], columns: [[0, 1, 2, 3, 4], [3, 4]] },
      { id: 'L2', kind: 'lane', name: 'Boss', parent: 'Pool', rows: [], columns: [] },
    ]);
    expect(view.diagrams[0]).toMatchObject({ columns: 5, gaps: [] });
    expect(view.metrics.score).toBe(0);
    expect(renderLayoutView(view)).toBe(
      [
        `diagram BPMNPlane_${collab} (${collab})`,
        '  columns: c0..c4',
        '  participant Pool "Org"',
        '    lane L1 "Clerk"',
        '      row 1: c0 S, c1 A, c2 G, c3 B, c4 E',
        '      row 2: c3 C, c4 E2',
        '    lane L2 "Boss"',
        'layout quality: score 0: no layout problems',
        '',
      ].join('\n'),
    );
  });

  it('nests expanded sub-processes and reports problems with ids', async () => {
    const xml = await handXml([
      ...BASE,
      { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'B' },
      { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' },
      { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' },
    ]);
    const doc = await Doc.fromXml(xml);
    // C on top of B
    for (const pe of doc.definitions.get<El[]>('diagrams')[0]!.get<El>('plane').get<El[]>('planeElement')) {
      if (pe.get<El>('bpmnElement').get<string>('id') === 'C') pe.get<El>('bounds').set('y', shapes(doc).get('B')!.bounds.y);
    }
    const view = layoutView(doc.definitions);
    const groups = view.diagrams[0]!.groups;
    expect(groups.map((g) => `${g.kind} ${g.id}${g.parent ? ` < ${g.parent}` : ''}`)).toEqual(['process P', 'subProcess Sub < P']);
    expect(groups[1]!.rows).toEqual([['SS', 'ST']]);
    expect(view.metrics.problems).toEqual(expect.arrayContaining([{ kind: 'overlaps', ids: ['B', 'C'] }]));
    expect(renderLayoutView(view)).toMatch(/\n {2}overlaps \[B, C\]\n/);
  });
});

/* ------------------------------------------------------------------ */
/* ops JSON                                                             */
/* ------------------------------------------------------------------ */

describe('format ops in the ops JSON', () => {
  function message(input: unknown): string {
    try {
      parseOps(input);
    } catch (err) {
      if (isCliError(err)) return `${err.message}${err.details.hint ? ` | ${err.details.hint}` : ''}`;
      throw err;
    }
    throw new Error('expected parseOps to fail');
  }

  it('validates the keys of every format op', () => {
    expect(message([{ op: 'place', ids: ['A'] }])).toMatch(/^ops\[0\] \(place\): nothing to do: give a row/);
    expect(message([{ op: 'place', ids: ['A'], rowOf: 'B', below: 'C' }])).toMatch(/"rowOf" and "below" cannot be combined/);
    expect(message([{ op: 'place', ids: ['A'], after: 'B', before: 'C' }])).toMatch(/"after" and "before" cannot be combined/);
    expect(message([{ op: 'place', ids: [], rowOf: 'B' }])).toMatch(/"ids" needs at least 1 entry/);
    expect(message([{ op: 'align', ids: ['A'], axis: 'row' }])).toMatch(/align needs two ids, or one id and "to"/);
    expect(message([{ op: 'align', ids: ['A', 'B'], axis: 'diagonal' }])).toMatch(/"axis" must be one of "row", "column"/);
    expect(message([{ op: 'align', ids: ['A', 'B'] }])).toMatch(/missing required key "axis"/);
    expect(message([{ op: 'color', ids: ['A'], color: 'pink' }])).toMatch(/"color" must be one of "blue", "orange", "green", "red", "purple", "default"/);
    expect(message([{ op: 'label', id: 'A', side: 'top' }])).toMatch(/"side" must be one of "above", "below", "left", "right"/);
    expect(message([{ op: 'route', id: 'F', exit: 'up' }])).toMatch(/"exit" must be one of "right", "top", "bottom", "left"/);
    expect(message([{ op: 'space', after: 'A', below: 'B' }])).toMatch(/"after" and "below" cannot be combined/);
    expect(message([{ op: 'space' }])).toMatch(/give "after" .* or "below"/);
    expect(message([{ op: 'space', after: 'A', by: 'wide' }])).toMatch(/"by" must be "column", "row" or a positive integer \(pixels\), or "-column", "-row" or a negative integer to close space, got string "wide"/);
    expect(message([{ op: 'space', after: 'A', by: 0 }])).toMatch(/"by" must be/);
    expect(message([{ op: 'tidy', ids: [] }])).toMatch(/"ids" needs at least 1 entry/);
    expect(message([{ op: 'order', id: 'P', flows: ['a'], lanes: ['b'] }])).toMatch(/give exactly one of "flows" .* or "lanes"/);
    expect(message([{ op: 'order', id: 'P' }])).toMatch(/give exactly one of "flows"/);
    expect(parseOps([{ op: 'space', after: 'A', by: '120' }])).toEqual([{ op: 'space', after: 'A', by: 120 }]);
  });

  it('are in the JSON schema and in `kinds --json`', () => {
    const defs = OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, unknown>; required: string[]; allOf?: unknown[] }>;
    for (const name of FORMAT_OP_NAMES) expect(defs[name], name).toBeDefined();
    expect(defs['place']!.required).toEqual(['op', 'ids']);
    expect(defs['place']!.allOf).toEqual(expect.arrayContaining([{ not: { required: ['rowOf', 'below'] } }, { anyOf: ['rowOf', 'below', 'above', 'columnOf', 'after', 'before'].map((k) => ({ required: [k] })) }]));
    expect(defs['space']!.properties['by']).toMatchObject({ oneOf: [{ type: 'string', enum: ['column', 'row', '-column', '-row'] }, { type: 'integer', not: { const: 0 } }] });
    expect(defs['color']!.properties['color']).toMatchObject({ enum: ['blue', 'orange', 'green', 'red', 'purple', 'default'] });
    expect(Object.keys(defs['order']!.properties)).toEqual(['op', 'id', 'flows', 'lanes']);
    const json = kindsJson();
    expect(json['layoutModes']).toEqual(['auto', 'incremental', 'full']);
    expect(json['colors']).toMatchObject({ red: { fill: '#ffcdd2', stroke: '#831311' } });
  });

  it('suggests the key or op an agent probably meant', () => {
    expect(message([{ op: 'place', ids: ['A'], rowof: 'B' }])).toMatch(/unknown key "rowof" \(did you mean "rowOf"\?\)/);
    expect(message([{ op: 'place', ids: ['A'], 'column-of': 'B' }])).toMatch(/did you mean "columnOf"/);
    expect(message([{ op: 'color', ids: ['A'], colour: 'red' }])).toMatch(/unknown key "colour" \(did you mean "color"\?\)/);
    expect(message([{ op: 'route', id: 'F', exti: 'bottom' }])).toMatch(/did you mean "exit"/);
    expect(message([{ op: 'label', id: 'F', sied: 'below' }])).toMatch(/did you mean "side"/);
    expect(message([{ op: 'colour', ids: ['A'], color: 'red' }])).toMatch(/unknown op "colour" \(did you mean "color"\?\)/);
    expect(message([{ op: 'allign', ids: ['A', 'B'], axis: 'row' }])).toMatch(/did you mean "align"/);
    // nothing close: no guess
    expect(message([{ op: 'place', ids: ['A'], somewhere: 'B' }])).not.toMatch(/did you mean/);
  });
});
