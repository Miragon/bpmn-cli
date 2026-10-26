/**
 * design-iq stickies (`bpmiq:sticky` extension elements with absolute x / y)
 * follow the flow node nearest to them when an edit moves that node.
 * Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/domain/document/Doc.js';
import type { EditCommand } from '../src/domain/commands/types.js';
import { mutateDoc } from '../src/index.js';
import type { MutationOptions, MutationResult } from '../src/domain/batch/types.js';
import { renderLayout } from '../src/adapters/in/report/utils/result-lines.js';

const OPS: EditCommand[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

const BPMIQ = 'https://bpmiq.io/schema/1.0/bpmiq';

type Box = { x: number; y: number; width: number; height: number };

function shapeOf(xml: string, id: string): Box {
  const match = new RegExp(`bpmnElement="${id}"[^>]*>\\s*<dc:Bounds x="([-\\d.]+)" y="([-\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`).exec(xml);
  if (!match) throw new Error(`no shape for ${id}`);
  return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) };
}

function stickyAt(xml: string, id: string): { x: number; y: number } {
  const match = new RegExp(`<[a-z]+:sticky id="${id}"[^>]* x="(-?\\d+)" y="(-?\\d+)"`).exec(xml);
  if (!match) throw new Error(`no sticky ${id}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/**
 * The engine's drawing of OPS moved by (13, 7) (hand-made, so edits keep it),
 * with stickies placed relative to shapes: `[stickyId, nodeId, dx, dy]` puts the
 * sticky's top left corner at the node's top left corner plus (dx, dy).
 */
async function withStickies(stickies: Array<[string, string, number, number]>, opts: { prefix?: string; uri?: string; ops?: EditCommand[] } = {}): Promise<string> {
  const engine = (await mutateDoc(Doc.create({ processId: 'P' }), opts.ops ?? OPS, { dryRun: true })).xml;
  const hand = engine.replace(/<dc:Bounds x="([-\d.]+)" y="([-\d.]+)"/g, (_m, left: string, top: string) => `<dc:Bounds x="${Number(left) + 13}" y="${Number(top) + 7}"`).replace(/<di:waypoint x="([-\d.]+)" y="([-\d.]+)"/g, (_m, left: string, top: string) => `<di:waypoint x="${Number(left) + 13}" y="${Number(top) + 7}"`);
  const prefix = opts.prefix ?? 'bpmiq';
  const items = stickies.map(([id, node, dx, dy]) => {
    const shapeBox = shapeOf(hand, node);
    return `<${prefix}:sticky id="${id}" text="Note on ${node}" x="${shapeBox.x + dx}" y="${shapeBox.y + dy}" kind="question" width="60" height="40" />`;
  });
  return hand
    .replace('<bpmn:definitions ', `<bpmn:definitions xmlns:${prefix}="${opts.uri ?? BPMIQ}" `)
    .replace(/(<bpmn:process id="P"[^>]*>)/, `$1<bpmn:extensionElements>${items.join('')}</bpmn:extensionElements>`);
}

async function write(xml: string, ops: EditCommand[], opts: MutationOptions = {}): Promise<MutationResult> {
  return mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
}

/** The shift of a node's centre between two drawings. */
function shift(before: string, after: string, id: string): { x: number; y: number } {
  const beforeShape = shapeOf(before, id);
  const afterShape = shapeOf(after, id);
  return { x: Math.round(afterShape.x + afterShape.width / 2 - (beforeShape.x + beforeShape.width / 2)), y: Math.round(afterShape.y + afterShape.height / 2 - (beforeShape.y + beforeShape.height / 2)) };
}

