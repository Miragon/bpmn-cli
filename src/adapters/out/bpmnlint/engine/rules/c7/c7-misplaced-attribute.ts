import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7Host, CAMUNDA_URI } from './extensions/C7Host.js';
import { C7HostRule } from './extensions/C7HostRule.js';
import { CamundaDescriptor } from './extensions/CamundaDescriptor.js';
import { CamundaPlacement } from './extensions/CamundaPlacement.js';
import { ExtensionHints } from './extensions/ExtensionHints.js';
import { sh } from '../shell.js';
import { kindsText } from './extensions/utils/kindsText.js';

/** One misplaced attribute: as the file spells it, its local name, where the engines read it, and the fix. */
interface MisplacedAttribute {
  key: string;
  local: string;
  readOn: string;
  hint: string;
}

/**
 * Reports a camunda attribute on an element the Camunda 7 engines do not read it on: an element
 * type it does not apply to (camunda:assignee on a service task, camunda:collection on the
 * activity instead of its loop), or the side of an event that ignores it (camunda:class on a
 * message catch event definition).
 */
class C7MisplacedAttribute extends C7HostRule {
  private readonly descriptor = CamundaDescriptor.get();

  protected checkHost(host: C7Host, reporter: Reporter): void {
    const hints = new ExtensionHints(host);
    this.checkInapplicable(host, hints, reporter);
    this.checkWrongSide(host, hints, reporter);
  }

  private checkInapplicable(host: C7Host, hints: ExtensionHints, reporter: Reporter): void {
    for (const { key, local, uri } of host.foreignAttributes()) {
      const owners = uri === CAMUNDA_URI ? this.descriptor.ownersOf(local) : undefined;
      if (!owners || this.descriptor.appliesTo(local, host.node)) {
        continue;
      }
      const value = String(host.node.$attrs[key] ?? '');
      const hint =
        this.moveHint(host, hints, key, `${local}=${value}`, owners) ??
        this.removeHint(hints, key, 'Remove it from the XML.');
      this.report(host, { key, local, readOn: kindsText(owners), hint }, reporter);
    }
  }

  private checkWrongSide(host: C7Host, hints: ExtensionHints, reporter: Reporter): void {
    const placement = new CamundaPlacement(host);
    for (const local of CamundaPlacement.sideAttributes()) {
      const side = placement.wrongSide(local, 'attributes');
      if (side && this.isSet(host.node, local)) {
        const key = hints.typeName(local);
        const hint = this.removeHint(hints, key, 'Remove it: edit the XML.');
        this.report(host, { key, local, readOn: side, hint }, reporter);
      }
    }
  }

  /**
   * Where the attribute belongs on the element itself: the event definition of an event, the
   * multi-instance loop of an activity, the condition of a flow; undefined when it belongs nowhere
   * on it. `assignment` is `<local>=<value>`.
   */
  private moveHint(
    host: C7Host,
    hints: ExtensionHints,
    key: string,
    assignment: string,
    owners: string[],
  ): string | undefined {
    const node = host.node;
    const address = hints.address;
    if (!address || address.slot !== '') {
      return undefined;
    }
    const move = (slot: string) =>
      `\`bpmn set <file> ${address.id} ${sh(`${key}=`)} ${sh(`${slot}${hints.prefix}:${assignment}`)}\``;
    const definitions: ModdleElement[] = node.eventDefinitions ?? [];
    const fit = definitions.findIndex((definition) => owners.some((owner) => is(definition, owner)));
    if (is(node, 'bpmn:Event') && fit !== -1) {
      return `It belongs on the event definition: ${move(definitions.length > 1 ? `definition[${fit}].` : 'definition.')}.`;
    }
    if (is(node, 'bpmn:Activity') && owners.includes('bpmn:MultiInstanceLoopCharacteristics')) {
      const loop = node.loopCharacteristics;
      const isMultiInstance = !!loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics');
      return `It belongs on the multi-instance loop: ${move('loop.')}${isMultiInstance ? '' : ' (creates a parallel multi-instance loop)'}.`;
    }
    if (is(node, 'bpmn:SequenceFlow') && owners.includes('bpmn:FormalExpression') && node.conditionExpression) {
      return `It belongs on the condition: ${move('condition.')}.`;
    }
    return undefined;
  }

  private removeHint(hints: ExtensionHints, key: string, withoutAddress: string): string {
    const unset = hints.unset(key);
    return unset ? `Remove it: ${unset}.` : withoutAddress;
  }

  /** Whether the file sets the typed camunda attribute `local` (its default does not count). */
  private isSet(node: ModdleElement, local: string): boolean {
    const property = node.$descriptor?.propertiesByName?.[`camunda:${local}`];
    return !!property && Object.prototype.hasOwnProperty.call(node, property.name);
  }

  private report(host: C7Host, { key, local, readOn, hint }: MisplacedAttribute, reporter: Reporter): void {
    host.report(reporter, {
      message: `${key} on ${host.describe()} has no effect: the engines read it on ${readOn} only`,
      path: host.path(`camunda:${local}`),
      type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      property: `camunda:${local}`,
      hint,
    });
  }
}

export default defineRule(
  { ruleName: 'c7-misplaced-attribute', kind: 'engine-specific', targetEngine: 'c7', impact: 'runtime' },
  C7MisplacedAttribute,
);
