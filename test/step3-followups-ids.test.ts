/**
 * Step 3 follow-ups, ids: an anchor name with a number keeps its speaking
 * stem, a data reference and the element it stands for get distinct
 * speaking ids in a file with type-named prefixes, and DI ids derived from
 * long element ids keep the 64 character cap. Synthetic models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { MAX_ID } from '../src/ids.js';
import { speakingStem } from '../src/idstyle.js';

const flowIds = (xml: string): string[] => [...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((m) => m[1]!);
const allIds = (xml: string): string[] => [...xml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
/** a flow id with a side that is only a word for a kind (Flow_CheckToGateway, Flow_GatewayToAfterGateway) */
const GENERIC_SIDE = /(^Flow_|To)(Gateway|AfterGateway|Join|Task|Timer|Catch)(To|$|_\d+$)/;

describe('an anchor name with a number keeps its speaking stem', () => {
  it('speakingStem keeps names with numbers, not machine ids', () => {
    expect(speakingStem('Gateway_AfterCheck2024')).toBe('AfterCheck2024');
    expect(speakingStem('Activity_Order01001')).toBe('Order01001');
    expect(speakingStem('Gateway_AfterBp01001Ui')).toBe('AfterBp01001Ui');
    // machine ids stay without a stem
    expect(speakingStem('sid-6F1C3A2B-1A2B-4C3D-8E9F-0A1B2C3D4E5F')).toBeUndefined();
    expect(speakingStem('Activity_0k3x9qa')).toBeUndefined();
    expect(speakingStem('Task_12')).toBeUndefined();
    expect(speakingStem('Id_a3f2c1de4b5a')).toBeUndefined();
  });

  for (const name of ['Check 2024', 'Order 01 001', 'BP 01 001 UI']) {
    it(`the split after "${name}": the flows and the unnamed task name the gateways, not their kind`, async () => {
      const ops = [
        { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Bp', as: '$s' },
        { op: 'add', kind: 'userTask', name, after: '$s', as: '$u' },
        { op: 'add', kind: 'endEvent', name: 'Done', after: '$u' },
        { op: 'split', after: '$u', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'serviceTask', name: 'Reserve stock' }] }, { nodes: [{ kind: 'serviceTask' }] }] },
      ];
      const r = await applyToXml((await newXml({ processName: 'Bp' })).xml, ops, { layout: false });
      const flows = flowIds(r.xml);
      for (const id of flows) expect(id).not.toMatch(GENERIC_SIDE);
      expect(allIds(r.xml).filter((id) => /^Activity_/.test(id))).not.toContain('Activity_AfterGateway');
      expect(new Set(flows).size).toBe(flows.length);
      expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_ID_SUFFIXED');
    });
  }

  it('the exact ids after Check 2024', async () => {
    const ops = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Bp', as: '$s' },
      { op: 'add', kind: 'userTask', name: 'Check 2024', after: '$s', as: '$u' },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$u' },
      { op: 'split', after: '$u', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'serviceTask', name: 'Reserve stock' }] }, { nodes: [{ kind: 'serviceTask' }] }] },
    ];
    const r = await applyToXml((await newXml({ processName: 'Bp' })).xml, ops, { layout: false });
    expect(flowIds(r.xml).sort()).toEqual(
      [
        'Flow_StartToCheck2024',
        'Flow_Check2024ToAfterCheck2024',
        'Flow_AfterCheck2024ToReserveStock',
        'Flow_AfterCheck2024ToServiceTaskAfterCheck2024',
        'Flow_ReserveStockToCheck2024Join',
        'Flow_ServiceTaskAfterCheck2024ToCheck2024Join',
        'Flow_Check2024JoinToDone',
      ].sort(),
    );
  });
});

/** A camelCase file whose prefixes are the element types (startEvent_, serviceTask_), without data. */
const CAMEL = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="definitions_import" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="process_import" isExecutable="true">
    <bpmn:startEvent id="startEvent_importStarted" name="Import started"><bpmn:outgoing>flow_importStartedToImportArticles</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="serviceTask_importArticles" name="Import articles"><bpmn:incoming>flow_importStartedToImportArticles</bpmn:incoming><bpmn:outgoing>flow_importArticlesToImportDone</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_importDone" name="Import done"><bpmn:incoming>flow_importArticlesToImportDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_importStartedToImportArticles" sourceRef="startEvent_importStarted" targetRef="serviceTask_importArticles" />
    <bpmn:sequenceFlow id="flow_importArticlesToImportDone" sourceRef="serviceTask_importArticles" targetRef="endEvent_importDone" />
  </bpmn:process>
