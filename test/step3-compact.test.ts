/**
 * Step 3: closing empty space in a kept drawing (src/domain/diagram/format/CompactionService.ts and
 * the `compact` / negative `space` format ops in src/domain/diagram/DiagramCommandService.ts).
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
import { Doc } from '../src/domain/document/Doc.js';
import type { DEdge, DShape } from '../src/domain/diagram/di/types.js';
import { LayoutAnalysis } from '../src/domain/diagram/di/LayoutAnalysis.js';
import { DiagramReader } from '../src/domain/diagram/di/DiagramReader.js';
import { isCliError } from '../src/domain/document/utils/errors.js';
import type { El } from '../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../src/domain/commands/types.js';
import { mutateDoc } from '../src/index.js';
import { type MutationResult } from '../src/domain/batch/types.js';
import { definitionsXml } from './helpers.js';

const BASE: EditCommand[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

const POOLED: EditCommand[] = [
  ...BASE,
  { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' },
  { op: 'add', kind: 'lane', id: 'L1', name: 'Clerk', in: 'Pool', members: ['S', 'A', 'G', 'B', 'E', 'C', 'E2'] },
  { op: 'add', kind: 'lane', id: 'L2', name: 'Boss', in: 'Pool' },
];

const WITH_SUB: EditCommand[] = [
  ...BASE,
  { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'B' },
  { op: 'add', kind: 'startEvent', id: 'SS', in: 'Sub' },
  { op: 'add', kind: 'task', id: 'ST', name: 'Inner', after: 'SS' },
  { op: 'add', kind: 'endEvent', id: 'SE', name: 'Inner done', after: 'ST' },
];

async function handXml(ops: EditCommand[], dx = 13, dy = 7): Promise<string> {
  const result = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  const doc = await Doc.fromXml(result.xml);
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      for (const bounds of [pe.get<El | undefined>('bounds'), pe.get<El | undefined>('label')?.get<El | undefined>('bounds')]) {
        if (!bounds) continue;
        bounds.set('x', bounds.get<number>('x') + dx);
        bounds.set('y', bounds.get<number>('y') + dy);
      }
      for (const waypoint of pe.get<El[] | undefined>('waypoint') ?? []) {
        waypoint.set('x', waypoint.get<number>('x') + dx);
        waypoint.set('y', waypoint.get<number>('y') + dy);
      }
    }
  }
  return doc.toXml();
}

async function run(xml: string, ops: EditCommand[]): Promise<{ result: MutationResult; after: Doc; xml: string }> {
  const result = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  const after = await Doc.fromXml(result.xml);
  expect(after.importWarnings).toEqual([]);
  return { result, after, xml: result.xml };
}

async function failure(xml: string, ops: EditCommand[]): Promise<{ code: string; message: string; hint?: string }> {
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
  for (const plane of new DiagramReader(doc.definitions).planes()) for (const shape of plane.shapes.values()) out.set(shape.id, shape);
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const plane of new DiagramReader(doc.definitions).planes()) for (const edge of plane.edges.values()) out.set(edge.id, edge);
  return out;
}

const HARD = ['overlaps', 'frameIntrusion', 'frameOverlap', 'through', 'degenerateEdge', 'missing', 'outsideLane', 'outsidePool', 'outsideSub'];
const hardOf = (doc: Doc): string[] => LayoutAnalysis.of(doc.definitions).problems.filter((problem) => HARD.includes(problem.kind)).map((problem) => `${problem.kind} ${problem.ids.join(',')}`);
const notesOf = (mutation: MutationResult): string[] => mutation.layout.format?.flatMap((format) => format.notes ?? []) ?? [];
const orthogonal = (edge: DEdge): boolean => edge.points.every((point, index) => index === 0 || point.x === edge.points[index - 1]!.x || point.y === edge.points[index - 1]!.y);

describe('compact', () => {
  it('shrinks a lane that grew empty rows back to its content; the lanes and pools below move up', async () => {
    const hand = await handXml(POOLED);
    const original = shapes(await Doc.fromXml(hand));
    const grown = await run(hand, [{ op: 'space', below: 'L1', by: 300 }]);
    const grownShapes = shapes(grown.after);
    expect(grownShapes.get('L1')!.bounds.height).toBe(original.get('L1')!.bounds.height + 300);
    const { result, after } = await run(grown.xml, [{ op: 'compact' }]);
    const now = shapes(after);
    expect(now.get('L1')!.bounds.height).toBeLessThan(grownShapes.get('L1')!.bounds.height - 250);
    // the content keeps its place and its order; the lane below follows the shrunk lane
    for (const id of ['S', 'A', 'G', 'B', 'E', 'C', 'E2']) expect(now.get(id)!.bounds.y, id).toBe(grownShapes.get(id)!.bounds.y);
    expect(now.get('L2')!.bounds.y).toBe(now.get('L1')!.bounds.y + now.get('L1')!.bounds.height);
    expect(now.get('Pool')!.bounds.height).toBe(now.get('L1')!.bounds.height + now.get('L2')!.bounds.height);
    expect(result.layout.metrics!.added).toEqual([]);
    expect(notesOf(result).join(' ')).toMatch(/closed .*empty rows? \(\d+ px\)/);
  });

  it('closes an empty column in a process without pools, keeping the order', async () => {
    const hand = await handXml(BASE);
    const original = shapes(await Doc.fromXml(hand));
    const spaced = await run(hand, [{ op: 'space', after: 'A', by: 300 }]);
    expect(shapes(spaced.after).get('G')!.bounds.x).toBe(original.get('G')!.bounds.x + 300);
    const { result, after } = await run(spaced.xml, [{ op: 'compact' }]);
    const now = shapes(after);
    // back to the drawing's gap: everything right of A moves by one offset (relative positions kept)
    const dx = now.get('G')!.bounds.x - original.get('G')!.bounds.x;
    expect(Math.abs(dx)).toBeLessThanOrEqual(5);
    for (const id of ['B', 'E', 'C', 'E2']) expect(now.get(id)!.bounds.x - original.get(id)!.bounds.x, id).toBe(dx);
    for (const id of ['S', 'A']) expect(now.get(id)!.bounds, id).toEqual(original.get(id)!.bounds);
    for (const edge of edges(after).values()) expect(orthogonal(edge), edge.id).toBe(true);
    expect(result.layout.metrics!.added).toEqual([]);
    expect(notesOf(result)).toEqual(expect.arrayContaining([expect.stringMatching(/^closed 1 empty column \(\d+ px\)$/)]));
  });

  it('compact <subProcess> shrinks only that sub-process; compact without ids closes the room it freed', async () => {
    const hand = await handXml(WITH_SUB);
    const original = shapes(await Doc.fromXml(hand));
    const spaced = await run(hand, [{ op: 'space', after: 'ST', by: 300 }]);
    const spacedShapes = shapes(spaced.after);
    expect(spacedShapes.get('Sub')!.bounds.width).toBe(original.get('Sub')!.bounds.width + 300);
    const one = await run(spaced.xml, [{ op: 'compact', ids: ['Sub'] }]);
    const oneShapes = shapes(one.after);
    expect(oneShapes.get('Sub')!.bounds.width).toBeLessThan(spacedShapes.get('Sub')!.bounds.width - 250);
    // what is outside the sub-process stays where it was
    for (const id of ['S', 'A', 'G', 'B', 'C', 'E2']) expect(oneShapes.get(id)!.bounds, id).toEqual(spacedShapes.get(id)!.bounds);
    const all = await run(one.xml, [{ op: 'compact' }]);
    expect(shapes(all.after).get('E')!.bounds.x).toBeLessThan(oneShapes.get('E')!.bounds.x);
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
    const { result, after } = await run(grown.xml, [{ op: 'compact' }]);
    const m1 = edges(after).get('M1')!;
    expect(orthogonal(m1)).toBe(true);
    expect(shapes(after).get('L1')!.bounds.height).toBeLessThan(shapes(grown.after).get('L1')!.bounds.height - 250);
    expect(m1.points.length).toBe(before.points.length);
    expect(result.layout.metrics!.added).toEqual([]);
  });

  it('leaves a gap open when closing it would add a layout problem (pools side by side)', async () => {
    const body = `<bpmn:task id="A" name="A" /><bpmn:task id="B" name="B" />`;
    const shape = (id: string, [left, top, width, height]: number[]): string => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" isHorizontal="true"><dc:Bounds x="${left}" y="${top}" width="${width}" height="${height}" /></bpmndi:BPMNShape>`;
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
    const { result, after } = await run(xml, [{ op: 'compact' }]);
    // the empty rows of Left would pull Below up onto Right: refused, with a note
    expect(notesOf(result).join(" ")).toMatch(/left \d+ gaps? open: closing (it|them) would add frameOverlap \[(Right, Below|Below, Right)\]/);
    expect(hardOf(after)).toEqual([]);
    expect(shapes(after).get('Below')!.bounds.y).toBeGreaterThanOrEqual(500);
  });

  it('refuses ids that are no frames and says when there is nothing to do', async () => {
    const hand = await handXml(POOLED);
    const failureError = await failure(hand, [{ op: 'compact', ids: ['A'] }]);
    expect(failureError.code).toBe('E_WRONG_KIND');
    expect(failureError.message).toMatch(/"A" is not a pool, lane or expanded sub-process/);
    expect(failureError.hint).toMatch(/space <file> --after <id> --by -column/);
    const { result } = await run(hand, [{ op: 'compact', ids: ['L1'] }]);
    expect(result.layout.format![0]!.op).toBe('compact');
  });
});

describe('space with a negative amount', () => {
  it('closes up to one column right of a node, then only what is left, then reports nothing to close', async () => {
    const hand = await handXml(BASE);
    const original = shapes(await Doc.fromXml(hand));
    const spaced = await run(hand, [{ op: 'space', after: 'A', by: 300 }]);
    const spacedShapes = shapes(spaced.after);
    const one = await run(spaced.xml, [{ op: 'space', after: 'A', by: '-column' }]);
    const oneShapes = shapes(one.after);
    const column = spacedShapes.get('G')!.bounds.x - oneShapes.get('G')!.bounds.x;
    expect(column).toBeGreaterThan(100);
    expect(column).toBeLessThan(300);
    const rest = await run(one.xml, [{ op: 'space', after: 'A', by: -1000 }]);
    expect(Math.abs(shapes(rest.after).get('G')!.bounds.x - original.get('G')!.bounds.x)).toBeLessThanOrEqual(5);
    expect(notesOf(rest.result).join(' ')).toMatch(/closed \d+ px right of A \(of 1000 px asked for\): the rest is not empty/);
    const none = await run(rest.xml, [{ op: 'space', after: 'A', by: '-column' }]);
    expect(none.result.unchanged).toBe(true);
    expect(notesOf(none.result).join(' ')).toMatch(/nothing to close right of A: no empty space there/);
  });

  it('shrinks a lane from the bottom (`space --below <lane> --by -row`), the pool with it', async () => {
    const hand = await handXml(POOLED);
    const grown = await run(hand, [{ op: 'space', below: 'L1', by: 300 }]);
    const grownShapes = shapes(grown.after);
    const { result, after } = await run(grown.xml, [{ op: 'space', below: 'L1', by: '-row' }]);
    const now = shapes(after);
    const shrunk = grownShapes.get('L1')!.bounds.height - now.get('L1')!.bounds.height;
    expect(shrunk).toBeGreaterThan(50);
    expect(grownShapes.get('Pool')!.bounds.height - now.get('Pool')!.bounds.height).toBe(shrunk);
    expect(now.get('L2')!.bounds.y).toBe(grownShapes.get('L2')!.bounds.y - shrunk);
    expect(result.layout.metrics!.added).toEqual([]);
  });
});
