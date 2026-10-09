/**
 * A full redraw keeps the DI ids of the file (only geometry changes); new DI
 * follows the file's DI id style. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationOptions } from '../src/pipeline.js';

const OPS: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

/** The engine's drawing of OPS with DI ids in a given style and every shape moved (a hand-made drawing). */
async function drawn(style: (kind: 'Shape' | 'Edge', id: string) => string, names = { diagram: 'BPMNDiagram_1', plane: 'BPMNPlane_1' }): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true });
  return r.xml
    .replace(/<bpmndi:BPMN(Shape|Edge) id="BPMN(?:Shape|Edge)_([^"]+)"/g, (_m, kind: 'Shape' | 'Edge', id: string) => `<bpmndi:BPMN${kind} id="${style(kind, id)}"`)
    .replace(/id="BPMNDiagram_P"/, `id="${names.diagram}"`)
    .replace(/id="BPMNPlane_P"/, `id="${names.plane}"`)
    .replace(/<dc:Bounds x="(\d+)"/g, (_m, x: string) => `<dc:Bounds x="${Number(x) + 7}"`);
}

const suffix = (_k: string, id: string): string => `${id}_di`;

/** DI ids by element id, and the plane / diagram ids. */
function diOf(xml: string): { shapes: Map<string, string>; planes: string[]; diagrams: string[] } {
  const shapes = new Map<string, string>();
  for (const m of xml.matchAll(/<bpmndi:BPMN(?:Shape|Edge) id="([^"]+)" bpmnElement="([^"]+)"/g)) shapes.set(m[2]!, m[1]!);
  return {
    shapes,
    planes: [...xml.matchAll(/<bpmndi:BPMNPlane id="([^"]+)"/g)].map((m) => m[1]!),
    diagrams: [...xml.matchAll(/<bpmndi:BPMNDiagram id="([^"]+)"/g)].map((m) => m[1]!),
  };
}

async function write(xml: string, ops: Op[], opts: MutationOptions = {}): Promise<string> {
  return (await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts })).xml;
}

describe('a full redraw keeps the DI ids', () => {
  it('keeps <id>_di, BPMNDiagram_1 and BPMNPlane_1 of a modeler file (layout full, clean engine)', async () => {
    const xml = await drawn(suffix);
    const before = diOf(xml);
    expect(before.shapes.get('A')).toBe('A_di');
    const after = await write(xml, [], { layout: 'full' });
    expect(diOf(after)).toEqual(before);
    // only geometry changed
    const strip = (s: string): string => s.replace(/ (x|y|width|height)="[^"]*"/g, '');
    expect(strip(after)).toBe(strip(xml));
  });

  it('new DI of the same write follows the file style; removed DI is gone', async () => {
    const after = diOf(await write(await drawn(suffix), [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }, { op: 'remove', ids: ['E2'] }], { layout: 'full' }));
    expect(after.shapes.get('N')).toBe('N_di');
    expect(after.shapes.get('E2')).toBeUndefined();
    for (const [el, di] of after.shapes) expect(di).toBe(`${el}_di`);
    expect(after.planes).toEqual(['BPMNPlane_1']);
  });

  it('follows Shape_<id> / Edge_<id> files and the bpmn-auto-layout engine', async () => {
    const xml = await drawn((kind, id) => `${kind}_${id}`, { diagram: 'Diagram_x', plane: 'Plane_x' });
    const after = diOf(await write(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }], { layout: 'full', engine: 'auto' }));
    expect(after.shapes.get('A')).toBe('Shape_A');
    expect(after.shapes.get('F_yes')).toBe('Edge_F_yes');
    expect(after.shapes.get('N')).toBe('Shape_N');
    expect(after.diagrams).toEqual(['Diagram_x']);
    expect(after.planes).toEqual(['Plane_x']);
  });

  it('an engine-owned drawing redrawn by auto keeps its ids too', async () => {
    const engine = (await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true })).xml;
    const renamed = engine.replace(/id="BPMNShape_A"/, 'id="Mine_A"');
    const r = await mutateDoc(await Doc.fromXml(renamed, 'x.bpmn'), [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }], { dryRun: true });
    expect(r.layout.mode).toBe('full');
    expect(diOf(r.xml).shapes.get('A')).toBe('Mine_A');
    expect(diOf(r.xml).shapes.get('N')).toBe('BPMNShape_N');
  });

  it('a new pool keeps a modeler plane id; a plane named after the old root follows the new root', async () => {
    const pool: Op = { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' };
    const modeler = diOf(await write(await drawn(suffix), [pool], { layout: 'full' }));
    expect(modeler.planes).toEqual(['BPMNPlane_1']);
    expect(modeler.diagrams).toEqual(['BPMNDiagram_1']);
    expect(modeler.shapes.get('Pool')).toBe('Pool_di');
    const engine = await drawn(suffix, { diagram: 'BPMNDiagram_P', plane: 'BPMNPlane_P' });
    const moved = diOf(await write(engine, [pool], { layout: 'full' }));
    expect(moved.planes[0]).toMatch(/^BPMNPlane_Collaboration_/);
    expect(moved.shapes.get('A')).toBe('A_di');
  });

  it('keeps the plane and diagram ids of a collapsed sub-process', async () => {
    const ops: Op[] = [...OPS, { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'C', collapsed: true }, { op: 'add', kind: 'task', id: 'In', name: 'Inner', in: 'Sub' }];
    const engine = (await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true })).xml;
    const custom = engine.replace('id="BPMNPlane_Sub"', 'id="Sub_plane"').replace('id="BPMNDiagram_Sub"', 'id="Sub_diagram"').replace(/<dc:Bounds x="(\d+)"/, (_m, x: string) => `<dc:Bounds x="${Number(x) + 3}"`);
    const after = diOf(await write(custom, [], { layout: 'full' }));
    expect(after.planes).toContain('Sub_plane');
    expect(after.diagrams).toContain('Sub_diagram');
  });

  it('a file without DI gets the engine ids', async () => {
    const after = diOf((await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true })).xml);
    expect(after.shapes.get('A')).toBe('BPMNShape_A');
    expect(after.planes).toEqual(['BPMNPlane_P']);
  });
});