</bpmn:definitions>`;

describe('a data reference and the element it stands for get distinct speaking ids', () => {
  it('type-named prefixes: dataObjectReference_invoice and dataObject_invoice, no suffix', async () => {
    const r = await applyToXml(CAMEL, [{ op: 'add', kind: 'dataObjectReference', name: 'Invoice', in: 'process_import', as: '$d' }, { op: 'connect', source: 'serviceTask_importArticles', target: '$d' }], { layout: false });
    expect(r.xml).toContain('<bpmn:dataObjectReference id="dataObjectReference_invoice" name="Invoice" dataObjectRef="dataObject_invoice" />');
    expect(r.xml).toContain('<bpmn:dataObject id="dataObject_invoice" />');
    expect(r.result.aliases).toEqual({ $d: 'dataObjectReference_invoice' });
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_ID_SUFFIXED');
  });

  it('type-named prefixes: dataStoreReference_invoice and dataStore_invoice, no suffix', async () => {
    const r = await applyToXml(CAMEL, [{ op: 'add', kind: 'dataStoreReference', name: 'Invoice', in: 'process_import' }], { layout: false });
    expect(r.xml).toContain('<bpmn:dataStoreReference id="dataStoreReference_invoice" name="Invoice" dataStoreRef="dataStore_invoice" />');
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_ID_SUFFIXED');
  });

  it('a file that names references and data objects with one prefix: the data object says what it is, no suffix', async () => {
    const xml = CAMEL.replace(
      '<bpmn:sequenceFlow id="flow_importStartedToImportArticles"',
      `<bpmn:dataObjectReference id="data_order" name="Order" dataObjectRef="data_orderObject" />
    <bpmn:dataObject id="data_orderObject" />
    <bpmn:dataObjectReference id="data_article" name="Article" dataObjectRef="data_articleObject" />
    <bpmn:dataObject id="data_articleObject" />
    <bpmn:sequenceFlow id="flow_importStartedToImportArticles"`,
    );
    const r = await applyToXml(xml, [{ op: 'add', kind: 'dataObjectReference', name: 'Invoice', in: 'process_import', as: '$d' }], { layout: false });
    const ref = r.result.aliases!.$d!;
    const object = /<bpmn:dataObjectReference id="[^"]+" name="Invoice" dataObjectRef="([^"]+)"/.exec(r.xml)![1]!;
    expect(ref).toBe('data_invoice');
    expect(object).toBe('data_invoiceObject');
    expect(object).not.toMatch(/_\d+$/);
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_ID_SUFFIXED');
  });
});

describe('DI ids derived from long element ids keep the 64 character cap', () => {
  for (const style of ['Shape_/Edge_', 'BPMNShape_/BPMNEdge_', '_di']) {
    it(`a file whose DI ids are ${style}`, async () => {
      const base = await applyToXml((await newXml({ processName: 'Meter' })).xml, [
        { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Meter', as: '$s' },
        { op: 'add', kind: 'userTask', name: '4-Augen-Prinzip: prüfen', after: '$s', as: '$a' },
        { op: 'add', kind: 'endEvent', name: 'Done', after: '$a' },
      ]);
      const xml =
        style === 'Shape_/Edge_'
          ? base.xml.replace(/id="BPMN(Shape|Edge)_/g, (_m, k: string) => `id="${k}_`)
          : style === '_di'
            ? base.xml.replace(/id="BPMN(?:Shape|Edge)_([^"]+)"/g, (_m, id: string) => `id="${id}_di"`)
            : base.xml;
      const r = await applyToXml(xml, [
        { op: 'add', kind: 'userTask', name: '4-Augen-Prinzip: prüfen & freigeben (2. Stufe)?', after: 'Activity_4AugenPrinzipPruefen', as: '$q' },
        { op: 'add', kind: 'serviceTask', name: '审批 订单', after: '$q' },
      ]);
      const ids = allIds(r.xml);
      expect(ids.filter((id) => id.length > MAX_ID)).toEqual([]);
      expect(new Set(ids).size).toBe(ids.length);
      // the long flow still has its edge, in the file's style
      const flow = flowIds(r.xml).sort((a, b) => b.length - a.length)[0]!;
      expect(flow.length).toBeGreaterThan(MAX_ID - 'Edge_'.length);
      const edge = new RegExp(`<bpmndi:BPMNEdge id="([^"]+)" bpmnElement="${flow}"`).exec(r.xml)![1]!;
      expect(edge.startsWith(style === 'Shape_/Edge_' ? 'Edge_' : style === '_di' ? 'Flow_' : 'BPMNEdge_')).toBe(true);
    });
  }
});
