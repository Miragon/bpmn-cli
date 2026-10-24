/**
 * Groups (issue #73): `add group --members` creates a bpmn:Group with its
 * bpmn:Category / bpmn:CategoryValue and ties the members to the value
 * (FlowElement.categoryValueRef), the layout draws the box around them;
 * `show` lists groups with their members; `set name=` writes the category
 * value; `remove` drops a value and category no other group uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyToXml, showXml, viewXml, Doc, type CliError } from '../src/index.js';
import { LINEAR } from './helpers.js';

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', 'incremental', name), 'utf8');

async function rejected(p: Promise<unknown>): Promise<CliError> {
  try {
    await p;
  } catch (err) {
    return err as CliError;
  }
  throw new Error('expected a rejection');
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boundsOf(xml: string, id: string): Promise<Box | undefined> {
  const doc = await Doc.fromXml(xml);
  for (const d of doc.definitions.get<Array<{ plane: { planeElement?: Array<{ bpmnElement?: { id: string }; bounds?: Box }> } }>>('diagrams')) {
    const shape = (d.plane.planeElement ?? []).find((pe) => pe.bpmnElement?.id === id);
    if (shape?.bounds) return { x: shape.bounds.x, y: shape.bounds.y, width: shape.bounds.width, height: shape.bounds.height };
  }
  return undefined;
}

const holds = (outer: Box, inner: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

describe('add group', () => {
  it('creates group, category and value, ties the members and draws the box around them (hand-made drawing)', async () => {
    const xml = fixture('groups.bpmn');
    const { xml: out, result } = await applyToXml(xml, [{ op: 'add', kind: 'group', name: 'Payment', members: ['C', 'D'] }]);
    expect(result.layout?.mode).toBe('incremental');
    expect(result.created.map((c) => c.kind)).toEqual(['group']);
    const id = result.created[0]!.id;
    expect(out).toMatch(new RegExp(`<bpmn:group id="${id}" categoryValueRef="(\\w+)" />`));
    const value = out.match(new RegExp(`<bpmn:group id="${id}" categoryValueRef="(\\w+)" />`))![1]!;
    expect(out).toMatch(new RegExp(`<bpmn:category id="\\w+">\\s*<bpmn:categoryValue id="${value}" value="Payment" />`));
    expect(out).toContain(`<bpmn:task id="C" name="Task C"><bpmn:categoryValueRef>${value}</bpmn:categoryValueRef>`);
    const box = (await boundsOf(out, id))!;
    expect(holds(box, (await boundsOf(out, 'C'))!)).toBe(true);
    expect(holds(box, (await boundsOf(out, 'D'))!)).toBe(true);
    expect(holds(box, (await boundsOf(out, 'A'))!)).toBe(false);
    expect(out).toContain(`id="${id}_di"`);
    for (const kept of ['A', 'B', 'C', 'D', 'G1', 'G2']) expect(await boundsOf(out, kept)).toEqual(await boundsOf(xml, kept));
  });

  it('draws the group on a new drawing (full redraw), with members created in the same batch', async () => {
    const { xml: out, result } = await applyToXml(LINEAR, [
      { op: 'add', kind: 'userTask', name: 'Pay', after: 'Task_A', as: '$pay' },
      { op: 'add', kind: 'group', name: 'Payment', members: ['Task_A', '$pay'] },
    ]);
    expect(result.layout?.mode).toBe('full');
    const group = result.created.find((c) => c.kind === 'group')!.id;
    const pay = result.created.find((c) => c.kind === 'userTask')!.id;
    const box = (await boundsOf(out, group))!;
    expect(holds(box, (await boundsOf(out, 'Task_A'))!)).toBe(true);
    expect(holds(box, (await boundsOf(out, pay))!)).toBe(true);
    expect(holds(box, (await boundsOf(out, 'Start'))!)).toBe(false);
  });

  it('draws a group added with --no-layout on the next write', async () => {
    const drawn = (await applyToXml(LINEAR, [{ op: 'add', kind: 'task', name: 'Pay', after: 'Task_A' }])).xml;
    const { xml: bare, result } = await applyToXml(drawn, [{ op: 'add', kind: 'group', name: 'Payment', members: ['Task_A'] }], { layout: false });
    const group = result.created[0]!.id;
    expect(await boundsOf(bare, group)).toBeUndefined();
    const { xml: out } = await applyToXml(bare, [{ op: 'set', id: 'Task_A', values: { name: 'Check A' } }]);
    expect(holds((await boundsOf(out, group))!, (await boundsOf(out, 'Task_A'))!)).toBe(true);
  });

  it('refuses a group without members, with an unknown member, a flow as member or a placement', async () => {
    expect((await rejected(applyToXml(LINEAR, [{ op: 'add', kind: 'group', name: 'G' }]))).code).toBe('E_USAGE');
    expect((await rejected(applyToXml(LINEAR, [{ op: 'add', kind: 'group', name: 'G', members: ['Nope'] }]))).code).toBe('E_NOT_FOUND');
    expect((await rejected(applyToXml(LINEAR, [{ op: 'add', kind: 'group', name: 'G', members: ['F1'] }]))).code).toBe('E_INVALID_VALUE');
    expect((await rejected(applyToXml(LINEAR, [{ op: 'add', kind: 'group', name: 'G', members: ['Task_A'], after: 'Start' }]))).code).toBe('E_INVALID_PLACEMENT');
  });
});

describe('show groups', () => {
  it('lists the groups of a bpmn-js drawing with the members their boxes hold', async () => {
    const view = await viewXml(fixture('groups.bpmn'));
    expect(view.groups).toEqual([
      { id: 'G1', name: 'Left column', members: ['S1', 'A', 'E1', 'S2', 'B', 'E2'] },
      { id: 'G2', name: 'Right column', members: ['S3', 'C', 'E3', 'D'] },
    ]);
    expect(await showXml(fixture('groups.bpmn'))).toContain('groups:\n  G1 "Left column": S1, A, E1, S2, B, E2\n  G2 "Right column": S3, C, E3, D');
    expect(await viewXml(fixture('groups.bpmn'), { id: 'G1' })).toMatchObject({ name: 'Left column', properties: { members: ['S1', 'A', 'E1', 'S2', 'B', 'E2'] } });
  });

  it('lists the members of a group the CLI added', async () => {
    const { xml } = await applyToXml(LINEAR, [{ op: 'add', kind: 'group', name: 'Work', members: ['Task_A'] }], { layout: false });
    expect((await viewXml(xml)).groups).toEqual([{ id: expect.any(String), name: 'Work', members: ['Task_A'] }]);
  });
});

describe('set and remove on groups', () => {
  it('set name= writes the category value, not a name attribute', async () => {
    const { xml } = await applyToXml(fixture('groups.bpmn'), [{ op: 'set', id: 'G1', values: { name: 'Front' } }]);
    expect(xml).toContain('<bpmn:categoryValue id="CV_1" value="Front" />');
    expect(xml).not.toMatch(/<bpmn:group id="G1"[^>]* name=/);
    expect((await viewXml(xml, { id: 'G1' })).name).toBe('Front');
  });

  it('set name= sizes the label to the new name, centred at the top of the box', async () => {
    const name = 'Payment and everything that follows it';
    const { xml } = await applyToXml(fixture('groups.bpmn'), [{ op: 'set', id: 'G2', values: { name } }]);
    const doc = await Doc.fromXml(xml);
    const shape = doc.definitions.get<Array<{ plane: { planeElement: Array<{ bpmnElement?: { id: string }; bounds: Box; label?: { bounds: Box } }> } }>>('diagrams')[0]!.plane.planeElement.find((pe) => pe.bpmnElement?.id === 'G2')!;
    const label = shape.label!.bounds;
    expect(Math.abs(label.x + label.width / 2 - (shape.bounds.x + shape.bounds.width / 2))).toBeLessThanOrEqual(1);
    expect(label.y).toBeGreaterThanOrEqual(shape.bounds.y);
    expect(await boundsOf(xml, 'G2')).toEqual(await boundsOf(fixture('groups.bpmn'), 'G2'));
  });

  it('set name= on a group without a value creates its category', async () => {
    const xml = fixture('groups.bpmn').replace('<bpmn:group id="G2" categoryValueRef="CV_2" />', '<bpmn:group id="G2" />');
    const { xml: out } = await applyToXml(xml, [{ op: 'set', id: 'G2', values: { name: 'Back' } }]);
    expect(out).toMatch(/<bpmn:group id="G2" categoryValueRef="(\w+)" \/>/);
    expect((await viewXml(out, { id: 'G2' })).name).toBe('Back');
  });

  it('remove drops the value, its member refs and the category once it is empty', async () => {
    const { xml: added } = await applyToXml(LINEAR, [{ op: 'add', kind: 'group', name: 'Work', members: ['Task_A'] }]);
    const group = (await viewXml(added)).groups![0]!.id;
    const { xml } = await applyToXml(added, [{ op: 'remove', ids: [group] }]);
    expect(xml).not.toMatch(/category|<bpmn:group/i);
  });

  it('remove keeps a category another group still uses', async () => {
    const { xml } = await applyToXml(fixture('groups.bpmn'), [{ op: 'remove', ids: ['G1'] }]);
    expect(xml).not.toContain('CV_1');
    expect(xml).toMatch(/<bpmn:category id="Cat_1">\s*<bpmn:categoryValue id="CV_2" value="Right column" \/>\s*<\/bpmn:category>/);
  });

  it('puts a group around the content of a sub-process into that sub-process, and refuses a bare data object', async () => {
    const { xml } = await applyToXml(LINEAR, [
      { op: 'add', kind: 'subProcess', name: 'Pay', after: 'Task_A', as: '$sub' },
      { op: 'add', kind: 'task', name: 'Charge', in: '$sub', as: '$charge' },
      { op: 'add', kind: 'group', name: 'Inner', members: ['$charge'] },
    ]);
    expect(xml).toMatch(/<bpmn:subProcess id="\w+" name="Pay">(?:(?!<\/bpmn:subProcess>)[\s\S])*<bpmn:group id="Group_Inner"/);
    const withData = await applyToXml(LINEAR, [{ op: 'add', kind: 'dataObject', name: 'Doc' }]);
    const backing = withData.xml.match(/<bpmn:dataObject id="(\w+)"/)![1]!;
    expect((await rejected(applyToXml(withData.xml, [{ op: 'add', kind: 'group', name: 'G', members: [backing] }]))).code).toBe('E_INVALID_VALUE');
  });

  it('lists only the elements that reference the group, not what else its box covers', async () => {
    const { xml } = await applyToXml(LINEAR, [{ op: 'add', kind: 'group', name: 'Ends', members: ['Start', 'End'] }]);
    expect((await viewXml(xml)).groups![0]!.members).toEqual(['Start', 'End']);
  });

  it('remove keeps a value another group references', async () => {
    const xml = fixture('groups.bpmn').replace('<bpmn:group id="G2" categoryValueRef="CV_2" />', '<bpmn:group id="G2" categoryValueRef="CV_1" />');
    const { xml: out } = await applyToXml(xml, [{ op: 'remove', ids: ['G1'] }]);
    expect(out).toContain('<bpmn:categoryValue id="CV_1" value="Left column" />');
  });
});
