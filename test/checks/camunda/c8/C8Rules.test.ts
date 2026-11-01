import { describe, expect, it } from 'vitest';
import { C8Rules } from '../../../../src/checks/camunda/c8/C8Rules.js';
import { RuleContext } from '../../../../src/checks/camunda/rules/RuleContext.js';
import { RuleReporter } from '../../../../src/checks/camunda/rules/RuleReporter.js';
import type { BpmnElement } from '../../../../src/model/index.js';
import { EngineRows } from '../../../support/EngineRows.js';
import { Fixtures } from '../../../support/Fixtures.js';

class ConditionRule extends C8Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    const juel = element.peek<BpmnElement>('conditionExpression')?.peek<string>('body') ?? '';
    reporter.practice({ code: 'W_C8_TEST', element, subject: `${this.isFeel(juel)}`, message: this.feelOf(juel), hint: this.describe(element) });
  }
}

describe('C8Rules', () => {
  it('tells a FEEL condition and names a flow by its kind and id', async () => {
    const document = await Fixtures.read('engine/verdicts/c8-feel-and-deploy/000-condition-x-y.bpmn');
    const flow = document.tree.processes().flatMap((process) => document.flows.sequenceFlows(process)).find((candidate) => candidate.peek('conditionExpression'))!;
    const rule = new ConditionRule(new RuleContext(document, EngineRows.namespacesOf(document), 'zeebe'));
    const reporter = new RuleReporter(document.tree.definitions);
    rule.check(flow, reporter);

    expect(reporter.findings[0]!.subject).toBe('true');
    expect(reporter.findings[0]!.hint).toBe(`sequenceFlow ${flow.id}`);
  });
});
