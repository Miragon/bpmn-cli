/**
 * A full redraw keeps the DI ids of the file (only geometry changes); new DI
 * follows the file's DI id style, and every DI id bpmn-cli writes stays
 * within 64 characters. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { styledId } from '../../../../src/domain/diagram/utils/di-ids.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import { cutAt } from '../../../../src/domain/document/utils/slug.js';
import type { EditCommand } from '../../../../src/domain/commands/types.js';
import { mutateDoc } from '../../../../src/index.js';
import { type MutationOptions } from '../../../../src/domain/batch/types.js';

const OPS: EditCommand[] = [
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
  const outcome = await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true });
  return outcome.xml
    .replace(/<bpmndi:BPMN(Shape|Edge) id="BPMN(?:Shape|Edge)_([^"]+)"/g, (_m, kind: 'Shape' | 'Edge', id: string) => `<bpmndi:BPMN${kind} id="${style(kind, id)}"`)
    .replace(/id="BPMNDiagram_P"/, `id="${names.diagram}"`)
    .replace(/id="BPMNPlane_P"/, `id="${names.plane}"`)
    .replace(/<dc:Bounds x="(\d+)"/g, (_m, left: string) => `<dc:Bounds x="${Number(left) + 7}"`);
}

const suffix = (_k: string, id: string): string => `${id}_di`;

/** DI ids by element id, and the plane / diagram ids. */
function diOf(xml: string): { shapes: Map<string, string>; planes: string[]; diagrams: string[] } {
  const shapes = new Map<string, string>();
  for (const match of xml.matchAll(/<bpmndi:BPMN(?:Shape|Edge) id="([^"]+)" bpmnElement="([^"]+)"/g)) shapes.set(match[2]!, match[1]!);
  return {
    shapes,
    planes: [...xml.matchAll(/<bpmndi:BPMNPlane id="([^"]+)"/g)].map((match) => match[1]!),
    diagrams: [...xml.matchAll(/<bpmndi:BPMNDiagram id="([^"]+)"/g)].map((match) => match[1]!),
  };
}

async function write(xml: string, ops: EditCommand[], opts: MutationOptions = {}): Promise<string> {
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
    const strip = (source: string): string => source.replace(/ (x|y|width|height)="[^"]*"/g, '');
    expect(strip(after)).toBe(strip(xml));
  });

  it('new DI of the same write follows the file style; removed DI is gone', async () => {
    const after = diOf(await write(await drawn(suffix), [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }, { op: 'remove', ids: ['E2'] }], { layout: 'full' }));
    expect(after.shapes.get('N')).toBe('N_di');
    expect(after.shapes.get('E2')).toBeUndefined();
    for (const [el, di] of after.shapes) expect(di).toBe(`${el}_di`);
    expect(after.planes).toEqual(['BPMNPlane_1']);
  });

  it('follows Shape_<id> / Edge_<id> files', async () => {
    const xml = await drawn((kind, id) => `${kind}_${id}`, { diagram: 'Diagram_x', plane: 'Plane_x' });
    const after = diOf(await write(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }], { layout: 'full' }));
    expect(after.shapes.get('A')).toBe('Shape_A');
    expect(after.shapes.get('F_yes')).toBe('Edge_F_yes');
    expect(after.shapes.get('N')).toBe('Shape_N');
    expect(after.diagrams).toEqual(['Diagram_x']);
    expect(after.planes).toEqual(['Plane_x']);
  });

  it('an engine-owned drawing redrawn by auto keeps its ids too', async () => {
    const engine = (await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true })).xml;
    const renamed = engine.replace(/id="BPMNShape_A"/, 'id="Mine_A"');
    const outcome = await mutateDoc(await Doc.fromXml(renamed, 'x.bpmn'), [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }], { dryRun: true });
    expect(outcome.layout.mode).toBe('full');
    expect(diOf(outcome.xml).shapes.get('A')).toBe('Mine_A');
    expect(diOf(outcome.xml).shapes.get('N')).toBe('BPMNShape_N');
  });

  it('a new pool keeps a modeler plane id; a plane named after the old root follows the new root', async () => {
    const pool: EditCommand = { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' };
    const modeler = diOf(await write(await drawn(suffix), [pool], { layout: 'full' }));
    expect(modeler.planes).toEqual(['BPMNPlane_1']);
    expect(modeler.diagrams).toEqual(['BPMNDiagram_1']);
    expect(modeler.shapes.get('Pool')).toBe('Pool_di');
    const engine = await drawn(suffix, { diagram: 'BPMNDiagram_P', plane: 'BPMNPlane_P' });
    const moved = diOf(await write(engine, [pool], { layout: 'full' }));
    expect(moved.planes[0]).toMatch(/^BPMNPlane_collaboration_/);
    expect(moved.shapes.get('A')).toBe('A_di');
  });

  it('keeps the plane and diagram ids of a collapsed sub-process', async () => {
    const ops: EditCommand[] = [...OPS, { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'C', collapsed: true }, { op: 'add', kind: 'task', id: 'In', name: 'Inner', in: 'Sub' }];
    const engine = (await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true })).xml;
    const custom = engine.replace('id="BPMNPlane_Sub"', 'id="Sub_plane"').replace('id="BPMNDiagram_Sub"', 'id="Sub_diagram"').replace(/<dc:Bounds x="(\d+)"/, (_m, left: string) => `<dc:Bounds x="${Number(left) + 3}"`);
    const after = diOf(await write(custom, [], { layout: 'full' }));
    expect(after.planes).toContain('Sub_plane');
    expect(after.diagrams).toContain('Sub_diagram');
  });

  it('a new plane never takes the ids of another old diagram', async () => {
    const ops: EditCommand[] = [...OPS, { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', after: 'C' }, { op: 'add', kind: 'task', id: 'In', name: 'Inner', in: 'Sub' }];
    const engine = (await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true })).xml;
    // a second view of the process, as some tools write it
    const second = /<bpmndi:BPMNDiagram id="BPMNDiagram_P">[\s\S]*?<\/bpmndi:BPMNDiagram>/.exec(engine)![0].replace('BPMNDiagram_P', 'BPMNDiagram_2').replace('BPMNPlane_P', 'BPMNPlane_2').replace(/ id="BPMN(Shape|Edge)_/g, ' id="View2_');
    const xml = engine.replace('</bpmndi:BPMNDiagram>', `</bpmndi:BPMNDiagram>${second}`);
    const after = diOf(await write(xml, [], { layout: 'full', collapse: ['Sub'] }));
    expect(after.planes).toEqual(['BPMNPlane_P', 'BPMNPlane_Sub']);
    expect(after.diagrams).toEqual(['BPMNDiagram_P', 'BPMNDiagram_Sub']);
  });

  it('a file without DI gets the engine ids', async () => {
    const after = diOf((await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true })).xml);
    expect(after.shapes.get('A')).toBe('BPMNShape_A');
    expect(after.planes).toEqual(['BPMNPlane_P']);
  });
});

