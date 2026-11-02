import { describe, expect, it } from 'vitest';
import type { RuleReporter } from '../../../../src/checks/camunda/rules/RuleReporter.js';
import { type ElementStep, RuleWalk } from '../../../../src/checks/camunda/rules/RuleWalk.js';
import type { BpmnElement } from '../../../../src/model/index.js';
import { Fixtures } from '../../../support/Fixtures.js';

class VisitedElements extends RuleWalk {
  readonly seen: Array<[string, string | undefined]> = [];

  protected override checkDocument(reporter: RuleReporter): void {
    this.visit(this.document.tree.require('P'), undefined, true, reporter);
  }

  protected override checkElement(element: BpmnElement, reporter: RuleReporter): ElementStep {
    this.seen.push([element.type, reporter.owner?.id]);
    return element.is('bpmn:SubProcess') ? 'stop' : 'descend';
  }
}

describe('RuleWalk', () => {
  it('walks the BPMN children and tells each its owner with an id', async () => {
    const walk = new VisitedElements(await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn'));
    walk.findings();

    expect(walk.seen).toContainEqual(['bpmn:Process', undefined]);
    expect(walk.seen).toContainEqual(['bpmn:CancelEventDefinition', 'B']);
  });

  it('does not enter what a rule stops at', async () => {
    const walk = new VisitedElements(await Fixtures.read('engine/structure/message-start-in-an-embedded-sub-process.bpmn'));
    walk.findings();

    expect(walk.seen.map(([type]) => type)).not.toContain('bpmn:MessageEventDefinition');
  });
});
