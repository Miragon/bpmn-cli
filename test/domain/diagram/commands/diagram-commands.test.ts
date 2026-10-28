/**
 * Format operations (src/domain/diagram/commands/DiagramCommands.ts) through the write pipeline: place,
 * align, color, label, route, space, tidy and lane order, their refusals,
 * batch semantics (in batch order, each after the layout of the model commands before it,
 * all or nothing)
 * and the persistence of formatting over later writes; plus the read side
 * (layoutView, `show --layout`).
 *
 * Fixtures are drawn by the clean engine; "hand" fixtures are moved by a few
 * pixels so `auto` keeps them (see test/domain/diagram/layout/incremental/incremental-layout.test.ts).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPS_SCHEMA } from '../../../../src/adapters/in/report/OpsSchemaBuilder.js';
import { parseOps, kindsJson, layoutView, renderLayoutView } from '../../../../src/index.js';
import { DIAGRAM_COMMAND_NAMES } from '../../../../src/domain/commands/utils/command-names.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import type { DEdge, DShape } from '../../../../src/domain/diagram/di/types.js';
import { isBpmnError } from '../../../../src/domain/document/utils/errors.js';
import type { El } from '../../../../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../../../../src/domain/commands/types.js';
import { mutateFile } from '../../../../src/node.js';
import { mutateDoc } from '../../../../src/index.js';
import type { MutationOptions, MutationResult } from '../../../../src/domain/batch/types.js';
import { edges, shapes } from '../../../helpers/drawing.js';

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

const BASE: EditCommand[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

const WITH_SUB: EditCommand[] = [
  ...BASE,
  { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'B' },
  { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' },
  { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' },
  { op: 'add', kind: 'endEvent', id: 'SE', name: 'Inner done', after: 'ST' },
  { op: 'add', kind: 'boundaryEvent:timer', id: 'TB', name: 'Late', on: 'Sub', timer: 'PT1H' },
  { op: 'add', kind: 'endEvent', id: 'TE', name: 'Too late', after: 'TB' },
];

const POOLED: EditCommand[] = [
  ...BASE,
  { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' },
  { op: 'add', kind: 'lane', id: 'L1', name: 'Clerk', in: 'Pool', members: ['S', 'A', 'G', 'B', 'E', 'C', 'E2'] },
  { op: 'add', kind: 'lane', id: 'L2', name: 'Boss', in: 'Pool' },
];

async function engineXml(ops: EditCommand[]): Promise<string> {
  const result = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  return result.xml;
}

/** The engine drawing with every coordinate moved: hand-made as far as `auto` is concerned. */
async function handXml(ops: EditCommand[], dx = 13, dy = 7): Promise<string> {
  const doc = await Doc.fromXml(await engineXml(ops));
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      const shapeBounds = pe.get<El | undefined>('bounds');
      if (shapeBounds) {
        shapeBounds.set('x', shapeBounds.get<number>('x') + dx);
        shapeBounds.set('y', shapeBounds.get<number>('y') + dy);
      }
      const lb = pe.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (lb) {
        lb.set('x', lb.get<number>('x') + dx);
        lb.set('y', lb.get<number>('y') + dy);
      }
      for (const waypoint of pe.get<El[] | undefined>('waypoint') ?? []) {
        waypoint.set('x', waypoint.get<number>('x') + dx);
        waypoint.set('y', waypoint.get<number>('y') + dy);
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

async function run(xml: string, ops: EditCommand[], opts: MutationOptions = {}): Promise<{ result: MutationResult; after: Doc }> {
  const result = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
  const after = await Doc.fromXml(result.xml);
  expect(after.importWarnings).toEqual([]);
  return { result, after };
}

async function failure(xml: string, ops: EditCommand[], opts: MutationOptions = {}): Promise<{ code: string; message: string; op?: number; hint?: string; candidates?: string[]; related?: string[] }> {
  try {
    await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
  } catch (err) {
    if (isBpmnError(err)) return { code: err.code, message: err.message, ...err.details } as Awaited<ReturnType<typeof failure>>;
    throw err;
  }
  throw new Error('expected the mutation to fail');
}

async function shapesOf(xml: string): Promise<Map<string, DShape>> {
  return shapes(await Doc.fromXml(xml));
}

const right = (shape: DShape): number => shape.bounds.x + shape.bounds.width;
const bottom = (shape: DShape): number => shape.bounds.y + shape.bounds.height;
const cx = (shape: DShape): number => shape.bounds.x + shape.bounds.width / 2;
const cy = (shape: DShape): number => shape.bounds.y + shape.bounds.height / 2;
const inside = (inner: DShape, frame: DShape): boolean => inner.bounds.x >= frame.bounds.x && inner.bounds.y >= frame.bounds.y && right(inner) <= right(frame) && bottom(inner) <= bottom(frame);

function orthogonal(edge: DEdge): boolean {
  return edge.points.length >= 2 && edge.points.every((point, index) => index === 0 || point.x === edge.points[index - 1]!.x || point.y === edge.points[index - 1]!.y);
}

/** Hard defects a format op must never add. */
const HARD = ['overlaps', 'through', 'outsideLane', 'outsidePool', 'outsideSub', 'diagonal', 'missing'];
function hardAdded(result: MutationResult): string[] {
  return (result.layout.metrics?.added ?? []).filter((problem) => HARD.includes(problem.kind)).map((problem) => `${problem.kind} ${problem.ids.join(',')}`);
}

function keptExcept(before: Map<string, DShape>, after: Map<string, DShape>, except: string[]): string[] {
  const moved: string[] = [];
  for (const [id, shapeBefore] of before) {
    if (except.includes(id)) continue;
    const shapeAfter = after.get(id);
    if (!shapeAfter || JSON.stringify(shapeAfter.bounds) !== JSON.stringify(shapeBefore.bounds)) moved.push(id);
  }
  return moved;
}

/* ------------------------------------------------------------------ */
/* color                                                                */
/* ------------------------------------------------------------------ */

describe('color', () => {
  it('writes the colour picker attributes on shapes and edges and keeps the drawing', async () => {
    const before = await shapesOf(pooledHand);
    const { result, after } = await run(pooledHand, [{ op: 'color', ids: ['A', 'F_yes', 'E'], color: 'red' }]);
    expect(result.layout).toMatchObject({ status: 'ok', mode: 'incremental', reason: 'format operations only: drawing kept' });
    expect(result.layout.format).toEqual([{ op: 'color', index: 0, moved: [], rerouted: [], colored: ['A', 'F_yes', 'E'] }]);
    expect(keptExcept(before, shapes(after), [])).toEqual([]);
    expect(result.xml).toMatch(/xmlns:bioc="http:\/\/bpmn\.io\/schema\/bpmn\/biocolor\/1\.0"/);
    expect(result.xml).toMatch(/xmlns:color="http:\/\/www\.omg\.org\/spec\/BPMN\/non-normative\/color\/1\.0"/);
    expect(result.xml).toMatch(/bpmnElement="A" bioc:stroke="#831311" bioc:fill="#ffcdd2" color:background-color="#ffcdd2" color:border-color="#831311"/);
    expect(result.xml).toMatch(/bpmnElement="F_yes" bioc:stroke="#831311" color:border-color="#831311">/);
    // the external label of the end event gets the stroke colour too
    expect(result.xml).toMatch(/bpmnElement="E"[^>]*>\s*<dc:Bounds[^>]*\/>\s*<bpmndi:BPMNLabel color:color="#831311">/);
    expect(layoutView(after.definitions).colors).toEqual([
      { id: 'A', color: 'red', fill: '#ffcdd2', stroke: '#831311' },
      { id: 'E', color: 'red', fill: '#ffcdd2', stroke: '#831311' },
      { id: 'F_yes', color: 'red', stroke: '#831311' },
    ]);
  });

  it('default removes every colour; colouring twice reports no change', async () => {
    const { result: red } = await run(pooledHand, [{ op: 'color', ids: ['A'], color: 'blue' }]);
    const { result, after } = await run(red.xml, [
      { op: 'color', ids: ['A'], color: 'blue' },
      { op: 'color', ids: ['A', 'B'], color: 'default' },
    ]);
    expect(result.layout.format?.map((step) => step.colored)).toEqual([[], ['A']]);
    expect(result.xml).not.toMatch(/bioc:|color:border|color:background/);
    expect(layoutView(after.definitions).colors).toEqual([]);
  });

  it('colours a pool and a lane, and survives a full redraw', async () => {
    const { result } = await run(pooledHand, [{ op: 'color', ids: ['Pool', 'L2'], color: 'green' }]);
    const { after } = await run(result.xml, [{ op: 'add', kind: 'task', name: 'More', after: 'B' }], { layout: 'full' });
    expect(layoutView(after.definitions).colors.map((colored) => `${colored.id} ${colored.color}`)).toEqual(['Pool green', 'L2 green']);
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
    const { result } = await run(bare, [{ op: 'color', ids: ['A'], color: 'red' }]);
    expect(result.layout).toMatchObject({ mode: 'full', format: [{ op: 'color', colored: ['A'] }] });
  });
});

/* ------------------------------------------------------------------ */
/* place                                                                */
/* ------------------------------------------------------------------ */

describe('place', () => {
  it('moves a rigid group onto the row of one element and right of another; the frame grows', async () => {
    const before = await shapesOf(pooledHand);
    const { result, after } = await run(pooledHand, [{ op: 'place', ids: ['C', 'E2'], rowOf: 'B', after: 'E' }]);
    const drawn = shapes(after);
    expect(cy(drawn.get('C')!)).toBe(cy(drawn.get('B')!));
    expect(drawn.get('C')!.bounds.x).toBeGreaterThanOrEqual(right(drawn.get('E')!) + 40);
    // the group keeps its shape
    expect(drawn.get('E2')!.bounds.x - drawn.get('C')!.bounds.x).toBe(before.get('E2')!.bounds.x - before.get('C')!.bounds.x);
    expect(drawn.get('E2')!.bounds.y - drawn.get('C')!.bounds.y).toBe(before.get('E2')!.bounds.y - before.get('C')!.bounds.y);
    for (const id of ['C', 'E2']) expect(inside(drawn.get(id)!, drawn.get('L1')!), id).toBe(true);
    expect(inside(drawn.get('L1')!, drawn.get('Pool')!)).toBe(true);
    const formatStep = result.layout.format![0]!;
    expect(formatStep).toMatchObject({ op: 'place', index: 0 });
    expect(formatStep.moved).toEqual(expect.arrayContaining(['C', 'E2', 'L1', 'Pool']));
    expect(formatStep.rerouted).toContain('F_no');
    expect(orthogonal(edges(after).get('F_no')!)).toBe(true);
    expect(keptExcept(before, drawn, ['C', 'E2', 'L1', 'L2', 'Pool'])).toEqual([]);
    expect(hardAdded(result)).toEqual([]);
  });

  it('puts a branch one row below an element and the others give way', async () => {
    // C into row 1 right after A, where G sits: G gives way (down: nothing is pushed left), B (the row reference) slides right
    const before = await shapesOf(pooledHand);
    const { result, after } = await run(pooledHand, [{ op: 'place', ids: ['C'], rowOf: 'B', after: 'A' }]);
    const drawn = shapes(after);
    expect(cy(drawn.get('C')!)).toBe(cy(drawn.get('B')!));
    expect(cy(drawn.get('B')!)).toBe(cy(before.get('B')!));
    expect(drawn.get('C')!.bounds.x).toBe(right(before.get('A')!) + 60);
    expect(drawn.get('G')!.bounds.y).toBeGreaterThanOrEqual(bottom(drawn.get('C')!) + 20);
    expect(drawn.get('B')!.bounds.x).toBeGreaterThanOrEqual(right(drawn.get('C')!) + 20);
    expect(result.layout.format![0]!.moved).toEqual(expect.arrayContaining(['C', 'G', 'B']));
    expect(hardAdded(result)).toEqual([]);
    // onto the reference itself: no room for that
    expect(await failure(pooledHand, [{ op: 'place', ids: ['E2'], rowOf: 'E', columnOf: 'E' }])).toMatchObject({ code: 'E_NO_ROOM', element: 'E2', related: ['E', 'E'] });
    // below: one row under the element, clear of it
    const { result: r2, after: a2 } = await run(pooledHand, [{ op: 'place', ids: ['C'], below: 'A' }]);
    const redrawn = shapes(a2);
    expect(redrawn.get('C')!.bounds.y).toBeGreaterThanOrEqual(bottom(redrawn.get('A')!) + 20);
    expect(redrawn.get('C')!.bounds.x).toBe(before.get('C')!.bounds.x);
    expect(hardAdded(r2)).toEqual([]);
  });

  it('refuses to leave the lane and names the lane at the target', async () => {
    const refusal = await failure(pooledHand, [{ op: 'color', ids: ['A'], color: 'red' }, { op: 'place', ids: ['C'], rowOf: 'L2' }]);
    expect(refusal).toMatchObject({ code: 'E_LEAVES_CONTAINER', op: 1, element: 'C', related: ['L1', 'L2'] });
    expect(refusal.message).toMatch(/out of its lane L1 \(into lane L2\)/);
    expect(refusal.hint).toMatch(/move <file> C --lane L2/);
    // the last row of L1 with L2 below: no room below without leaving the lane
    expect(await failure(pooledHand, [{ op: 'place', ids: ['C'], below: 'E2' }])).toMatchObject({ code: 'E_LEAVES_CONTAINER', related: ['L1', 'L2'] });
    // before the start of the lane
    expect(await failure(pooledHand, [{ op: 'place', ids: ['A'], before: 'S' }])).toMatchObject({ code: 'E_LEAVES_CONTAINER', related: ['L1'] });
    // after a lane change in the same batch it is allowed
    const { result, after } = await run(pooledHand, [
      { op: 'move', ids: ['C'], lane: 'L2' },
      { op: 'place', ids: ['C'], rowOf: 'L2' },
    ]);
    const drawn = shapes(after);
    expect(inside(drawn.get('C')!, drawn.get('L2')!)).toBe(true);
    expect(cy(drawn.get('C')!)).toBe(cy(drawn.get('L2')!));
    expect(hardAdded(result)).toEqual([]);
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
    const { result, after } = await run(plainHand, [{ op: 'align', ids: ['A', 'C'], axis: 'column' }]);
    const drawn = shapes(after);
    expect(cx(drawn.get('C')!)).toBe(cx(drawn.get('A')!));
    expect(cy(drawn.get('C')!)).toBe(cy(before.get('C')!));
    expect(drawn.get('A')!.bounds).toEqual(before.get('A')!.bounds);
    expect(result.layout.format![0]!.rerouted).toEqual(expect.arrayContaining(['F_no']));
    for (const edge of edges(after).values()) expect(orthogonal(edge), edge.id).toBe(true);
    expect(hardAdded(result)).toEqual([]);
  });

  it('aligns on a row with an explicit reference', async () => {
    const { result, after } = await run(plainHand, [{ op: 'align', ids: ['E2', 'C'], axis: 'row', to: 'S' }]);
    const drawn = shapes(after);
    expect(cy(drawn.get('E2')!)).toBe(cy(drawn.get('S')!));
    expect(cy(drawn.get('C')!)).toBe(cy(drawn.get('S')!));
    expect(hardAdded(result)).toEqual([]);
    const done = await run(result.xml, [{ op: 'align', ids: ['E2', 'C'], axis: 'row', to: 'S' }]);
    expect(done.result.layout.format![0]).toMatchObject({ moved: [], notes: ['already aligned on the row of S'] });
  });

  it('refuses a column outside the sub-process, which would have to grow out to it (E_LEAVES_CONTAINER), and aligns inside it', async () => {
    const xml = await handXml(WITH_SUB);
    const refusal = await failure(xml, [{ op: 'align', ids: ['E', 'SE'], axis: 'column' }]);
    expect(refusal).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'SE' });
    const { result, after } = await run(xml, [{ op: 'align', ids: ['ST', 'SS'], axis: 'row', to: 'SE' }]);
    expect(cy(shapes(after).get('SS')!)).toBe(cy(shapes(after).get('SE')!));
    expect(hardAdded(result)).toEqual([]);
  });

  it('refuses to align out of the lane', async () => {
    const refusal = await failure(pooledHand, [{ op: 'align', ids: ['L2', 'A'], axis: 'row' }]);
    expect(refusal).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'A' });
  });
});

