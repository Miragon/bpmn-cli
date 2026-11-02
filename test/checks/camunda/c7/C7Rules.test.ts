import { describe, expect, it } from 'vitest';
import { C7Rules } from '../../../../src/checks/camunda/c7/C7Rules.js';
import { RuleContext } from '../../../../src/checks/camunda/rules/RuleContext.js';
import { RuleReporter } from '../../../../src/checks/camunda/rules/RuleReporter.js';
import type { BpmnDocument, BpmnElement } from '../../../../src/model/index.js';
import { EngineRows } from '../../../support/EngineRows.js';
import { Fixtures } from '../../../support/Fixtures.js';

class ActingDefinitionRule extends C7Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    const acted = this.actedOn(element).map((definition) => this.triggerName(definition)).join();
    reporter.practice({ code: 'W_C7_TEST', element, subject: acted, message: this.describe(element, undefined), hint: acted });
  }
}

describe('C7Rules', () => {
  const reported = (document: BpmnDocument, id: string) => {
    const rule = new ActingDefinitionRule(new RuleContext(document, EngineRows.namespacesOf(document), 'camunda'));
    const reporter = new RuleReporter(document.tree.definitions);
    rule.check(document.tree.require(id), reporter);
    return reporter.findings[0]!;
  };

  it('reads the definition the engines act on when an event has several', async () => {
    const document = await Fixtures.read('engine/structure/event-with-two-definitions.bpmn');

    expect(reported(document, 'Start').subject).toBe('timer');
  });

  it('names an element by its kind and id', async () => {
    const document = await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn');

    expect(reported(document, 'T').message).toBe('task T');
  });
});
