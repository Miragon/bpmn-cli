import { is } from 'bpmnlint-utils';

import { describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter, type ReportPath } from '../../CamundaRules.js';
import { C8EventPosition } from './C8EventPosition.js';
import { C8SubscriptionRule, type DuplicateReport } from './C8SubscriptionRule.js';
import type { Duplicate } from './SubscriptionGroups.js';
import { isBlank, isFeel } from './utils/c8Values.js';

/**
 * A Camunda 8 rule over the events that wait for a message or signal by name: a start event whose
 * name is a FEEL expression, and one static name twice among events subscribed together.
 */
export abstract class C8NamedSubscriptionRule extends C8SubscriptionRule {
  protected abstract readonly trigger: 'message' | 'signal';
  /** The start events Camunda 8 needs a static name on, as the report names them. */
  protected abstract readonly staticNameStarts: string;
  /** What the duplicate hint adds after its command. */
  protected readonly duplicateHintNote: string = '';

  private get capitalizedTrigger(): string {
    return this.trigger.charAt(0).toUpperCase() + this.trigger.slice(1);
  }

  private get referenceProperty(): string {
    return `${this.trigger}Ref`;
  }

  private get definitionType(): string {
    return `bpmn:${this.capitalizedTrigger}EventDefinition`;
  }

  /** Reports the start event `node` when the name it waits for is a FEEL expression. */
  protected checkStartName(node: ModdleElement, reporter: Reporter): void {
    const definition = C8EventPosition.checkedDefinition(node);
    const reference =
      definition && is(definition, this.definitionType) ? definition.get(this.referenceProperty) : undefined;
    const name = reference?.get('name');
    if (!isFeel(name)) {
      return;
    }
    reportErrors(node, reporter, {
      message: `Start event ${node.id} catches the ${this.trigger} "${name}", a FEEL expression; Camunda 8 needs a static ${this.trigger} name on ${this.staticNameStarts} and refuses the file`,
      path: ['eventDefinitions', 0, this.referenceProperty, 'name'],
      data: {
        type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED,
        node: reference,
        parentNode: node,
        property: 'name',
        hint: `\`bpmn set <file> ${reference.id} name=<${this.capitalizedTrigger}Name>\`.`,
      },
    });
  }

  protected duplicateReport({ first, el, key }: Duplicate, where: string): DuplicateReport {
    return {
      message: `${describeElement(el)} waits for the ${this.trigger} "${key}" like ${describeElement(first)} ${where}; Camunda 8 refuses one ${this.trigger} name twice there`,
      path: this.referencePathOf(el),
      property: 'name',
      hint: `Use another ${this.trigger}: \`bpmn set <file> ${el.id} ${this.trigger}=<Other${this.capitalizedTrigger}>\`${this.duplicateHintNote}.`,
    };
  }

  /** The static name `el` waits for, unless it has none or a FEEL one. */
  protected subscriptionKeyOf(el: ModdleElement): string | undefined {
    const name = this.referenceHolderOf(el)?.get(this.referenceProperty)?.get('name');
    return isBlank(name) || isFeel(name) ? undefined : name;
  }

  /** The element of `el` that references the message or signal. */
  protected referenceHolderOf(el: ModdleElement): ModdleElement | undefined {
    return C8EventPosition.onlyDefinition(el, this.definitionType);
  }

  protected referencePathOf(_el: ModdleElement): ReportPath {
    return ['eventDefinitions', 0, this.referenceProperty];
  }
}
