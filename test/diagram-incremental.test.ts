/**
 * The incremental layout through the write pipeline (mutateDoc): layout
 * modes, ownership detection, colour carry-over and the placement cases of
 * src/diagram/ on "hand-drawn" fixtures.
 *
 * A hand-drawn fixture is a model laid out by the clean engine whose DI is
 * then moved by a few pixels, so it is NOT engine-owned any more and `auto`
 * keeps it.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { layoutProblems } from '../src/diagram/metrics.js';
import { readPlanes, type DEdge, type DShape } from '../src/diagram/plane.js';
import { is, type El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationOptions, type MutationResult } from '../src/pipeline.js';

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

const BASE: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

const POOLED: Op[] = [
  ...BASE,
  { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' },
  { op: 'add', kind: 'lane', id: 'L1', name: 'Clerk', in: 'Pool', members: ['S', 'A', 'G', 'B', 'E', 'C', 'E2'] },
  { op: 'add', kind: 'lane', id: 'L2', name: 'Boss', in: 'Pool' },
];

const WITH_SUB: Op[] = [
  ...BASE,
  { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'B' },
  { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' },
  { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' },
  { op: 'add', kind: 'endEvent', id: 'SE', after: 'ST' },
];

/** The clean engine's drawing of `ops`. */
async function engineXml(ops: Op[]): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  expect(r.layout.mode).toBe('full');
  return r.xml;
}

/** The clean engine's drawing of `ops`, every DI coordinate moved by (dx, dy): no longer engine-owned. */
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

