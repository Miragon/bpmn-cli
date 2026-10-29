import { is } from 'bpmnlint-utils';
import { C8Rule, ERROR_TYPES, type ModdleElement, type ReportPath } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { FirstOfKey } from '../support/FirstOfKey.js';
import { Values } from '../support/Values.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';
import { C8SubscriptionGroups } from './support/C8SubscriptionGroups.js';
import { FlowIndex } from './support/FlowIndex.js';

/** An element whose key an earlier element of its group already has. */
export interface Duplicate {
  first: ModdleElement;
  el: ModdleElement;
  key: string;
}

/**
 * The subscription groups of each (sub-)process Camunda 8 runs, for the rules on a message name,
 * signal name or error code twice in one group (`C8MessageSubscriptionUniqueRule`,
 * `C8SignalSubscriptionUniqueRule`, `C8ErrorCodeUniqueRule`), reported on the second and later
 * elements.
 * Camunda 8 cannot tell which of the events a message, signal or error is for and refuses the
 * file.
 *
 * @example two boundary events of one task waiting for the same message
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:messageEventDefinition messageRef="Cancel" /></bpmn:boundaryEvent>
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:messageEventDefinition messageRef="Cancel" /></bpmn:boundaryEvent>  <!-- same message -->
 */
export abstract class C8SubscriptionUniqueRule extends C8Rule {
  private readonly flows = new FlowIndex();

  protected visit(node: ModdleElement): void {
    if (!EngineScope.C8.contains(node) || !(is(node, 'bpmn:Process') || is(node, 'bpmn:SubProcess'))) {
      return;
    }
    this.checkScope(new C8SubscriptionGroups(node, this.flows), node);
  }

  protected abstract checkScope(groups: C8SubscriptionGroups, scope: ModdleElement): void;

  /** The 2nd and later elements of `elements` whose key (`undefined`: none) an earlier one has. */
  protected duplicates(elements: ModdleElement[], keyOf: (el: ModdleElement) => string | undefined): Duplicate[] {
    const firsts = new FirstOfKey<ModdleElement>();
    return elements.flatMap((el) => {
      const key = keyOf(el);
      const first = key === undefined ? undefined : firsts.repeats(key, el);
      return first && key !== undefined ? [{ first, el, key }] : [];
    });
  }

  /** One static name twice among `events`; a receive task waits for its own message. */
  protected reportNamed(trigger: 'message' | 'signal', events: ModdleElement[], where: string, note: string): void {
    const holderOf = (el: ModdleElement) => (trigger === 'message' && is(el, 'bpmn:ReceiveTask') ? el : C8EventDefinitions.onlyDefinition(el, `bpmn:${trigger === 'message' ? 'Message' : 'Signal'}EventDefinition`));
    const keyOf = (el: ModdleElement) => {
      const name = holderOf(el)?.get(`${trigger}Ref`)?.get('name');
      return !Values.nonEmpty(name) || Values.isFeel(name) ? undefined : name;
    };
    for (const duplicate of this.duplicates(events, keyOf)) {
      const { first, el, key } = duplicate;
      const path = is(el, 'bpmn:ReceiveTask') ? ['messageRef'] : ['eventDefinitions', 0, `${trigger}Ref`];
      this.reportDuplicate(duplicate, `${ElementKinds.describe(el)} waits for the ${trigger} "${key}" like ${ElementKinds.describe(first)} ${where}; Camunda 8 refuses one ${trigger} name twice there`, path, 'name', `Use another ${trigger}: \`bpmn set <file> ${el.id} ${trigger}=<Other${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}>\`${note}.`);
    }
  }

  protected reportDuplicate({ first, el, key }: Duplicate, message: string, path: ReportPath, property: string, hint: string): void {
    this.report(el, message, { path, type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, duplicatedProperty: property, duplicatedPropertyValue: key, duplicateOf: first, hint });
  }
}
