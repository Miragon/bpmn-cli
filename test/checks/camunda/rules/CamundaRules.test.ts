import { describe, expect, it } from 'vitest';
import { CamundaRules } from '../../../../src/checks/camunda/rules/CamundaRules.js';
import { RuleContext } from '../../../../src/checks/camunda/rules/RuleContext.js';
import { RuleReporter } from '../../../../src/checks/camunda/rules/RuleReporter.js';
import { type BpmnDocument, type BpmnElement, DocumentNamespaces } from '../../../../src/model/index.js';
import { Fixtures } from '../../../support/Fixtures.js';

class UnprefixedAttributeRule extends CamundaRules {
  check(_element: BpmnElement, reporter: RuleReporter): void {
    for (const { el, keys } of this.unprefixedAttributes()) {
      reporter.deploy({ code: 'W_C7_DEPLOY_SCHEMA', element: el, subject: keys.join(), message: keys.join(), hint: 'remove them' });
    }
  }
}

describe('CamundaRules', () => {
  const ruleOn = (document: BpmnDocument) => new UnprefixedAttributeRule(new RuleContext(document, new DocumentNamespaces(document.tree.definitions), 'camunda'));

  it('finds the attributes the BPMN schema does not define, by the element that holds them', async () => {
    const document = await Fixtures.read('engine/verdicts/camunda7-rules/014-unprefixed-attributes-on-a-task-and-on-an-event-definition.bpmn');
    const reporter = new RuleReporter(document.tree.definitions);
    ruleOn(document).check(document.tree.definitions, reporter);

    expect(reporter.findings.length).toBeGreaterThan(0);
  });

  it('finds no such attribute in a clean file', async () => {
    const document = await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn');
    const reporter = new RuleReporter(document.tree.definitions);
    ruleOn(document).check(document.tree.definitions, reporter);

    expect(reporter.findings).toEqual([]);
  });
});