async function run(xml: string, ops: Op[], opts: MutationOptions = {}): Promise<{ r: MutationResult; after: Doc }> {
  const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
  const after = await Doc.fromXml(r.xml);
  expect(after.importWarnings).toEqual([]);
  return { r, after };
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

const right = (s: DShape): number => s.bounds.x + s.bounds.width;
const bottom = (s: DShape): number => s.bounds.y + s.bounds.height;
const cy = (s: DShape): number => s.bounds.y + s.bounds.height / 2;
const inside = (s: DShape, f: DShape): boolean => s.bounds.x >= f.bounds.x && s.bounds.y >= f.bounds.y && right(s) <= right(f) && bottom(s) <= bottom(f);

function orthogonal(e: DEdge): boolean {
  return e.points.length >= 2 && e.points.every((p, i) => i === 0 || p.x === e.points[i - 1]!.x || p.y === e.points[i - 1]!.y);
}

/** Problems a mutation added, by kind (kinds listed in `allowed` are not checked). */
function addedKinds(r: MutationResult): string[] {
  return (r.layout.metrics?.added ?? []).map((p) => p.kind);
}

/* ------------------------------------------------------------------ */
/* modes                                                                */
/* ------------------------------------------------------------------ */

describe('layout modes', () => {
  it('auto draws a file without any diagram in full', async () => {
    const xml = (await engineXml(BASE)).replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '');
    const { r, after } = await run(xml, [{ op: 'set', id: 'A', values: { name: 'Check order' } }]);
    expect(r.layout).toMatchObject({ status: 'ok', mode: 'full', reason: expect.stringMatching(/no diagram/) });
    expect(r.layout.metrics?.before).toBeUndefined();
    expect(layoutProblems(after.definitions).counts.missing).toBe(0);
  });

  it('auto redraws an engine-owned diagram in full (every CLI-built step stays engine-owned)', async () => {
    let xml = (await mutateDoc(Doc.create({ processId: 'P' }), [], { dryRun: true })).xml;
    for (const op of BASE) {
      const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), [op], { dryRun: true });
      expect(r.layout.mode).toBe('full');
      xml = r.xml;
    }
    const { r } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }]);
    expect(r.layout).toMatchObject({ mode: 'full', reason: expect.stringMatching(/engine-owned/) });
    expect(xml).toBe(await engineXml(BASE));
  });

  it('auto keeps a hand-made diagram (incremental); full and incremental can be forced', async () => {
    const xml = await handXml(BASE);
    const op: Op = { op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' };
    expect((await run(xml, [op])).r.layout).toMatchObject({ mode: 'incremental', reason: expect.stringMatching(/hand-made/) });
    expect((await run(xml, [op], { layout: 'full' })).r.layout.mode).toBe('full');
    expect((await run(xml, [op], { layout: true })).r.layout.mode).toBe('incremental');
    expect((await run(await engineXml(BASE), [op], { layout: 'incremental' })).r.layout.mode).toBe('incremental');
    const skipped = (await run(xml, [op], { layout: false })).r.layout;
    expect(skipped.status).toBe('skipped');
    expect(skipped.metrics?.added.map((p) => p.kind)).toContain('missing');
  });

  it('reports the metrics before and after with the problems added and resolved', async () => {
    const { r } = await run(await handXml(BASE), [{ op: 'add', kind: 'task', id: 'N', after: 'A' }]);
    const m = r.layout.metrics!;
    expect(m.before).toMatchObject({ score: 0 });
    expect(m.after.counts).toHaveProperty('crossings');
    expect(m.added).toEqual([]);
    expect(m.resolved).toEqual([]);
  });

  it('carries colours over a full redraw and keeps them in an incremental one', async () => {
    const colour = (xml: string): string => xml.replace(/(<bpmndi:BPMNShape id="\w+" bpmnElement="A")/, '$1 bioc:fill="#ffcdd2" bioc:stroke="#831311" color:background-color="#ffcdd2" color:border-color="#831311"').replace('<bpmn:definitions ', '<bpmn:definitions xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" ');
    const op: Op = { op: 'add', kind: 'task', id: 'N', after: 'A' };
    for (const [xml, layout] of [
      [colour(await handXml(BASE)), 'full'],
      [colour(await engineXml(BASE)), 'auto'],
      [colour(await handXml(BASE)), 'incremental'],
    ] as const) {
      const { r } = await run(xml, [op], { layout });
      expect(r.xml).toMatch(/bpmnElement="A" [^>]*bioc:fill="#ffcdd2"/);
      expect(r.xml).toMatch(/bpmnElement="A" [^>]*color:border-color="#831311"/);
    }
  });

  it('is deterministic', async () => {
    const xml = await handXml(POOLED);
    const ops: Op[] = [
      { op: 'add', kind: 'task', id: 'N', after: 'A' },
      { op: 'add', kind: 'boundaryEvent:timer', id: 'T', on: 'B', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', id: 'TE', after: 'T' },
    ];
    expect((await run(xml, ops)).r.xml).toBe((await run(xml, ops)).r.xml);
  });
});

/* ------------------------------------------------------------------ */
/* placement                                                            */
/* ------------------------------------------------------------------ */