/** The ids of every BPMNShape, BPMNEdge, BPMNPlane and BPMNDiagram. */
const allDi = (xml: string): string[] => [...xml.matchAll(/<bpmndi:BPMN(?:Shape|Edge|Plane|Diagram) id="([^"]+)"/g)].map((match) => match[1]!);

const LONG_PROCESS = 'Process_SupplierInvoicesOfTheAccountsPayableDepartment';
const APPROVE = 'Activity_ApproveTheIncomingSupplierInvoiceForPaymentInTheLedger';
const SUB = 'Activity_HandleTheIncomingSupplierInvoicesOfTheAccountsPayable';

/** Element ids of 52 to 64 characters, flows named after long names (64), a collapsed sub-process; two ids alike in their first 51 characters. */
const LONG_OPS: EditCommand[] = [
  { op: 'add', kind: 'startEvent', id: 'Event_SupplierInvoiceReceivedByTheAccountsPayableDepartment', name: 'Supplier invoice received by the accounts payable department' },
  { op: 'add', kind: 'userTask', id: 'Activity_CheckTheIncomingSupplierInvoiceAgainstTheOrderAndTheDel', name: 'Check the incoming supplier invoice against the order', after: 'Event_SupplierInvoiceReceivedByTheAccountsPayableDepartment' },
  { op: 'add', kind: 'task', id: `${APPROVE}A`, name: 'Approve the incoming supplier invoice for payment', after: 'Activity_CheckTheIncomingSupplierInvoiceAgainstTheOrderAndTheDel' },
  { op: 'add', kind: 'task', id: `${APPROVE}B`, name: 'Approve the incoming supplier invoice for payment in the ledger', after: `${APPROVE}A` },
  { op: 'add', kind: 'subProcess', id: SUB, name: 'Handle the incoming supplier invoices', after: `${APPROVE}B`, collapsed: true },
  { op: 'add', kind: 'task', id: 'Activity_Inner', name: 'Inner', in: SUB },
  { op: 'add', kind: 'endEvent', id: 'Event_End', name: 'Supplier invoice booked', after: SUB },
];