describe('design-iq stickies follow their flow node', () => {
  it('incremental layout: a sticky moves with the node the space tool shifts, one at an untouched node stays', async () => {
    const xml = await withStickies([
      ['Sticky_E', 'E', 10, -60],
      ['Sticky_S', 'S', -10, -60],
    ]);
    const outcome = await write(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New step', after: 'B' }]);
    expect(outcome.layout.mode).toBe('incremental');
    const shiftDelta = shift(xml, outcome.xml, 'E');
    expect(shiftDelta.x).toBeGreaterThan(0);
    const was = stickyAt(xml, 'Sticky_E');
    expect(stickyAt(outcome.xml, 'Sticky_E')).toEqual({ x: was.x + shiftDelta.x, y: was.y + shiftDelta.y });
    expect(shift(xml, outcome.xml, 'S')).toEqual({ x: 0, y: 0 });
    expect(stickyAt(outcome.xml, 'Sticky_S')).toEqual(stickyAt(xml, 'Sticky_S'));
    expect(outcome.layout.stickies).toEqual([{ sticky: 'Sticky_E', node: 'E' }]);
    expect(renderLayout(outcome.layout)).toContain('  stickies moved: Sticky_E (with E)');
    // only x / y change, every other attribute of the sticky stays
    expect(outcome.xml).toMatch(/<bpmiq:sticky id="Sticky_E" text="Note on E" x="\d+" y="\d+" kind="question" width="60" height="40" \/>/);
  });

  it('format ops: a sticky follows a node that place / align moves', async () => {
    const xml = await withStickies([['Sticky_C', 'C', 70, 70]]);
    const outcome = await write(xml, [{ op: 'place', ids: ['C', 'E2'], above: 'B' } as EditCommand]);
    const shiftDelta = shift(xml, outcome.xml, 'C');
    expect(shiftDelta).not.toEqual({ x: 0, y: 0 });
    const was = stickyAt(xml, 'Sticky_C');
    expect(stickyAt(outcome.xml, 'Sticky_C')).toEqual({ x: was.x + shiftDelta.x, y: was.y + shiftDelta.y });
  });

  it('a full redraw: every sticky follows its node', async () => {
    const xml = await withStickies([
      ['Sticky_A', 'A', 0, -70],
      ['Sticky_E2', 'E2', 40, 0],
    ]);
    const outcome = await write(xml, [], { layout: 'full' });
    for (const [sticky, node] of [
      ['Sticky_A', 'A'],
      ['Sticky_E2', 'E2'],
    ] as const) {
      const shiftDelta = shift(xml, outcome.xml, node);
      expect(shiftDelta).toEqual({ x: -13, y: -7 });
      const was = stickyAt(xml, sticky);
      expect(stickyAt(outcome.xml, sticky)).toEqual({ x: was.x + shiftDelta.x, y: was.y + shiftDelta.y });
    }
  });

  it('never moves a sticky on a write that moves no node', async () => {
    const xml = await withStickies([['Sticky_A', 'A', 0, -70]]);
    const bytes = (await write(xml, [], { layout: 'incremental' })).xml;
    expect(stickyAt(bytes, 'Sticky_A')).toEqual(stickyAt(xml, 'Sticky_A'));
    const renamed = await write(xml, [{ op: 'set', id: 'S', values: { doc: 'A note' } }]);
    expect(renamed.layout.stickies).toBeUndefined();
    expect(stickyAt(renamed.xml, 'Sticky_A')).toEqual(stickyAt(xml, 'Sticky_A'));
    // a second write of the result changes nothing
    expect((await write(bytes, [], { layout: 'incremental' })).xml).toBe(bytes);
  });

  it('a sticky of a removed node stays; a renamed node is still followed', async () => {
    const xml = await withStickies([
      ['Sticky_C', 'C', 70, 70],
      ['Sticky_E', 'E', 10, -60],
    ]);
    const outcome = await write(xml, [
      { op: 'remove', ids: ['C'] },
      { op: 'set', id: 'E', values: { id: 'E_renamed' } },
      { op: 'add', kind: 'task', id: 'N', name: 'New step', after: 'B' },
    ]);
    expect(stickyAt(outcome.xml, 'Sticky_C')).toEqual(stickyAt(xml, 'Sticky_C'));
    const shiftDelta = shift(xml.replace(/bpmnElement="E"/, 'bpmnElement="E_renamed"'), outcome.xml, 'E_renamed');
    expect(shiftDelta.x).toBeGreaterThan(0);
    const was = stickyAt(xml, 'Sticky_E');
    expect(stickyAt(outcome.xml, 'Sticky_E')).toEqual({ x: was.x + shiftDelta.x, y: was.y + shiftDelta.y });
  });

  it('belongs to the task it lies on inside an expanded sub-process, not to the sub-process', async () => {
    const ops: EditCommand[] = [...OPS, { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'C' }, { op: 'add', kind: 'task', id: 'In', name: 'Inner', in: 'Sub' }];
    const xml = await withStickies([['Sticky_In', 'In', 20, 10]], { ops });
    const outcome = await write(xml, [{ op: 'add', kind: 'task', id: 'In2', name: 'Before inner', before: 'In' }]);
    const shiftDelta = shift(xml, outcome.xml, 'In');
    expect(shiftDelta.x).toBeGreaterThan(0);
    const was = stickyAt(xml, 'Sticky_In');
    expect(stickyAt(outcome.xml, 'Sticky_In')).toEqual({ x: was.x + shiftDelta.x, y: was.y + shiftDelta.y });
    expect(outcome.layout.stickies).toEqual([{ sticky: 'Sticky_In', node: 'In' }]);
  });

  it('any prefix of the bpmiq namespace; elements of other namespaces are left alone', async () => {
    const own = await withStickies([['Sticky_E', 'E', 10, -60]], { prefix: 'iq' });
    const outcome = await write(own, [{ op: 'add', kind: 'task', id: 'N', name: 'New step', after: 'B' }]);
    expect(stickyAt(outcome.xml, 'Sticky_E').x).toBeGreaterThan(stickyAt(own, 'Sticky_E').x);
    const foreign = await withStickies([['Sticky_E', 'E', 10, -60]], { prefix: 'other', uri: 'http://example.com/other' });
    const foreignOutcome = await write(foreign, [{ op: 'add', kind: 'task', id: 'N', name: 'New step', after: 'B' }]);
    expect(stickyAt(foreignOutcome.xml, 'Sticky_E')).toEqual(stickyAt(foreign, 'Sticky_E'));
  });
});
