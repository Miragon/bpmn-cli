import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ShapeSizes } from '../../../src/drawing/plane/ShapeSizes.js';
import { Fixtures } from '../../support/Fixtures.js';

const require = createRequire(import.meta.url);

interface Report {
  id: string;
  message: string;
}

interface RuleNode {
  $type: string;
  $parent?: RuleNode;
}

interface Rule {
  check: (node: RuleNode, reporter: { report: (id: string, message: string) => void }) => void;
}

function standardSize(): Rule {
  return (require('bpmnlint/rules/standard-size') as () => Rule)();
}

const SHAPES: Array<[string, string, string]> = [
  ['bpmn:task', 'task', 'TASK'],
  ['bpmn:callActivity', 'call', 'TASK'],
  ['bpmn:subProcess', 'collapsed', 'TASK'],
  ['bpmn:exclusiveGateway', 'gateway', 'GATEWAY'],
  ['bpmn:startEvent', 'event', 'EVENT'],
  ['bpmn:boundaryEvent attachedToRef="task"', 'boundary', 'EVENT'],
  ['bpmn:dataObjectReference dataObjectRef="data"', 'object', 'DATA_OBJECT'],
  ['bpmn:dataStoreReference', 'store', 'DATA_STORE'],
];

function model(size: (name: string) => { width: number; height: number }): string {
  const elements = SHAPES.map(([tag, id]) => `<${tag} id="${id}" />`).join('');
  const shapes = SHAPES.map(([, id, name]) => {
    const { width, height } = size(name);
    return `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${id === 'collapsed' ? ' isExpanded="false"' : ''}><dc:Bounds x="0" y="0" width="${width}" height="${height}" /></bpmndi:BPMNShape>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="definitions" targetNamespace="http://bpmn.io/schema/bpmn"><bpmn:process id="process"><bpmn:dataObject id="data" />${elements}</bpmn:process><bpmndi:BPMNDiagram id="diagram"><bpmndi:BPMNPlane id="plane" bpmnElement="process">${shapes}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}

async function reportsOn(xml: string): Promise<Report[]> {
  const { BpmnModdle } = require('bpmn-moddle') as { BpmnModdle: new () => { fromXML(xml: string): Promise<{ rootElement: { diagrams: Array<{ plane: { planeElement: RuleNode[] } }> } }> } };
  const { rootElement } = await new BpmnModdle().fromXML(xml);
  const rule = standardSize();
  const reports: Report[] = [];
  const reporter = { report: (id: string, message: string): void => void reports.push({ id, message }) };
  for (const shape of rootElement.diagrams[0]!.plane.planeElement) {
    rule.check(shape, reporter);
  }
  return reports;
}

describe('ShapeSizes', () => {
  const table = ShapeSizes as unknown as Record<string, { width: number; height: number }>;

  it("holds each shape to bpmnlint's standard-size", async () => {
    expect(await reportsOn(model((name) => table[name]!))).toEqual([]);
  });

  it('is reported by standard-size 1 px larger, one report per shape', async () => {
    const reports = await reportsOn(model((name) => ({ width: table[name]!.width + 1, height: table[name]!.height + 1 })));

    expect(reports).toHaveLength(SHAPES.length);
  });

  it('sizes an element by its kind', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    expect(ShapeSizes.of(Fixtures.element(document, 'A'))).toEqual({ width: 100, height: 80 });
    expect(ShapeSizes.of(Fixtures.element(document, 'B'))).toEqual({ width: 36, height: 36 });
  });

  it('grows an annotation with its text, 100 to 300 wide', () => {
    expect(ShapeSizes.ofAnnotation(undefined)).toEqual({ width: 100, height: 30 });
    expect(ShapeSizes.ofAnnotation('x'.repeat(30)).width).toBe(220);
    expect(ShapeSizes.ofAnnotation('x'.repeat(400)).width).toBe(300);
    expect(ShapeSizes.ofAnnotation('x'.repeat(400)).height).toBeGreaterThan(30);
  });
});