/* ------------------------------------------------------------------ */
/* label / route                                                        */
/* ------------------------------------------------------------------ */

describe('label', () => {
  it('puts the label of an event, a gateway and a flow on the requested side', async () => {
    const { result, after } = await run(pooledHand, [
      { op: 'label', id: 'E', side: 'right' },
      { op: 'label', id: 'G', side: 'below' },
      { op: 'label', id: 'F_no', side: 'right' },
    ]);
    expect(result.layout.format!.map((step) => step.labels)).toEqual([['E'], ['G'], ['F_no']]);
    const drawn = shapes(after);
    expect(drawn.get('E')!.label!.x).toBeGreaterThanOrEqual(right(drawn.get('E')!));
    expect(drawn.get('G')!.label!.y).toBeGreaterThanOrEqual(bottom(drawn.get('G')!));
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
    const { result, after } = await run(plainHand, [{ op: 'route', id: 'F_no', exit: 'bottom', entry: 'bottom' }]);
    const drawn = shapes(after);
    const edge = edges(after).get('F_no')!;
    expect(edge.points[0]!.y).toBe(bottom(drawn.get('G')!));
    expect(edge.points[edge.points.length - 1]!.y).toBe(bottom(drawn.get('C')!));
    expect(orthogonal(edge)).toBe(true);
    expect(result.layout.format).toEqual([{ op: 'route', index: 0, moved: [], rerouted: ['F_no'] }]);
    const top = await run(plainHand, [{ op: 'route', id: 'F_yes', exit: 'top', entry: 'left' }]);
    const topEdge = edges(top.after).get('F_yes')!;
    expect(topEdge.points[0]!.y).toBe(shapes(top.after).get('G')!.bounds.y);
    expect(topEdge.points[topEdge.points.length - 1]!.x).toBe(shapes(top.after).get('B')!.bounds.x);
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
    const { result, after } = await run(pooledHand, [{ op: 'space', after: 'A' }]);
    const drawn = shapes(after);
    const shift = drawn.get('G')!.bounds.x - before.get('G')!.bounds.x;
    expect(shift).toBeGreaterThanOrEqual(100);
    for (const id of ['B', 'E', 'C', 'E2']) expect(drawn.get(id)!.bounds.x - before.get(id)!.bounds.x, id).toBe(shift);
    for (const id of ['S', 'A']) expect(drawn.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(drawn.get('Pool')!.bounds.width - before.get('Pool')!.bounds.width).toBe(shift);
    expect(hardAdded(result)).toEqual([]);
    for (const edge of edges(after).values()) expect(orthogonal(edge), edge.id).toBe(true);
  });

  it('makes a lane taller with --below <lane> and pixels', async () => {
    const before = await shapesOf(pooledHand);
    const { result, after } = await run(pooledHand, [{ op: 'space', below: 'L1', by: 50 }]);
    const drawn = shapes(after);
    expect(drawn.get('L1')!.bounds.height).toBe(before.get('L1')!.bounds.height + 50);
    expect(drawn.get('L2')!.bounds.y).toBe(before.get('L2')!.bounds.y + 50);
    expect(drawn.get('Pool')!.bounds.height).toBe(before.get('Pool')!.bounds.height + 50);
    expect(keptExcept(before, drawn, ['L1', 'L2', 'Pool'])).toEqual([]);
    expect(hardAdded(result)).toEqual([]);
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
    const { result, after } = await run(xml, [{ op: 'tidy' }]);
    expect(result.layout.format![0]!.moved).toEqual([]);
    expect(keptExcept(before, shapes(after), [])).toEqual([]);
  });

  it('removes overlaps with minimal moves', async () => {
    const xml = await overlapping();
    const before = (await run(xml, [{ op: 'tidy' }])).result;
    expect(before.layout.metrics!.before!.counts.overlaps).toBe(1);
    expect(before.layout.metrics!.after.counts.overlaps).toBe(0);
    expect(before.layout.format![0]!.moved.length).toBeGreaterThan(0);
    expect(hardAdded(before)).toEqual([]);
    // only the given shapes
    const some = (await run(xml, [{ op: 'tidy', ids: ['A', 'S'] }])).result;
    expect(some.layout.metrics!.after.counts.overlaps).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* lane order                                                           */
/* ------------------------------------------------------------------ */

describe('order lanes', () => {
  it('reorders laneSet.lanes and the bands of a kept drawing; content moves with its lane', async () => {
    const before = await shapesOf(pooledHand);
    const { result, after } = await run(pooledHand, [{ op: 'order', id: 'Pool', lanes: ['L2', 'L1'] }]);
    expect(result.layout.mode).toBe('incremental');
    expect(result.changes.changed.map((change) => change.detail)).toEqual(['lane order: L2, L1']);
    const process = after.get('P')!;
    expect(process.get<El[]>('laneSets')[0]!.get<El[]>('lanes').map((lane) => lane.get<string>('id'))).toEqual(['L2', 'L1']);
    const drawn = shapes(after);
    const pool = before.get('Pool')!;
    expect(drawn.get('L2')!.bounds.y).toBe(pool.bounds.y);
    expect(drawn.get('L1')!.bounds.y).toBe(pool.bounds.y + before.get('L2')!.bounds.height);
    const dy = drawn.get('L1')!.bounds.y - before.get('L1')!.bounds.y;
    for (const id of ['S', 'A', 'G', 'B', 'E', 'C', 'E2']) {
      expect(drawn.get(id)!.bounds.y - before.get(id)!.bounds.y, id).toBe(dy);
      expect(inside(drawn.get(id)!, drawn.get('L1')!), id).toBe(true);
    }
    expect(result.layout.format![0]).toMatchObject({ op: 'order', index: 0 });
    // flows inside the lane were translated, not rerouted
    expect(result.layout.format![0]!.rerouted).toEqual([]);
    expect(edges(after).get('F_yes')!.points[0]!.y - edges(await Doc.fromXml(pooledHand)).get('F_yes')!.points[0]!.y).toBe(dy);
    expect(hardAdded(result)).toEqual([]);
    expect(result.layout.metrics!.after.score).toBe(result.layout.metrics!.before!.score);
  });

  it('accepts lane ids as positional flows (the CLI form) and redraws an engine-owned drawing in the new order', async () => {
    const { result, after } = await run(pooledEngine, [{ op: 'order', id: 'Pool', flows: ['L2'] }]);
    expect(result.layout.mode).toBe('full');
    const drawn = shapes(after);
    expect(drawn.get('L2')!.bounds.y).toBeLessThan(drawn.get('L1')!.bounds.y);
    expect(result.layout.format).toEqual([{ op: 'order', index: 0, moved: [], rerouted: [] }]);
  });

  it('orders nested lanes by their parent lane and refuses lanes of another level', async () => {
    const nested = await handXml([
      ...POOLED,
      { op: 'add', kind: 'lane', id: 'L1a', name: 'Front', in: 'L1', members: ['S', 'A', 'G'] },
      { op: 'add', kind: 'lane', id: 'L1b', name: 'Back', in: 'L1', members: ['B', 'E', 'C', 'E2'] },
    ]);
    const before = await shapesOf(nested);
    expect(before.get('L1a')!.bounds.y).toBeLessThan(before.get('L1b')!.bounds.y);
    const { result, after } = await run(nested, [{ op: 'order', id: 'L1', lanes: ['L1b', 'L1a'] }]);
    const drawn = shapes(after);
    expect(drawn.get('L1b')!.bounds.y).toBe(before.get('L1a')!.bounds.y);
    for (const id of ['S', 'A', 'G']) expect(inside(drawn.get(id)!, drawn.get('L1a')!), id).toBe(true);
    for (const id of ['B', 'E', 'C', 'E2']) expect(inside(drawn.get(id)!, drawn.get('L1b')!), id).toBe(true);
    expect(hardAdded(result)).toEqual([]);
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
  it('run in batch order, after the layout of the model commands before them', async () => {
    const { result, after } = await run(pooledHand, [
      { op: 'add', kind: 'task', id: 'X', name: 'Extra', after: 'C', before: 'E2' },
      { op: 'place', ids: ['X'], above: 'C' },
      { op: 'color', ids: ['X'], color: 'purple' },
    ]);
    expect(result.layout.mode).toBe('incremental');
    expect(result.layout.placed).toContain('X');
    expect(result.layout.format!.map((step) => `${step.op}#${step.index}`)).toEqual(['place#1', 'color#2']);
    const drawn = shapes(after);
    expect(bottom(drawn.get('X')!)).toBeLessThanOrEqual(drawn.get('C')!.bounds.y - 20);
    expect(inside(drawn.get('X')!, drawn.get('L1')!)).toBe(true);
    expect(layoutView(after.definitions).colors).toEqual([{ id: 'X', color: 'purple', fill: '#e1bee7', stroke: '#5b176d' }]);
    expect(hardAdded(result)).toEqual([]);
  });

  it('a model command after a diagram command keeps what the diagram command drew', async () => {
    const { result, after } = await run(pooledHand, [
      { op: 'add', kind: 'task', id: 'X', name: 'Extra', after: 'C', before: 'E2' },
      { op: 'place', ids: ['X'], above: 'C' },
      { op: 'add', kind: 'task', id: 'Y', name: 'Archive', after: 'B', before: 'E' },
      { op: 'color', ids: ['Y'], color: 'green' },
    ]);
    expect(result.layout.mode).toBe('incremental');
    expect(result.layout.placed).toEqual(expect.arrayContaining(['X', 'Y']));
    expect(result.layout.format!.map((step) => `${step.op}#${step.index}`)).toEqual(['place#1', 'color#3']);
    const drawn = shapes(after);
    expect(bottom(drawn.get('X')!)).toBeLessThanOrEqual(drawn.get('C')!.bounds.y - 20);
    expect(drawn.get('Y')).toBeDefined();
    expect(layoutView(after.definitions).colors.map((colored) => colored.id)).toEqual(['Y']);
    expect(hardAdded(result)).toEqual([]);
  });

  it('a diagram command cannot name an element a later command adds', async () => {
    const refused = await failure(pooledHand, [
      { op: 'place', ids: ['X'], above: 'C' },
      { op: 'add', kind: 'task', id: 'X', name: 'Extra', after: 'C', before: 'E2' },
    ]);
    expect(refused).toMatchObject({ code: 'E_NOT_FOUND', op: 0 });
  });

  it('on a new file: drawn in full first, then formatted', async () => {
    const result = await mutateDoc(Doc.create({ processId: 'P' }), [...BASE, { op: 'color', ids: ['A'], color: 'orange' }, { op: 'label', id: 'E', side: 'above' }], { dryRun: true });
    expect(result.layout.mode).toBe('full');
    expect(result.layout.format!.map((step) => step.op)).toEqual(['color', 'label']);
    expect(layoutView((await Doc.fromXml(result.xml)).definitions).labels).toEqual([{ id: 'E', side: 'above', default: 'below' }]);
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
    const { result } = await run(pooledHand, [{ op: 'color', ids: ['A'], color: 'red' }], { layout: false });
    expect(result.layout).toMatchObject({ status: 'skipped', format: [{ op: 'color', colored: ['A'] }] });
  });

  it('formatting survives later writes: colour + place, then an add in auto mode keeps both', async () => {
    // an engine-owned drawing: auto would redraw it ...
    const owned = await run(pooledEngine, [{ op: 'set', id: 'A', values: { name: 'Check order' } }]);
    expect(owned.result.layout.mode).toBe('full');
    // ... until a format op changes it
    const formatted = await run(pooledEngine, [
      { op: 'color', ids: ['A', 'F_yes'], color: 'red' },
      { op: 'place', ids: ['C', 'E2'], below: 'E', after: 'E' },
    ]);
    expect(formatted.result.layout.format![1]!.moved).toEqual(expect.arrayContaining(['C', 'E2']));
    const placed = shapes(formatted.after);
    const next = await run(formatted.result.xml, [{ op: 'add', kind: 'userTask', id: 'R', name: 'Review', after: 'B' }]);
    expect(next.result.layout).toMatchObject({ mode: 'incremental', reason: expect.stringMatching(/hand-made/) });
    const drawn = shapes(next.after);
    expect(drawn.get('R')).toBeDefined();
    // the placed branch keeps its place relative to the row it was put under (the space tool may shift the columns)
    expect(drawn.get('C')!.bounds.y).toBe(placed.get('C')!.bounds.y);
    expect(drawn.get('E2')!.bounds.y).toBe(placed.get('E2')!.bounds.y);
    expect(drawn.get('C')!.bounds.y).toBeGreaterThanOrEqual(bottom(drawn.get('E')!) + 20);
    expect(layoutView(next.after.definitions).colors.map((colored) => `${colored.id} ${colored.color}`)).toEqual(['A red', 'F_yes red']);
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
    expect(groups.map((group) => `${group.kind} ${group.id}${group.parent ? ` < ${group.parent}` : ''}`)).toEqual(['process P', 'subProcess Sub < P']);
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
      if (isBpmnError(err)) return `${err.message}${err.details.hint ? ` | ${err.details.hint}` : ''}`;
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
    expect(message([{ op: 'space', after: 'A', by: 'wide' }])).toMatch(/"by" must be "column", "row", a number of them \("2col", "3rows"\) or pixels \(an integer, "80px"\); negative \("-column", "-2col", -80\) closes space; got string "wide"/);
    expect(message([{ op: 'space', after: 'A', by: 0 }])).toMatch(/"by" must be/);
    expect(message([{ op: 'tidy', ids: [] }])).toMatch(/"ids" needs at least 1 entry/);
    expect(message([{ op: 'order', id: 'P', flows: ['a'], lanes: ['b'] }])).toMatch(/give exactly one of "flows" .*, "lanes" .* or "pools"/);
    expect(message([{ op: 'order', id: 'P' }])).toMatch(/give exactly one of "flows"/);
    expect(parseOps([{ op: 'space', after: 'A', by: '120' }])).toEqual([{ op: 'space', after: 'A', by: 120 }]);
  });

  it('are in the JSON schema and in `kinds --json`', () => {
    const defs = OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, unknown>; required: string[]; allOf?: unknown[] }>;
    for (const name of DIAGRAM_COMMAND_NAMES) expect(defs[name], name).toBeDefined();
    expect(defs['place']!.required).toEqual(['op']);
    expect(defs['place']!.allOf).toEqual(expect.arrayContaining([{ anyOf: ['ids', 'path', 'kind', 'branch'].map((key) => ({ required: [key] })) }]));
    expect(defs['place']!.allOf).toEqual(expect.arrayContaining([{ not: { required: ['rowOf', 'below'] } }, { anyOf: ['rowOf', 'below', 'above', 'columnOf', 'after', 'before'].map((key) => ({ required: [key] })) }]));
    expect(defs['space']!.properties['by']).toMatchObject({ oneOf: [{ type: 'string', pattern: expect.any(String) }, { type: 'integer', not: { const: 0 } }] });
    const pattern = new RegExp((defs['space']!.properties['by'] as { oneOf: Array<{ pattern?: string }> }).oneOf[0]!.pattern!);
    for (const ok of ['column', '-row', '2col', '2 columns', '-3rows', '80px', '120']) expect(pattern.test(ok), ok).toBe(true);
    for (const bad of ['wide', '0', '2x', 'px', '']) expect(pattern.test(bad), bad).toBe(false);
    expect(defs['color']!.properties['color']).toMatchObject({ enum: ['blue', 'orange', 'green', 'red', 'purple', 'default'] });
    expect(Object.keys(defs['order']!.properties)).toEqual(['op', 'id', 'flows', 'lanes', 'pools']);
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
