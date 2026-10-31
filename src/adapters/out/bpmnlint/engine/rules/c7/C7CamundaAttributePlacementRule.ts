import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { CAMUNDA_URI } from '../support/DiagramNamespaces.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { Shell } from '../support/Shell.js';
import { C7VendorContentRule } from './C7VendorContentRule.js';
import { CamundaPlacement } from './support/CamundaPlacement.js';
import type { C7Host } from './support/C7Host.js';

/**
 * A camunda attribute on an element type it does not apply to, or on the side of an event that
 * ignores it, with where it belongs on the element instead.
 * Camunda 7 deploys the file and ignores it.
 *
 * @example a multi-instance attribute on the activity
 * <bpmn:userTask id="Review" camunda:collection="${reviewers}" />  <!-- on the multi-instance loop -->
 */
class C7CamundaAttributePlacementRule extends C7VendorContentRule {
  protected checkHost(host: C7Host): void {
    const remove = (key: string, withoutAddress: string) => (host.unset(key) ? `Remove it: ${host.unset(key)}.` : withoutAddress);
    const report = (key: string, local: string, readOn: string, hint: string) => this.reportContent(host, `${key} on ${host.describe()} has no effect: the engines read it on ${readOn} only`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: `camunda:${local}`, path: host.path(`camunda:${local}`), hint });
    for (const { key, local, uri } of host.foreignAttributes()) {
      const owners = uri === CAMUNDA_URI ? RuleKit.kit.CAMUNDA.attr(local)?.owners : undefined;
      if (owners && !owners.some((owner) => host.node.$instanceOf(owner))) {
        report(key, local, ElementKinds.list(owners, 4), this.moveHint(host, key, `${local}=${String(host.node.$attrs[key] ?? '')}`, owners) ?? remove(key, 'Remove it from the XML.'));
      }
    }
    const placement = new CamundaPlacement(host);
    for (const local of CamundaPlacement.sideAttributes()) {
      const side = placement.wrongSide(local, 'attributes');
      const property = host.node.$descriptor?.propertiesByName?.[`camunda:${local}`];
      if (side && property && Object.prototype.hasOwnProperty.call(host.node, property.name)) {
        report(host.typeName(local), local, side, remove(host.typeName(local), 'Remove it: edit the XML.'));
      }
    }
  }

  /** Where the attribute belongs on the element itself: the event definition of an event, the multi-instance loop of an activity, the condition of a flow; undefined when it belongs nowhere on it. `assignment` is `<local>=<value>`. */
  private moveHint(host: C7Host, key: string, assignment: string, owners: string[]): string | undefined {
    const { node, address } = host;
    if (!address || address.slot !== '') return undefined;
    const move = (slot: string) => `\`bpmn set <file> ${address.id} ${Shell.quote(`${key}=`)} ${Shell.quote(`${slot}${host.prefix}:${assignment}`)}\``;
    const definitions: ModdleElement[] = node.eventDefinitions ?? [];
    const fit = definitions.findIndex((definition) => owners.some((owner) => is(definition, owner)));
    if (is(node, 'bpmn:Event') && fit !== -1) {
      return `It belongs on the event definition: ${move(definitions.length > 1 ? `definition[${fit}].` : 'definition.')}.`;
    }
    if (is(node, 'bpmn:Activity') && owners.includes('bpmn:MultiInstanceLoopCharacteristics')) {
      return `It belongs on the multi-instance loop: ${move('loop.')}${node.loopCharacteristics && is(node.loopCharacteristics, 'bpmn:MultiInstanceLoopCharacteristics') ? '' : ' (creates a parallel multi-instance loop)'}.`;
    }
    if (is(node, 'bpmn:SequenceFlow') && owners.includes('bpmn:FormalExpression') && node.conditionExpression) {
      return `It belongs on the condition: ${move('condition.')}.`;
    }
    return undefined;
  }
}

export default defineRule({ ruleName: 'c7-camunda-attribute-placement', code: 'W_C7_MISPLACED_ATTRIBUTE', impact: 'runtime' }, C7CamundaAttributePlacementRule);
