import { type BpmnDocument, type BpmnElement, type ProfileFinding } from '../../../model/index.js';
import { RuleReporter } from './RuleReporter.js';

export type ElementStep = 'descend' | 'stop';

export abstract class RuleWalk {
  constructor(protected readonly document: BpmnDocument) {}

  findings(): ProfileFinding[] {
    const reporter = new RuleReporter(this.document.tree.definitions);
    this.checkDocument(reporter);
    return reporter.findings;
  }

  protected abstract checkDocument(reporter: RuleReporter): void;

  protected abstract checkElement(element: BpmnElement, reporter: RuleReporter): ElementStep;

  protected visit(element: BpmnElement, owner: BpmnElement | undefined, executable: boolean, reporter: RuleReporter): void {
    reporter.enter(element, owner, executable);
    if (this.checkElement(element, reporter) === 'stop') {
      return;
    }
    const next = element.id ? element : owner;
    for (const child of RuleWalk.bpmnChildren(element)) {
      this.visit(child, next, executable, reporter);
    }
  }

  private static bpmnChildren(element: BpmnElement): BpmnElement[] {
    if (element.isGeneric) {
      return [];
    }
    const contained = (element.descriptor.properties ?? []).filter(({ name, isReference }) => !isReference && name !== 'extensionElements' && name !== 'diagrams');
    return contained.flatMap(({ name }) => [element.peek<unknown>(name)].flat()).filter((child): child is BpmnElement => RuleWalk.isBpmnChild(child));
  }

  private static isBpmnChild(child: unknown): child is BpmnElement {
    return child instanceof Object && 'isBpmn' in child && 'isDrawingPart' in child && child.isBpmn === true && child.isDrawingPart === false;
  }
}