describe('every DI id bpmn-cli writes stays within 64 characters', () => {
  for (const engine of ['clean', 'auto'] as const) {
    it(`a fresh drawing cuts the DI ids of long element, flow, sub-process and process ids at whole words; two alike take _2 (${engine})`, async () => {
      const outcome = await mutateDoc(Doc.create({ processId: LONG_PROCESS }), LONG_OPS, { dryRun: true, engine });
      const ids = allDi(outcome.xml);
      expect(ids.filter((id) => id.length > 64)).toEqual([]);
      expect(new Set(ids).size).toBe(ids.length);
      const { shapes, planes, diagrams } = diOf(outcome.xml);
      const flows = [...outcome.xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((match) => match[1]!);
      expect(flows.some((flowId) => flowId.length > 52)).toBe(true);
      for (const flowId of flows) expect(shapes.get(flowId)).toBe(styledId('bpmn', 'Edge', flowId));
      // the engine's form, cut like the element ids themselves
      expect(shapes.get(`${APPROVE}A`)).toBe('BPMNShape_Activity_ApproveTheIncomingSupplierInvoiceFor');
      expect(shapes.get(`${APPROVE}B`)).toBe('BPMNShape_Activity_ApproveTheIncomingSupplierInvoiceFor_2');
      expect(shapes.get(SUB)).toBe(styledId('bpmn', 'Shape', SUB));
      expect(shapes.get('Activity_Inner')).toBe('BPMNShape_Activity_Inner');
      expect(shapes.get('Event_End')).toBe('BPMNShape_Event_End');
      expect(planes).toEqual([`BPMNPlane_${cutAt(LONG_PROCESS, 51)}`, `BPMNPlane_${cutAt(SUB, 51)}`]);
      expect(diagrams).toEqual([`BPMNDiagram_${cutAt(LONG_PROCESS, 49)}`, `BPMNDiagram_${cutAt(SUB, 49)}`]);
      // a full redraw keeps them
      const again = await write(outcome.xml, [], { layout: 'full', engine });
      expect(allDi(again)).toEqual(ids);
    });
  }

  it('an id that needs no cut keeps its DI id where a cut one would take it, and ids up to 51 characters stay uncut', async () => {
    const short = 'Activity_ApproveTheIncomingSupplierInvoiceFor';
    const fits = 'Activity_ApproveTheIncomingSupplierInvoiceForPaymen';
    expect([short.length, fits.length, 'Flow_ApproveTheIncomingSupplierInvoiceForToApproveXY'.length]).toEqual([45, 51, 52]);
    const ops: EditCommand[] = [
      { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
      { op: 'add', kind: 'task', id: APPROVE, name: 'Approve', after: 'S' },
      { op: 'add', kind: 'task', id: short, name: 'Approve again', after: APPROVE },
      { op: 'add', kind: 'task', id: fits, name: 'Approve once more', after: short, flowId: 'Flow_ApproveTheIncomingSupplierInvoiceForToApproveXY' },
    ];
    for (const engine of ['clean', 'auto'] as const) {
      const { shapes } = diOf((await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true, engine })).xml);
      expect(shapes.get(short)).toBe(`BPMNShape_${short}`);
      expect(shapes.get(APPROVE)).toBe(`BPMNShape_${short}_2`);
      expect(shapes.get(fits)).toBe(`BPMNShape_${fits}`);
      expect(shapes.get('Flow_ApproveTheIncomingSupplierInvoiceForToApproveXY')).toBe('BPMNEdge_Flow_ApproveTheIncomingSupplierInvoiceForToApproveXY');
    }
  });

  it('an old DI id over 64 characters stays: a redraw never renames an id the file had', async () => {
    const long = `BPMNShape_A_${'x'.repeat(60)}`;
    const xml = (await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true })).xml.replace('id="BPMNShape_A"', `id="${long}"`);
    expect(diOf(await write(xml, [], { layout: 'full' })).shapes.get('A')).toBe(long);
  });

  it('a plane and diagram id cut from a long process id follow a new collaboration root (both engines)', async () => {
    const ops: EditCommand[] = [
      { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
      { op: 'add', kind: 'task', id: 'A', name: 'Check', after: 'S' },
    ];
    const pool: EditCommand = { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' };
    for (const engine of ['clean', 'auto'] as const) {
      for (const pid of [LONG_PROCESS, 'Process_HandleTheIncomingSupplierInvoicesOfTheAccountsPayable']) {
        const fresh = (await mutateDoc(Doc.create({ processId: pid }), ops, { dryRun: true, engine })).xml;
        expect(diOf(fresh).planes).toEqual([`BPMNPlane_${cutAt(pid, 51)}`]);
        for (const layout of ['full', 'auto'] as const) {
          const after = diOf(await write(fresh, [pool], { layout, engine }));
          expect(after.planes[0]).toMatch(/^BPMNPlane_collaboration_/);
          expect(after.diagrams[0]).toMatch(/^BPMNDiagram_collaboration_/);
          expect([...after.planes, ...after.diagrams].filter((id) => id.length > 64)).toEqual([]);
        }
      }
    }
  });

  it('a sub-process collapsed without a drawing (--no-layout) records it under a plane and diagram id within 64 characters', async () => {
    const outcome = await mutateDoc(Doc.create({ processId: LONG_PROCESS }), [{ op: 'add', kind: 'subProcess', id: 'Sub', name: 'Sub', collapsed: true }], { dryRun: true, layout: false });
    expect(diOf(outcome.xml).planes).toEqual([`BPMNPlane_${cutAt(LONG_PROCESS, 51)}`]);
    expect(diOf(outcome.xml).diagrams).toEqual([`BPMNDiagram_${cutAt(LONG_PROCESS, 49)}`]);
  });
});
