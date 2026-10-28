import { is } from 'bpmnlint-utils';

import { C8Rule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter, type ReportPath } from '../../CamundaRules.js';
import { C8EventPosition } from './C8EventPosition.js';
import { FlowIndex } from './FlowIndex.js';
import { type Duplicate, SubscriptionGroups } from './SubscriptionGroups.js';

/** How a rule words the report of one duplicated subscription key. */
export interface DuplicateReport {
  message: string;
  path: ReportPath;
  property: string;
  hint: string;
}

/**
 * A Camunda 8 rule over what executable events subscribe to (an error code, a message name, a
 * signal name): it checks each subscribing element and reports a key twice among the events of a
 * (sub-)process that Camunda 8 subscribes to together.
 */
export abstract class C8SubscriptionRule extends C8Rule {
  private readonly flows = new FlowIndex();

  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!C8EventPosition.isExecutable(node)) {
      return;
    }
    this.checkSubscriber(node, reporter);
    if (is(node, 'bpmn:Process') || is(node, 'bpmn:SubProcess')) {
      this.checkScope(new SubscriptionGroups(node, this.flows), node, reporter);
    }
  }

  protected abstract checkSubscriber(node: ModdleElement, reporter: Reporter): void;

  protected abstract checkScope(groups: SubscriptionGroups, scope: ModdleElement, reporter: Reporter): void;

  /** The key `el` subscribes to, `undefined` for none that can collide. */
  protected abstract subscriptionKeyOf(el: ModdleElement): string | undefined;

  protected abstract duplicateReport(duplicate: Duplicate, where: string): DuplicateReport;

  protected reportDuplicates(events: ModdleElement[], where: string, reporter: Reporter): void {
    for (const duplicate of SubscriptionGroups.duplicates(events, (el) => this.subscriptionKeyOf(el))) {
      const { message, path, property, hint } = this.duplicateReport(duplicate, where);
      reportErrors(duplicate.el, reporter, {
        message,
        path,
        data: {
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
          node: duplicate.el,
          parentNode: null,
          duplicatedProperty: property,
          duplicatedPropertyValue: duplicate.key,
          duplicateOf: duplicate.first,
          hint,
        },
      });
    }
  }
}
