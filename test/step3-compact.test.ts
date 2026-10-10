/**
 * Step 3: closing empty space in a kept drawing (src/diagram/compact.ts and
 * the `compact` / negative `space` format ops in src/diagram/ops.ts).
 *
 *  - compact closes empty columns and rows and shrinks lanes, pools and
 *    expanded sub-processes to their content, keeping the order; it never
 *    adds a hard layout problem or raises the score (a strip that would is
 *    left open, with a note)
 *  - message flows do not hold a strip open: their bends and labels are
 *    squeezed with it
 *  - `space --by -column|-row|-<px>` closes empty space at one place, only
 *    as far as it is empty
 *
 * Fixtures are drawn by the clean engine and moved by a few pixels so `auto`
 * keeps them (see test/diagram-format.test.ts), or written by hand.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { layoutProblems } from '../src/diagram/metrics.js';
import { readPlanes, type DEdge, type DShape } from '../src/diagram/plane.js';
import { isCliError } from '../src/errors.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationResult } from '../src/pipeline.js';
import { definitionsXml } from './helpers.js';

const BASE: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
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
  { op: 'add', kind: 'endEvent', id: 'SE', name: 'Inner done', after: 'ST' },
];

async function handXml(ops: Op[], dx = 13, dy = 7): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  const doc = await Doc.fromXml(r.xml);
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      for (const b of [pe.get<El | undefined>('bounds'), pe.get<El | undefined>('label')?.get<El | undefined>('bounds')]) {
        if (!b) continue;
        b.set('x', b.get<number>('x') + dx);
        b.set('y', b.get<number>('y') + dy);
      }
      for (const w of pe.get<El[] | undefined>('waypoint') ?? []) {
        w.set('x', w.get<number>('x') + dx);
        w.set('y', w.get<number>('y') + dy);
      }
    }
  }
  return doc.toXml();
}

async function run(xml: string, ops: Op[]): Promise<{ r: MutationResult; after: Doc; xml: string }> {
  const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  const after = await Doc.fromXml(r.xml);
  expect(after.importWarnings).toEqual([]);
  return { r, after, xml: r.xml };
}

async function failure(xml: string, ops: Op[]): Promise<{ code: string; message: string; hint?: string }> {
  try {
    await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
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

const HARD = ['overlaps', 'frameIntrusion', 'frameOverlap', 'through', 'degenerateEdge', 'missing', 'outsideLane', 'outsidePool', 'outsideSub'];
const hardOf = (doc: Doc): string[] => layoutProblems(doc.definitions).problems.filter((p) => HARD.includes(p.kind)).map((p) => `${p.kind} ${p.ids.join(',')}`);
const notesOf = (r: MutationResult): string[] => r.layout.format?.flatMap((f) => f.notes ?? []) ?? [];
const orthogonal = (e: DEdge): boolean => e.points.every((p, i) => i === 0 || p.x === e.points[i - 1]!.x || p.y === e.points[i - 1]!.y);

describe('compact', () => {
  it('shrinks a lane that grew empty rows back to its content; the lanes and pools below move up', async () => {
    const hand = await handXml(POOLED);
    const original = shapes(await Doc.fromXml(hand));
    const grown = await run(hand, [{ op: 'space', below: 'L1', by: 300 }]);
    const g = shapes(grown.after);
    expect(g.get('L1')!.bounds.height).toBe(original.get('L1')!.bounds.height + 300);
    const { r, after } = await run(grown.xml, [{ op: 'compact' }]);
    const now = shapes(after);
    expect(now.get('L1')!.bounds.height).toBeLessThan(g.get('L1')!.bounds.height - 250);
    // the content keeps its place and its order; the lane below follows the shrunk lane
    for (const id of ['S', 'A', 'G', 'B', 'E', 'C', 'E2']) expect(now.get(id)!.bounds.y, id).toBe(g.get(id)!.bounds.y);
    expect(now.get('L2')!.bounds.y).toBe(now.get('L1')!.bounds.y + now.get('L1')!.bounds.height);
    expect(now.get('Pool')!.bounds.height).toBe(now.get('L1')!.bounds.height + now.get('L2')!.bounds.height);
    expect(r.layout.metrics!.added).toEqual([]);
    expect(notesOf(r).join(' ')).toMatch(/closed .*empty rows? \(\d+ px\)/);
  });

  it('closes an empty column in a process without pools, keeping the order', async () => {
    const hand = await handXml(BASE);
    const original = shapes(await Doc.fromXml(hand));
    const spaced = await run(hand, [{ op: 'space', after: 'A', by: 300 }]);
    expect(shapes(spaced.after).get('G')!.bounds.x).toBe(original.get('G')!.bounds.x + 300);
    const { r, after } = await run(spaced.xml, [{ op: 'compact' }]);
    const now = shapes(after);
    // back to the drawing's gap: everything right of A moves by one offset (relative positions kept)
    const dx = now.get('G')!.bounds.x - original.get('G')!.bounds.x;
    expect(Math.abs(dx)).toBeLessThanOrEqual(5);
    for (const id of ['B', 'E', 'C', 'E2']) expect(now.get(id)!.bounds.x - original.get(id)!.bounds.x, id).toBe(dx);
    for (const id of ['S', 'A']) expect(now.get(id)!.bounds, id).toEqual(original.get(id)!.bounds);
    for (const e of edges(after).values()) expect(orthogonal(e), e.id).toBe(true);
    expect(r.layout.metrics!.added).toEqual([]);
    expect(notesOf(r)).toEqual(expect.arrayContaining([expect.stringMatching(/^closed 1 empty column \(\d+ px\)$/)]));
  });

  it('compact <subProcess> shrinks only that sub-process; compact without ids closes the room it freed', async () => {
    const hand = await handXml(WITH_SUB);
    const original = shapes(await Doc.fromXml(hand));
    const spaced = await run(hand, [{ op: 'space', after: 'ST', by: 300 }]);
    const s = shapes(spaced.after);
    expect(s.get('Sub')!.bounds.width).toBe(original.get('Sub')!.bounds.width + 300);
    const one = await run(spaced.xml, [{ op: 'compact', ids: ['Sub'] }]);
    const o = shapes(one.after);
    expect(o.get('Sub')!.bounds.width).toBeLessThan(s.get('Sub')!.bounds.width - 250);
    // what is outside the sub-process stays where it was
    for (const id of ['S', 'A', 'G', 'B', 'C', 'E2']) expect(o.get(id)!.bounds, id).toEqual(s.get(id)!.bounds);
    const all = await run(one.xml, [{ op: 'compact' }]);
    expect(shapes(all.after).get('E')!.bounds.x).toBeLessThan(o.get('E')!.bounds.x);
    expect(hardOf(all.after)).toEqual(hardOf(await Doc.fromXml(hand)));
  });

  it('lets a message flow pass: its bends and label are squeezed with the strip', async () => {
    const hand = await handXml([
      ...POOLED,
      { op: 'add', kind: 'participant', id: 'Partner', name: 'Partner', blackBox: true },
      { op: 'connect', source: 'Partner', target: 'C', id: 'M1', name: 'Request' },
    ]);
    const grown = await run(hand, [{ op: 'space', below: 'L1', by: 300 }]);
    const before = edges(grown.after).get('M1')!;
    const { r, after } = await run(grown.xml, [{ op: 'compact' }]);
    const m1 = edges(after).get('M1')!;
    expect(orthogonal(m1)).toBe(true);
    expect(shapes(after).get('L1')!.bounds.height).toBeLessThan(shapes(grown.after).get('L1')!.bounds.height - 250);
    expect(m1.points.length).toBe(before.points.length);
    expect(r.layout.metrics!.added).toEqual([]);
  });

  it('leaves a gap open when closing it would add a layout problem (pools side by side)', async () => {
    const body = `<bpmn:task id="A" name="A" /><bpmn:task id="B" name="B" />`;
    const shape = (id: string, [x, y, w, h]: number[]): string => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" isHorizontal="true"><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
    const xml = definitionsXml(body, {
      nsDecl: 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
      extraRoots: `<bpmn:process id="Process_2"><bpmn:task id="X" name="X" /></bpmn:process>
        <bpmn:collaboration id="Collab"><bpmn:participant id="Left" processRef="Process_1" /><bpmn:participant id="Right" processRef="Process_2" /><bpmn:participant id="Below" /></bpmn:collaboration>
        <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
          ${shape('Left', [0, 0, 400, 500])}${shape('A', [60, 40, 100, 80])}${shape('B', [220, 40, 100, 80])}
          ${shape('Right', [420, 0, 300, 500])}${shape('X', [480, 400, 100, 80])}
          ${shape('Below', [0, 540, 720, 60])}
        </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`,
    });
    const { r, after } = await run(xml, [{ op: 'compact' }]);
    // the empty rows of Left would pull Below up onto Right: refused, with a note
    expect(notesOf(r).join(" ")).toMatch(/left \d+ gaps? open: closing (it|them) would add frameOverlap \[(Right, Below|Below, Right)\]/);
    expect(hardOf(after)).toEqual([]);
    expect(shapes(after).get('Below')!.bounds.y).toBeGreaterThanOrEqual(500);
  });

  it('refuses ids that are no frames and says when there is nothing to do', async () => {
    const hand = await handXml(POOLED);
    const e = await failure(hand, [{ op: 'compact', ids: ['A'] }]);
    expect(e.code).toBe('E_WRONG_KIND');
    expect(e.message).toMatch(/"A" is not a pool, lane or expanded sub-process/);
    expect(e.hint).toMatch(/space <file> --after <id> --by -column/);
    const { r } = await run(hand, [{ op: 'compact', ids: ['L1'] }]);
    expect(r.layout.format![0]!.op).toBe('compact');
  });
});

describe('space with a negative amount', () => {
  it('closes up to one column right of a node, then only what is left, then reports nothing to close', async () => {
    const hand = await handXml(BASE);
    const original = shapes(await Doc.fromXml(hand));
    const spaced = await run(hand, [{ op: 'space', after: 'A', by: 300 }]);
    const s = shapes(spaced.after);
    const one = await run(spaced.xml, [{ op: 'space', after: 'A', by: '-column' }]);
    const o = shapes(one.after);
    const column = s.get('G')!.bounds.x - o.get('G')!.bounds.x;
    expect(column).toBeGreaterThan(100);
    expect(column).toBeLessThan(300);
    const rest = await run(one.xml, [{ op: 'space', after: 'A', by: -1000 }]);
    expect(Math.abs(shapes(rest.after).get('G')!.bounds.x - original.get('G')!.bounds.x)).toBeLessThanOrEqual(5);
    expect(notesOf(rest.r).join(' ')).toMatch(/closed \d+ px right of A \(of 1000 px asked for\): the rest is not empty/);
    const none = await run(rest.xml, [{ op: 'space', after: 'A', by: '-column' }]);
    expect(none.r.unchanged).toBe(true);
    expect(notesOf(none.r).join(' ')).toMatch(/nothing to close right of A: no empty space there/);
  });

  it('shrinks a lane from the bottom (`space --below <lane> --by -row`), the pool with it', async () => {
    const hand = await handXml(POOLED);
    const grown = await run(hand, [{ op: 'space', below: 'L1', by: 300 }]);
    const g = shapes(grown.after);
    const { r, after } = await run(grown.xml, [{ op: 'space', below: 'L1', by: '-row' }]);
    const now = shapes(after);
    const shrunk = g.get('L1')!.bounds.height - now.get('L1')!.bounds.height;
    expect(shrunk).toBeGreaterThan(50);
    expect(g.get('Pool')!.bounds.height - now.get('Pool')!.bounds.height).toBe(shrunk);
    expect(now.get('L2')!.bounds.y).toBe(g.get('L2')!.bounds.y - shrunk);
    expect(r.layout.metrics!.added).toEqual([]);
  });
});
