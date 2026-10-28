import { is } from 'bpmnlint-utils';

import { ElementKinds } from '../ElementKinds.js';
import type { C7Host, HostExtension } from './C7Host.js';
import { CamundaDescriptor } from './CamundaDescriptor.js';

/**
 * Content of an event definition the engines read on one side only (the descriptor allows it on
 * both): delegate settings on message throw events, async and camunda:in on signal throw events,
 * the code variables on error and escalation catch events.
 */
const SIDE_RULES: Array<{ definition: string; side: 'throw' | 'catch'; attributes: string[]; extensions: string[]; where: string }> = [
  { definition: 'bpmn:MessageEventDefinition', side: 'throw', attributes: ['class', 'delegateExpression', 'expression', 'resultVariable', 'type', 'topic', 'taskPriority'], extensions: ['field', 'connector'], where: 'message throw and end events' },
  { definition: 'bpmn:SignalEventDefinition', side: 'throw', attributes: ['async'], extensions: ['in'], where: 'signal throw and end events' },
  { definition: 'bpmn:ErrorEventDefinition', side: 'catch', attributes: ['errorCodeVariable', 'errorMessageVariable'], extensions: [], where: 'error boundary and error start events' },
  { definition: 'bpmn:EscalationEventDefinition', side: 'catch', attributes: ['escalationCodeVariable'], extensions: [], where: 'escalation boundary and escalation start events' },
];

/** Why the engines ignore an extension element: the side of the event or the host (read on `readOn` only), or loose instead of in its `containers`. */
export type Misplacement = { kind: 'side' | 'host'; readOn: string } | { kind: 'loose'; containers: string };

/** Whether the Camunda 7 engines read camunda content where a host carries it. */
export class CamundaPlacement {
  private readonly descriptor = CamundaDescriptor.get();

  constructor(private readonly host: C7Host) {}

  /** The camunda attributes the descriptor allows on the host's event definition but the engines read on the other side only. */
  static sideAttributes(): string[] {
    return SIDE_RULES.flatMap((rule) => rule.attributes);
  }

  /** Where the engines read the attribute or extension element `local` instead, when the host is an event definition on the side of its event that ignores it; undefined otherwise. */
  wrongSide(local: string, kind: 'attributes' | 'extensions'): string | undefined {
    const { node, owner } = this.host;
    if (!owner || !(owner.eventDefinitions ?? []).includes(node)) return undefined;
    const side = is(owner, 'bpmn:CatchEvent') ? 'catch' : 'throw';
    const rule = SIDE_RULES.find((sideRule) => is(node, sideRule.definition) && sideRule[kind].includes(local));
    return rule && rule.side !== side ? rule.where : undefined;
  }

  /**
   * Why and how the engines ignore the camunda extension element where it sits: on the side of an
   * event that ignores it, loose instead of inside its container, or on a host that does not read
   * it; undefined when they read it.
   */
  misplacementOf({ local }: HostExtension): Misplacement | undefined {
    const side = this.wrongSide(local, 'extensions');
    if (side) return { kind: 'side', readOn: side };
    if (this.descriptor.isReadOn(local, this.host.node)) return undefined;
    const containers = this.descriptor.isNestedOnly(local) ? this.descriptor.containersOf(local) : [];
    if (containers.length) return { kind: 'loose', containers: containers.map((container) => container.replace(/^camunda:/, `${this.host.prefix}:`)).join(' / ') };
    return { kind: 'host', readOn: ElementKinds.list(this.descriptor.hostsOf(local), 4) };
  }

  /** The camunda extension elements the engines read where they sit. */
  readExtensions(): HostExtension[] {
    return this.host.camundaExtensions().filter((extension) => !this.misplacementOf(extension));
  }
}
