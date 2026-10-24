/**
 * The incremental layout through the write pipeline (mutateDoc): layout
 * modes, ownership detection, colour carry-over and the placement cases of
 * src/diagram/ on "hand-drawn" fixtures.
 *
 * A hand-drawn fixture is a model laid out by the clean engine whose DI is
 * then moved by a few pixels, so it is NOT engine-owned any more and `auto`
 * keeps it. The last block covers stale edges: a flow whose ends changed
 * under --no-layout loses its edge, an edge that does not reach its ends is
 * rerouted by the next write.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model/document.js';
import { LayoutAnalysis } from '../src/diagram/LayoutAnalysis.js';
import { DiagramReader } from '../src/diagram/DiagramReader.js';
import { type DEdge, type DShape } from '../src/diagram/types.js';
import { Drawing } from '../src/diagram/Drawing.js';
import { is, type El } from '../src/model/utils/moddle.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationOptions, type MutationResult } from '../src/pipeline/index.js';

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

/** The clean engine's drawing of `ops`, changed by hand (`redraw`) and every DI coordinate moved by (dx, dy): no longer engine-owned. */
async function handXml(ops: Op[], dx = 13, dy = 7, redraw?: (doc: Doc) => void): Promise<string> {
  const doc = await Doc.fromXml(await engineXml(ops));
  redraw?.(doc);
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
  for (const p of new DiagramReader(doc.definitions).planes()) for (const s of p.shapes.values()) out.set(s.id, s);
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const p of new DiagramReader(doc.definitions).planes()) for (const e of p.edges.values()) out.set(e.id, e);
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
    expect(LayoutAnalysis.of(after.definitions).counts.missing).toBe(0);
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
    const m = LayoutAnalysis.of(after.definitions);
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

  describe('a new branch into a join enters from below, sharing the bottom vertex with the other entries', () => {
    const SPLIT3: Op[] = [
      { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
      { op: 'add', kind: 'task', id: 'A', name: 'Check', after: 'S' },
      { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'A' },
    ];
    const split = (lanes: boolean): Op => ({
      op: 'split',
      after: 'A',
      kind: 'parallelGateway',
      id: 'G',
      joinId: 'GJ',
      branches: [
        { nodes: [{ kind: 'task', id: 'T1', name: 'Archive' }] },
        { nodes: [{ kind: 'task', id: 'T2', name: 'Approve', ...(lanes ? { lane: 'L2' } : {}) }] },
        { nodes: [{ kind: 'task', id: 'T3', name: 'Book', ...(lanes ? { lane: 'L3' } : {}) }, { kind: 'task', id: 'T4', name: 'Pay', ...(lanes ? { lane: 'L3' } : {}) }] },
      ],
    });
    /** where the flow from `source` into the join ends, and the join's bottom vertex */
    const entry = (after: Doc, source: string): { end: string; bottom: string } => {
      const j = shapes(after).get('GJ')!;
      const e = [...edges(after).values()].find((x) => x.sourceId === source && x.targetId === 'GJ')!;
      const end = e.points[e.points.length - 1]!;
      return { end: `${end.x},${end.y}`, bottom: `${j.bounds.x + j.bounds.width / 2},${bottom(j)}` };
    };

    it('a 4th branch of a parallel split rises into the bottom vertex beside the others: no segmentOverlap, the score stays', async () => {
      const xml = await handXml([...SPLIT3, split(false)]);
      const { r, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'Notify', after: 'G', to: 'GJ' }]);
      expect(r.layout.mode).toBe('incremental');
      for (const source of ['T2', 'T4', 'N']) {
        const { end, bottom: vertex } = entry(after, source);
        expect(end, source).toBe(vertex);
      }
      expect(LayoutAnalysis.of(after.definitions).counts.segmentOverlap).toBe(0);
      expect(r.layout.metrics!.after.score).toBe(r.layout.metrics!.before!.score);
      expect(addedKinds(r)).toEqual([]);
    });

    it('lanes: a new branch in a lower lane rises into the bottom vertex of the join, not over the top into its top vertex', async () => {
      const xml = await handXml([
        ...SPLIT3,
        { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Clerk', in: 'Pool', members: ['S', 'A', 'E'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Boss', in: 'Pool' },
        { op: 'add', kind: 'lane', id: 'L3', name: 'Accounting', in: 'Pool' },
        split(true),
      ]);
      const { r, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'Audit', after: 'G', to: 'GJ', lane: 'L2' }]);
      expect(r.layout.mode).toBe('incremental');
      const { end, bottom: vertex } = entry(after, 'N');
      expect(end).toBe(vertex);
      expect(addedKinds(r)).toEqual([]);
    });

    /**
     * A join GJ drawn by hand as the engine drew it before it kept a join's column free: the end event EL right
     * below it, the entries from below rising in the column gap right of it and hooking into its bottom vertex.
     */
    const hookBundle = (doc: Doc): void => {
      const planeElements = doc.definitions.get<El[]>('diagrams')[0]!.get<El>('plane').get<El[]>('planeElement');
      const di = (id: string): El => planeElements.find((pe) => pe.get<El>('bpmnElement').get<string>('id') === id)!;
      const num = (el: El, key: string): number => el.get<number>(key);
      const j = di('GJ').get<El>('bounds'), el = di('EL').get<El>('bounds');
      const jx = num(j, 'x') + num(j, 'width') / 2, jb = num(j, 'y') + num(j, 'height');
      const dx = jx - (num(el, 'x') + num(el, 'width') / 2);
      for (const b of [el, di('EL').get<El | undefined>('label')?.get<El>('bounds')]) b?.set('x', num(b, 'x') + dx);
      const point = (x: number, y: number): El => doc.moddle.create('dc:Point', { x, y }) as El;
      for (const pe of planeElements) {
        const flow = pe.get<El>('bpmnElement');
        if (!is(flow, 'bpmn:SequenceFlow')) continue;
        const pts = pe.get<El[]>('waypoint');
        const target = flow.get<El>('targetRef').get<string>('id');
        if (target === 'EL') pts.at(-1)!.set('x', num(pts.at(-1)!, 'x') + dx);
        if (target !== 'GJ' || num(pts.at(-1)!, 'y') !== jb) continue;
        // along the source's row into the gap right of the join, up it, a 15 px hook into the bottom vertex
        const gapX = num(j, 'x') + num(j, 'width') + 30, y = num(pts[0]!, 'y');
        pe.set('waypoint', [pts[0]!, point(gapX, y), point(gapX, jb + 15), point(jx, jb + 15), point(jx, jb)]);
      }
    };

    it('a hook bundle (the entries rise beside the join, over an end event below it, and hook into its bottom vertex): a new branch in a lower lane joins the whole bundle, touching no other vertex', async () => {
      // the maintainer's order model in small, its boundary path ending right below the join, drawn by hand with every entry hooked in
      const xml = await handXml([
        ...SPLIT3,
        { op: 'split', after: 'A', kind: 'parallelGateway', id: 'G', joinId: 'GJ', branches: [{ nodes: [{ kind: 'task', id: 'T1', name: 'Pick' }, { kind: 'task', id: 'T1b', name: 'Pack' }] }, { nodes: [{ kind: 'task', id: 'T2', name: 'Invoice' }] }, { nodes: [{ kind: 'task', id: 'T3', name: 'Label' }] }] },
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'Late', on: 'T1', timer: 'P2D', nonInterrupting: true },
        { op: 'add', kind: 'sendTask', id: 'TL', name: 'Inform', after: 'BT' },
        { op: 'add', kind: 'endEvent', id: 'EL', name: 'Informed', after: 'TL' },
        { op: 'add', kind: 'participant', id: 'Pool', name: 'Shop' },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Service', in: 'Pool', members: ['S', 'A', 'E', 'G', 'GJ', 'TL', 'EL'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Store', in: 'Pool', members: ['T1', 'T1b', 'T3'] },
        { op: 'add', kind: 'lane', id: 'L3', name: 'Accounting', in: 'Pool', members: ['T2'] },
      ], 13, 7, hookBundle);
      const into = (doc: Doc, source: string): DEdge => [...edges(doc).values()].find((x) => x.sourceId === source && x.targetId === 'GJ')!;
      const before = await Doc.fromXml(xml);
      expect(LayoutAnalysis.of(before.definitions).problems.filter((p) => ['through', 'overlaps'].includes(p.kind))).toEqual([]);
      const hook = into(before, 'T2').points;
      const j = shapes(before).get('GJ')!;
      expect(hook.at(-1)).toEqual({ x: j.bounds.x + j.bounds.width / 2, y: bottom(j) });
      expect(hook.at(-3)!.x, 'the bundle rises right of the join').toBeGreaterThan(right(j));
      const { r, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'Customs', after: 'G', to: 'GJ', lane: 'L3' }], { layout: 'incremental' });
      expect(r.layout.mode).toBe('incremental');
      const pts = into(after, 'N').points;
      // up the bundle's column, along its hook into the shared bottom vertex
      expect(pts.slice(-3)).toEqual(hook.slice(-3));
      expect(pts.at(-4)!.x).toBe(hook.at(-3)!.x);
      // no other vertex of the join on the way (not along its box under the diamond)
      const through = (v: { x: number; y: number }): boolean => pts.slice(1).some((q, i) => {
        const p = pts[i]!;
        return p.x === q.x ? v.x === p.x && v.y >= Math.min(p.y, q.y) && v.y <= Math.max(p.y, q.y) : v.y === p.y && v.x >= Math.min(p.x, q.x) && v.x <= Math.max(p.x, q.x);
      });
      for (const v of [{ x: j.bounds.x + j.bounds.width / 2, y: j.bounds.y }, { x: right(j), y: cy(j) }, { x: j.bounds.x, y: cy(j) }]) expect(through(v), JSON.stringify(pts)).toBe(false);
      expect(addedKinds(r)).toEqual([]);
      expect(r.layout.metrics!.after.score).toBe(r.layout.metrics!.before!.score);
    });

    it('sharing the bottom vertex never costs a crossing: an entry that would cross a line to reach it takes the free top vertex', async () => {
      // s24 / s20: a task after a decision back into a join whose bottom vertex a loop or branch already enters
      const scenario = (name: string): string => readFileSync(join(import.meta.dirname, '..', 'tools', 'scenarios', name), 'utf8');
      for (const [file, from, into] of [
        ['controlflow__s24.bpmn', 'Gateway_Release', 'Gateway_Work_join'],
        ['controlflow__s20.bpmn', 'Gateway_Agrees', 'Gateway_Sev_join'],
      ] as const) {
        const { r, after } = await run(scenario(file), [{ op: 'add', kind: 'task', id: 'N', name: 'New work', after: from, to: into }], { layout: 'incremental' });
        expect(addedKinds(r), file).toEqual([]);
        // routing the new entry again keeps it so
        const flow = [...edges(after).values()].find((e) => e.sourceId === 'N' && e.targetId === into)!;
        const again = await run(r.xml, [{ op: 'route', id: flow.id }], { layout: 'incremental' });
        expect(addedKinds(again.r), file).toEqual([]);
        expect(again.r.layout.metrics!.after.score, file).toBe(r.layout.metrics!.after.score);
      }
    });
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
    expect(LayoutAnalysis.of(after.definitions).score).toBe(0);
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
    expect(LayoutAnalysis.of(after.definitions).counts.laneGap).toBe(0);
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
    expect(LayoutAnalysis.of(after.definitions).counts.missing).toBe(0);
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
    expect(LayoutAnalysis.of(after.definitions).score).toBe(0);
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
    expect(LayoutAnalysis.of(after.definitions).score).toBe(0);
    ({ after } = await run(await handXml(BASE), [{ ...sub[0]!, collapsed: true } as Op, ...sub.slice(1)]));
    now = shapes(after);
    expect(now.get('NS')).toMatchObject({ expanded: false, bounds: { width: 100, height: 80 } });
    const planes = new DiagramReader(after.definitions).planes();
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
    const planes = new DiagramReader(after.definitions).planes();
    expect(planes[1]!.rootId).toBe('Sub');
    expect([...planes[1]!.shapes.keys()].sort()).toEqual(['SE', 'SS', 'ST']);
    expect(r.layout.notes).toContain('Sub drawn collapsed');
    expect(LayoutAnalysis.of(after.definitions).score).toBe(0);
  });

  it('expands a collapsed sub-process: its diagram moves in and the drawing makes room', async () => {
    const collapsed: Op[] = [...BASE.slice(0, 5), { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'B', collapsed: true }, { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' }, { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' }];
    const xml = await handXml(collapsed);
    const before = shapes(await Doc.fromXml(xml));
    expect(new DiagramReader((await Doc.fromXml(xml)).definitions).planes()).toHaveLength(2);
    const { r, after } = await run(xml, [{ op: 'set', id: 'Sub', values: { expanded: 'true' } }]);
    const now = shapes(after);
    const sub = now.get('Sub')!;
    expect(sub).toMatchObject({ expanded: true, container: true });
    expect(sub.bounds.x).toBe(before.get('Sub')!.bounds.x);
    for (const id of ['SS', 'ST']) expect(inside(now.get(id)!, sub)).toBe(true);
    expect(now.get('E')!.bounds.x).toBeGreaterThan(right(sub));
    expect(new DiagramReader(after.definitions).planes()).toHaveLength(1);
    expect(r.layout.notes).toContain('Sub drawn expanded');
    const m = LayoutAnalysis.of(after.definitions);
    expect(m.counts.overlaps).toBe(0);
    expect(m.counts.outsideSub).toBe(0);
  });

  it('shrinks a sub-process retyped to a task and drops the DI of its content', async () => {
    const { r, after } = await run(await handXml(WITH_SUB), [{ op: 'retype', id: 'Sub', kind: 'task' }], { force: true }); // deleting the content needs --force
    const now = shapes(after);
    expect(now.get('Sub')).toMatchObject({ kind: 'task', container: false, bounds: { width: 100, height: 80 } });
    expect(r.layout.pruned).toEqual(expect.arrayContaining(['SS', 'ST', 'SE']));
    expect(r.xml).not.toMatch(/bpmnElement="Sub" isExpanded/);
    expect(LayoutAnalysis.of(after.definitions).score).toBe(0);
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
    expect(LayoutAnalysis.of(after.definitions).score).toBe(0);
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
    const m = LayoutAnalysis.of(after.definitions);
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

  it('an engine drawing with a boundary event on its host\'s top border (its way over the top) stays editable: a task after its target, a task into its flow and a reroute keep the event there and its flow leaving it by its top', async () => {
    // the clean engine puts Payment failed on Pick invoice's top border (layout/clean/place.ts boundariesOnTop); Rejected,
    // whose handler lies below, stays on the bottom border
    const ops: Op[] = [
      { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
      { op: 'add', kind: 'userTask', id: 'A1', name: 'Pick invoice', after: 'S' },
      { op: 'split', after: 'A1', kind: 'parallelGateway', id: 'G2', joinId: 'J3', branches: [{ nodes: [{ kind: 'task', id: 'T4', name: 'Pack order' }, { kind: 'sendTask', id: 'T5', name: 'Inform order' }] }, { nodes: [{ kind: 'serviceTask', id: 'T6', name: 'Notify data' }, { kind: 'task', id: 'T7', name: 'Book data' }] }] },
      { op: 'add', kind: 'task', id: 'F', name: 'Pack data', after: 'J3' },
      { op: 'add', kind: 'endEvent', id: 'E', name: 'End', after: 'F' },
      { op: 'add', kind: 'boundaryEvent:timer', id: 'BE12', on: 'A1', name: 'Payment failed', timer: 'P2D', nonInterrupting: true },
      { op: 'connect', source: 'BE12', target: 'F' },
      { op: 'add', kind: 'boundaryEvent:error', id: 'BE13', on: 'A1', name: 'Rejected', error: 'Fail' },
      { op: 'add', kind: 'task', id: 'H', name: 'Call customer', after: 'BE13' },
      { op: 'add', kind: 'endEvent', id: 'HE', name: 'Called', after: 'H' },
    ];
    const xml = await engineXml(ops);
    const doc = await Doc.fromXml(xml);
    const drawn = shapes(doc);
    const ev = drawn.get('BE12')!;
    const cx = (s: DShape): number => s.bounds.x + s.bounds.width / 2;
    expect(cy(ev), 'on the top border').toBe(drawn.get('A1')!.bounds.y);
    expect(cy(drawn.get('BE13')!), 'Rejected on the bottom border').toBe(bottom(drawn.get('A1')!));
    expect(LayoutAnalysis.of(doc.definitions).score).toBe(0);
    const flow = flowFrom(doc, 'BE12', 'F');
    const top = { x: cx(ev), y: ev.bounds.y };
    expect(edges(doc).get(flow)!.points[0]).toEqual(top);
    // a task after the target: nothing of the event's way changes
    const after = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'Check payment', after: 'F' }], { layout: 'incremental' });
    expect(after.r.layout.mode).toBe('incremental');
    expect(addedKinds(after.r)).toEqual([]);
    expect(shapes(after.after).get('BE12')!.bounds).toEqual(ev.bounds);
    expect(edges(after.after).get(flow)!.points[0]).toEqual(top);
    // a task into the event's flow goes above the host, the flow into it leaves the event by its top
    const into = await run(xml, [{ op: 'add', kind: 'task', id: 'R', name: 'Remind customer', flow }], { layout: 'incremental' });
    expect(addedKinds(into.r)).toEqual([]);
    const now = shapes(into.after);
    expect(bottom(now.get('R')!), 'Remind customer above Pick invoice').toBeLessThan(now.get('A1')!.bounds.y);
    const up = edges(into.after).get(flowFrom(into.after, 'BE12', 'R'))!;
    expect(up.points[0]).toEqual({ x: cx(now.get('BE12')!), y: now.get('BE12')!.bounds.y });
    expect(orthogonal(up)).toBe(true);
    // routed again, the flow leaves by the top
    const again = await run(xml, [{ op: 'route', id: flow }], { layout: 'incremental' });
    expect(addedKinds(again.r)).toEqual([]);
    const rerouted = edges(again.after).get(flow)!;
    expect(rerouted.points[0]!.y).toBe(ev.bounds.y);
    expect(orthogonal(rerouted)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* stale edges: flows whose ends changed, edges that miss their ends    */
/* ------------------------------------------------------------------ */

/** The id of the sequence flow from `source` to `target`. */
function flowFrom(doc: Doc, source: string, target: string): string {
  for (const [id, el] of doc.byId()) {
    if (is(el, 'bpmn:SequenceFlow') && el.get<El>('sourceRef').get('id') === source && el.get<El>('targetRef').get('id') === target) return id;
  }
  throw new Error(`no flow ${source} -> ${target}`);
}

/** The edges that do not reach their ends (reroute.ts detachedEnds), with the ends they miss. */
function detached(doc: Doc): string[] {
  return new DiagramReader(doc.definitions).planes().flatMap((p) => [...p.edges.values()].filter((e) => new Drawing(p).detachedEnds(e).length).map((e) => `${e.id}->${new Drawing(p).detachedEnds(e).join(',')}`));
}

/** `xml` with the waypoints of the edge of `flow` moved by (dx, dy): the line no longer reaches its ends. */
async function detach(xml: string, flow: string, dx: number, dy: number): Promise<string> {
  const doc = await Doc.fromXml(xml);
  for (const w of edges(doc).get(flow)!.di!.get<El[]>('waypoint')) {
    w.set('x', w.get<number>('x') + dx);
    w.set('y', w.get<number>('y') + dy);
  }
  return doc.toXml();
}

describe('stale edges: flows whose ends changed, edges that do not reach their ends', () => {
  it('--no-layout: a bridge loses its stale edge, the note counts it with the removed DI; the next write draws it like a new flow', async () => {
    const xml = await handXml(BASE);
    const { r, after } = await run(xml, [{ op: 'remove', ids: ['A'] }], { layout: false });
    const bridge = flowFrom(after, 'S', 'G');
    expect(r.layout.status).toBe('skipped');
    expect(edges(after).has(bridge)).toBe(false);
    expect(r.changes.notes).toContain(`removed 2 stale diagram element(s), among them the edge(s) of ${bridge} (their ends changed; the next model edit without --no-layout draws them, or \`bpmn route <file> <flowId>\`)`);
    expect(r.layout.metrics!.added).toContainEqual({ kind: 'missing', ids: [bridge] });
    const next = await run(r.xml, [{ op: 'set', id: 'C', values: { name: 'Clarify it' } }]);
    expect(next.r.layout.mode).toBe('incremental');
    expect(next.r.layout.placed).toContain(bridge);
    expect(edges(next.after).get(bridge)!.points[0]!.x).toBe(right(shapes(next.after).get('S')!));
    expect(LayoutAnalysis.of(next.after.definitions).counts.missing).toBe(0);
    expect(detached(next.after)).toEqual([]);
  });

  it('--no-layout: route draws the line of a flow whose ends changed, also in the same batch; colour needs the line and its refusal names route', async () => {
    const xml = await handXml(BASE);
    const { r, after } = await run(xml, [{ op: 'remove', ids: ['A'] }], { layout: false });
    const bridge = flowFrom(after, 'S', 'G');
    const routed = await run(r.xml, [{ op: 'route', id: bridge, entry: 'left' }]);
    expect(routed.r.layout.reason).toBe('format operations only: drawing kept');
    expect(routed.r.layout.format?.[0]?.rerouted).toEqual([bridge]);
    expect(edges(routed.after).get(bridge)!.points[0]!.x).toBe(right(shapes(routed.after).get('S')!));
    expect(LayoutAnalysis.of(routed.after.definitions).counts.missing).toBe(0);
    for (const [id, s] of shapes(after)) expect(shapes(routed.after).get(id)!.bounds, id).toEqual(s.bounds);
    const batch = await run(xml, [{ op: 'remove', ids: ['A'] }, { op: 'route', id: bridge }], { layout: false });
    expect(edges(batch.after).has(bridge)).toBe(true);
    expect(detached(batch.after)).toEqual([]);
    const refused = await run(r.xml, [{ op: 'color', ids: [bridge], color: 'green' }]).catch((err: unknown) => err);
    expect(refused).toMatchObject({ code: 'E_NO_SHAPE', details: { hint: expect.stringContaining(`\`bpmn route <file> ${bridge}\` draws it`) } });
  });

  it('--no-layout: an edge that already reaches the new ends of its flow stays (a node added and removed again gives the input back)', async () => {
    const xml = await engineXml(BASE);
    const added = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }], { layout: false });
    const removed = await run(added.r.xml, [{ op: 'remove', ids: ['N'] }], { layout: false });
    expect(removed.r.changes.notes.filter((n) => n.includes('stale diagram'))).toEqual([]);
    const di = (x: string): string => x.slice(x.indexOf('<bpmndi:BPMNDiagram'));
    expect(di(removed.r.xml)).toBe(di(xml));
    // still the engine's drawing: the next write redraws it
    const next = await run(removed.r.xml, [{ op: 'set', id: 'C', values: { name: 'Clarify it' } }]);
    expect(next.r.layout.reason).toMatch(/^engine-owned diagram/);
  });

  it('--no-layout: a flow spliced to a new node keeps its edge while the node has no shape, and the next write places the node and routes it again', async () => {
    const xml = await handXml(BASE);
    const before = edges(await Doc.fromXml(xml));
    const old = flowFrom(await Doc.fromXml(xml), 'A', 'G');
    const { r, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }], { layout: false });
    const spliced = flowFrom(after, 'A', 'N');
    expect(edges(after).get(spliced)!.points).toEqual(before.get(old)!.points);
    expect(r.changes.notes.filter((n) => n.includes('stale diagram'))).toEqual([]);
    const next = await run(r.xml, [{ op: 'set', id: 'C', values: { name: 'Clarify it' } }]);
    expect(next.r.layout.placed).toContain('N');
    expect(next.r.layout.rerouted).toContain(spliced);
    expect(LayoutAnalysis.of(next.after.definitions).counts.missing).toBe(0);
    expect(detached(next.after)).toEqual([]);
  });

  it('an edge that does not reach its end (left at an old place) is rerouted by the next write and named in a note; the other edges keep their waypoints', async () => {
    const hand = await handXml(BASE);
    const flow = flowFrom(await Doc.fromXml(hand), 'B', 'E');
    const xml = await detach(hand, flow, 0, 150);
    const before = edges(await Doc.fromXml(xml));
    expect(detached(await Doc.fromXml(xml))).toEqual([`${flow}->B,E`]);
    const { r, after } = await run(xml, [{ op: 'set', id: 'C', values: { name: 'Clarify' } }]);
    expect(r.layout.rerouted).toEqual([flow]);
    expect(r.layout.notes).toContain(`${flow} routed again: it did not reach B and E`);
    expect(detached(after)).toEqual([]);
    for (const [id, e] of edges(after)) if (id !== flow) expect(e.points, id).toEqual(before.get(id)!.points);
    // a format command reroutes it too; --no-layout leaves it as it is
    const tidied = await run(xml, [{ op: 'tidy' }]);
    expect(detached(tidied.after)).toEqual([]);
    const skipped = await run(xml, [{ op: 'set', id: 'C', values: { name: 'Clarify' } }], { layout: false });
    expect(edges(skipped.after).get(flow)!.points).toEqual(before.get(flow)!.points);
  });
});