describe('incremental placement', () => {
  it('splices a task: shapes left of the insertion keep their bounds, the rest shifts one column', async () => {
    const xml = await handXml(BASE);
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'add', kind: 'userTask', id: 'N', name: 'New', after: 'A' }]);
    const now = shapes(after);
    const a = before.get('A')!;
    const n = now.get('N')!;
    expect(r.layout.placed).toContain('N');
    expect(n.bounds).toMatchObject({ width: 100, height: 80 });
    expect(n.bounds.x).toBeGreaterThan(right(a));
    expect(cy(n)).toBe(cy(a));
    for (const [id, s] of before) {
      if (s.container) continue;
      if (s.bounds.x < right(a) + 1) expect(now.get(id)!.bounds, id).toEqual(s.bounds);
      else {
        expect(now.get(id)!.bounds.y, id).toBe(s.bounds.y);
        expect(now.get(id)!.bounds.x, id).toBeGreaterThan(s.bounds.x);
      }
    }
    expect(now.get('G')!.bounds.x).toBeGreaterThanOrEqual(right(n) + 20);
    const m = layoutProblems(after.definitions);
    expect(m.counts.overlaps).toBe(0);
    expect(m.counts.missing).toBe(0);
    expect(m.score).toBe(0);
    const incident = [...edges(after).values()].filter((e) => e.sourceId === 'N' || e.targetId === 'N');
    expect(incident).toHaveLength(2);
    for (const e of incident) expect(orthogonal(e)).toBe(true);
  });

  it('places a new gateway branch on a free row below the existing ones', async () => {
    const xml = await handXml(BASE);
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [
      { op: 'add', kind: 'task', id: 'N', name: 'Third', after: 'G', flowName: 'maybe' },
      { op: 'add', kind: 'endEvent', id: 'NE', after: 'N' },
    ]);
    const now = shapes(after);
    expect(cy(now.get('N')!)).toBeGreaterThan(cy(before.get('C')!));
    expect(now.get('N')!.bounds.x).toBeGreaterThan(right(before.get('G')!));
    expect(cy(now.get('NE')!)).toBe(cy(now.get('N')!));
    for (const id of ['S', 'A', 'G', 'B', 'E', 'C', 'E2']) expect(now.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(addedKinds(r).filter((k) => k !== 'labelOnLine')).toEqual([]);
  });

  it('hangs a boundary event on the host\'s bottom border and its handler one row below', async () => {
    const xml = await handXml(BASE);
    const { r, after } = await run(xml, [
      { op: 'add', kind: 'boundaryEvent:timer', id: 'T', name: 'Late', on: 'A', timer: 'PT1H' },
      { op: 'add', kind: 'boundaryEvent:message', id: 'T2', on: 'A', message: 'Cancel' },
      { op: 'add', kind: 'endEvent', id: 'TE', name: 'Timed out', after: 'T' },
    ]);
    const now = shapes(after);
    const a = now.get('A')!;
    const t = now.get('T')!;
    const t2 = now.get('T2')!;
    expect(cy(t)).toBe(bottom(a));
    expect(cy(t2)).toBe(bottom(a));
    expect(right(t)).toBeLessThanOrEqual(right(a));
    expect(t2.bounds.x).toBeLessThan(t.bounds.x);
    expect(t.label).toBeDefined();
    expect(now.get('TE')!.bounds.y).toBeGreaterThan(bottom(a));
    const flow = [...edges(after).values()].find((e) => e.sourceId === 'T')!;
    expect(flow.points[0]!.y).toBe(bottom(t));
    expect(addedKinds(r)).not.toContain('overlaps');
    expect(addedKinds(r)).not.toContain('through');
  });

  it('prepends before a node without predecessor and adds unconnected nodes below the content', async () => {
    const xml = await handXml(BASE);
    const before = shapes(await Doc.fromXml(xml));
    const { after } = await run(xml, [
      { op: 'remove', ids: ['S'] },
      { op: 'add', kind: 'startEvent', id: 'S2', name: 'New start', before: 'A' },
      { op: 'add', kind: 'task', id: 'U', name: 'Lonely' },
    ]);
    const now = shapes(after);
    expect(right(now.get('S2')!)).toBeLessThan(now.get('A')!.bounds.x);
    expect(cy(now.get('S2')!)).toBe(cy(now.get('A')!));
    const contentBottom = Math.max(...[...before.values()].map(bottom));
    expect(now.get('U')!.bounds.y).toBeGreaterThan(contentBottom);
    expect(now.get('U')!.bounds.x).toBe(Math.min(...[...now.values()].filter((s) => s.id !== 'U' && s.kind !== 'boundary').map((s) => s.bounds.x)));
  });

  it('removes and bridges: the empty strip closes, the bridge is rerouted straight', async () => {
    const xml = await handXml(BASE);
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'remove', ids: ['A'] }]);
    const now = shapes(after);
    expect(r.layout.pruned).toContain('A');
    expect(now.get('S')!.bounds).toEqual(before.get('S')!.bounds);
    expect(now.get('G')!.bounds.x).toBeLessThan(before.get('G')!.bounds.x);
    const bridge = [...edges(after).values()].find((e) => e.sourceId === 'S')!;
    expect(bridge.targetId).toBe('G');
    expect(bridge.points).toHaveLength(2);
    expect(layoutProblems(after.definitions).score).toBe(0);
  });

  it('moves a node to another lane band keeping its x, everything else stays', async () => {
    const xml = await handXml(POOLED);
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'set', id: 'B', values: { lane: 'L2' } }]);
    const now = shapes(after);
    expect(now.get('B')!.bounds.x).toBe(before.get('B')!.bounds.x);
    expect(inside(now.get('B')!, now.get('L2')!)).toBe(true);
    for (const id of ['S', 'A', 'G', 'E', 'C', 'E2', 'Pool', 'L1', 'L2']) expect(now.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(r.layout.moved).toEqual(['B']);
    // the rerouted branch leaves G by its free right vertex (not beside "no" at the bottom): it crosses "no" on
    // its way down, the only problem it may add
    const g = now.get('G')!.bounds;
    const starts = [...edges(after).values()].filter((e) => e.sourceId === 'G').map((e) => e.points[0]!);
    expect(starts).toHaveLength(2);
    for (const p of starts) expect([`${g.x + g.width},${g.y + g.height / 2}`, `${g.x + g.width / 2},${g.y + g.height}`]).toContain(`${p.x},${p.y}`);
    expect(new Set(starts.map((p) => `${p.x},${p.y}`)).size).toBe(2);
    expect(addedKinds(r).filter((k) => k !== 'crossings')).toEqual([]);
  });

  it('draws a new lane at the bottom of its pool and moves its members into it', async () => {
    const xml = await handXml(POOLED);
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'add', kind: 'lane', id: 'L3', name: 'Third', in: 'Pool', members: ['C'] }]);
    const now = shapes(after);
    const l3 = now.get('L3')!;
    expect(l3.bounds.y).toBe(bottom(before.get('L2')!));
    expect(bottom(now.get('Pool')!)).toBe(bottom(l3));
    expect(inside(now.get('C')!, l3)).toBe(true);
    expect(layoutProblems(after.definitions).counts.laneGap).toBe(0);
    expect(r.layout.placed).toContain('L3');
  });

  it('wraps the process in its first pool and stacks a further pool below', async () => {
    const xml = await handXml(BASE);
    const before = shapes(await Doc.fromXml(xml));
    let { after } = await run(xml, [{ op: 'add', kind: 'participant', id: 'Pool', name: 'Org' }]);
    let now = shapes(after);
    for (const id of ['S', 'A', 'G', 'B', 'E', 'C', 'E2']) {
      expect(now.get(id)!.bounds).toEqual(before.get(id)!.bounds);
      expect(inside(now.get(id)!, now.get('Pool')!)).toBe(true);
    }
    const plane = after.definitions.get<El[]>('diagrams')[0]!.get<El>('plane');
    expect(is(plane.get('bpmnElement'), 'bpmn:Collaboration')).toBe(true);
    ({ after } = await run(await after.toXml(), [
      { op: 'add', kind: 'participant', id: 'Cust', name: 'Customer', blackBox: true },
      { op: 'connect', source: 'B', target: 'Cust', name: 'invoice' },
    ]));
    now = shapes(after);
    expect(now.get('Cust')!.bounds.y).toBeGreaterThan(bottom(now.get('Pool')!));
    expect(now.get('Cust')!.bounds.width).toBe(now.get('Pool')!.bounds.width);
    const mf = [...edges(after).values()].find((e) => e.kind === 'messageFlow')!;
    expect(orthogonal(mf)).toBe(true);
    expect(layoutProblems(after.definitions).counts.missing).toBe(0);
  });

  it('lays out a new pool with content as one block below the others', async () => {
    const { after } = await run(await handXml(POOLED), [
      { op: 'add', kind: 'participant', id: 'Sup', name: 'Supplier' },
      { op: 'add', kind: 'startEvent', id: 'SupS', name: 'Got', in: 'Sup' },
      { op: 'add', kind: 'task', id: 'SupT', name: 'Ship', after: 'SupS' },
    ]);
    const now = shapes(after);
    for (const id of ['SupS', 'SupT']) expect(inside(now.get(id)!, now.get('Sup')!)).toBe(true);
    expect(now.get('Sup')!.bounds.y).toBeGreaterThan(bottom(now.get('Pool')!));
    expect(layoutProblems(after.definitions).score).toBe(0);
  });

  it('places a new expanded sub-process with content as one block, a collapsed one on its own diagram', async () => {
    const sub: Op[] = [
      { op: 'add', kind: 'subProcess', id: 'NS', name: 'New sub', after: 'B' },
      { op: 'add', kind: 'startEvent', id: 'NSS', in: 'NS' },
      { op: 'add', kind: 'task', id: 'NST', name: 'Do', after: 'NSS' },
    ];
    let { after } = await run(await handXml(BASE), sub);
    let now = shapes(after);
    expect(now.get('NS')).toMatchObject({ expanded: true });
    for (const id of ['NSS', 'NST']) expect(inside(now.get(id)!, now.get('NS')!)).toBe(true);
    expect(now.get('E')!.bounds.x).toBeGreaterThan(right(now.get('NS')!));
    expect(layoutProblems(after.definitions).score).toBe(0);
    ({ after } = await run(await handXml(BASE), [{ ...sub[0]!, collapsed: true } as Op, ...sub.slice(1)]));
    now = shapes(after);
    expect(now.get('NS')).toMatchObject({ expanded: false, bounds: { width: 100, height: 80 } });
    const planes = readPlanes(after.definitions);
    expect(planes.map((p) => p.rootId)).toEqual(['P', 'NS']);
    expect([...planes[1]!.shapes.keys()].sort()).toEqual(['NSS', 'NST']);
  });

  it('collapses an expanded sub-process onto its own diagram and closes the freed strip', async () => {
    const xml = await handXml([
      { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
      { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'S' },
      { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' },
      { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' },
      { op: 'add', kind: 'endEvent', id: 'SE', after: 'ST' },
      { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'Sub' },
    ]);
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'set', id: 'Sub', values: { expanded: 'false' } }]);
    const now = shapes(after);
    expect(now.get('Sub')).toMatchObject({ expanded: false, bounds: { x: before.get('Sub')!.bounds.x, width: 100, height: 80 } });
    expect(now.get('E')!.bounds.x).toBeLessThan(before.get('E')!.bounds.x);
    const planes = readPlanes(after.definitions);
    expect(planes[1]!.rootId).toBe('Sub');
    expect([...planes[1]!.shapes.keys()].sort()).toEqual(['SE', 'SS', 'ST']);
    expect(r.layout.notes).toContain('Sub drawn collapsed');
    expect(layoutProblems(after.definitions).score).toBe(0);
  });

  it('expands a collapsed sub-process: its diagram moves in and the drawing makes room', async () => {
    const collapsed: Op[] = [...BASE.slice(0, 5), { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'B', collapsed: true }, { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' }, { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' }];
    const xml = await handXml(collapsed);
    const before = shapes(await Doc.fromXml(xml));
    expect(readPlanes((await Doc.fromXml(xml)).definitions)).toHaveLength(2);
    const { r, after } = await run(xml, [{ op: 'set', id: 'Sub', values: { expanded: 'true' } }]);
    const now = shapes(after);
    const sub = now.get('Sub')!;
    expect(sub).toMatchObject({ expanded: true, container: true });
    expect(sub.bounds.x).toBe(before.get('Sub')!.bounds.x);
    for (const id of ['SS', 'ST']) expect(inside(now.get(id)!, sub)).toBe(true);
    expect(now.get('E')!.bounds.x).toBeGreaterThan(right(sub));
    expect(readPlanes(after.definitions)).toHaveLength(1);
    expect(r.layout.notes).toContain('Sub drawn expanded');
    const m = layoutProblems(after.definitions);
    expect(m.counts.overlaps).toBe(0);
    expect(m.counts.outsideSub).toBe(0);
  });

  it('shrinks a sub-process retyped to a task and drops the DI of its content', async () => {
    const { r, after } = await run(await handXml(WITH_SUB), [{ op: 'retype', id: 'Sub', kind: 'task' }], { force: true }); // deleting the content needs --force
    const now = shapes(after);
    expect(now.get('Sub')).toMatchObject({ kind: 'task', container: false, bounds: { width: 100, height: 80 } });
    expect(r.layout.pruned).toEqual(expect.arrayContaining(['SS', 'ST', 'SE']));
    expect(r.xml).not.toMatch(/bpmnElement="Sub" isExpanded/);
    expect(layoutProblems(after.definitions).score).toBe(0);
  });

  it('re-inserts a moved node at its new place, reusing its DI', async () => {
    const xml = await handXml(BASE);
    const diId = /<bpmndi:BPMNShape id="(\w+)" bpmnElement="C"/.exec(xml)![1];
    const { r, after } = await run(xml, [{ op: 'move', ids: ['C'], after: 'A' }]);
    const now = shapes(after);
    expect(r.xml).toContain(`<bpmndi:BPMNShape id="${diId}" bpmnElement="C"`);
    expect(cy(now.get('C')!)).toBe(cy(now.get('A')!));
    expect(now.get('C')!.bounds.x).toBeGreaterThan(right(now.get('A')!));
    expect(now.get('G')!.bounds.x).toBeGreaterThan(right(now.get('C')!));
    expect(r.layout.moved).toContain('C');
    expect(r.layout.placed).not.toContain('C');
    expect(layoutProblems(after.definitions).score).toBe(0);
  });

  it('places artifacts next to their element: data below-right, annotations above-right', async () => {
    const { after } = await run(await handXml(BASE), [
      { op: 'add', kind: 'dataObject', id: 'D', name: 'Order', to: 'A' },
      { op: 'add', kind: 'textAnnotation', id: 'N', text: 'Check carefully', to: 'A' },
    ]);
    const now = shapes(after);
    const a = now.get('A')!;
    expect(now.get('D')!.bounds.y).toBeGreaterThan(bottom(a));
    expect(now.get('D')!.bounds.x).toBeGreaterThanOrEqual(a.bounds.x);
    expect(bottom(now.get('N')!)).toBeLessThan(a.bounds.y);
    expect(now.get('N')!.bounds.x).toBeGreaterThan(a.bounds.x);
    const m = layoutProblems(after.definitions);
    expect(m.counts.missing).toBe(0);
    expect(m.counts.overlaps).toBe(0);
  });

  it('resizes the label of a renamed event and keeps it below the event', async () => {
    const xml = await handXml(BASE);
    const before = shapes(await Doc.fromXml(xml));
    const { after } = await run(xml, [{ op: 'set', id: 'E', values: { name: 'Everything has been booked and archived' } }]);
    const e = shapes(after).get('E')!;
    expect(e.bounds).toEqual(before.get('E')!.bounds);
    expect(e.label!.y).toBeGreaterThanOrEqual(bottom(e));
    expect(e.label!.height).toBeGreaterThan(before.get('E')!.label!.height);
  });

  it('keeps the shape of an element whose id was renamed', async () => {
    const xml = await handXml(BASE);
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'set', id: 'C', values: { id: 'Activity_Clarify' } }]);
    expect(shapes(after).get('Activity_Clarify')!.bounds).toEqual(before.get('C')!.bounds);
    expect(r.layout.placed).toEqual([]);
    expect(r.layout.moved).toEqual([]);
  });
});
