import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface SizeReport {
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

type Parsed = { rootElement: { diagrams?: Array<{ plane?: { planeElement?: RuleNode[] } }> } };

export class StandardSize {
  static async reportsOn(xml: string): Promise<SizeReport[]> {
    const { BpmnModdle } = require('bpmn-moddle') as { BpmnModdle: new () => { fromXML(xml: string): Promise<Parsed> } };
    const { rootElement } = await new BpmnModdle().fromXML(xml);
    const rule = (require('bpmnlint/rules/standard-size') as () => Rule)();
    const reports: SizeReport[] = [];
    const reporter = { report: (id: string, message: string): void => void reports.push({ id, message }) };
    for (const diagram of rootElement.diagrams ?? []) {
      for (const shape of diagram.plane?.planeElement ?? []) {
        rule.check(shape, reporter);
      }
    }
    return reports;
  }
}
