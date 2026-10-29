import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { EngineScope } from '../../support/EngineScope.js';

/** The order in which the engines pick the definition they act on, per event type (engine-checked, each pair in both XML orders). */
const ACTING_ORDERS: Array<[type: string, order: string[]]> = [
  ['bpmn:IntermediateCatchEvent', ['Timer', 'Signal', 'Message', 'Link', 'Conditional']],
  ['bpmn:BoundaryEvent', ['Timer', 'Signal', 'Message', 'Conditional']],
  ['bpmn:IntermediateThrowEvent', ['Signal', 'Message']],
  ['bpmn:EndEvent', ['Message', 'Signal']],
];

/**
 * The event definitions of one event as the Camunda 7 engines read them. Of several definitions
 * they act on one, the first kind present in the order of the event type, and do not even parse
 * the others. Where the order is not known, every definition counts as acted on.
 */
export class C7EventDefinitions {
  constructor(private readonly event: ModdleElement) {}

  all(): ModdleElement[] {
    return this.event.eventDefinitions ?? [];
  }

  /** The definition the engines act on when the event has several, else `undefined`. */
  acting(): ModdleElement | undefined {
    const definitions = this.all();
    const order = definitions.length > 1 ? this.actingOrder() : undefined;
    if (!order) return undefined;
    const ranks = definitions.map((definition) => order.findIndex((kind) => is(definition, `bpmn:${kind}EventDefinition`)));
    return ranks.includes(-1) ? undefined : definitions[ranks.indexOf(Math.min(...ranks))];
  }

  /** The definitions the engines read: the acting one of several, else all. */
  actedOn(): ModdleElement[] {
    const acting = this.acting();
    return acting ? [acting] : this.all();
  }

  /** The first acted-on definition of `type`. */
  ofType(type: string): ModdleElement | undefined {
    return this.actedOn().find((definition) => is(definition, type));
  }

  /** The acted-on definitions of `type` (`bpmn:MessageEventDefinition`) with their indexes. */
  indexedOfType(type: string): Array<{ definition: ModdleElement; index: number }> {
    return this.actedOn().filter((definition) => is(definition, type)).map((definition) => ({ definition, index: this.all().indexOf(definition) }));
  }

  /** The report path from the event to `definition`, followed by `rest`. */
  pathTo(definition: ModdleElement, ...rest: string[]): (string | number)[] {
    return ['eventDefinitions', this.all().indexOf(definition), ...rest];
  }

  private actingOrder(): string[] | undefined {
    const event = this.event;
    if (is(event, 'bpmn:StartEvent') && EngineScope.isEventSubProcess(event.$parent)) return ['Message', 'Signal', 'Timer', 'Conditional'];
    if (is(event, 'bpmn:StartEvent') && is(event.$parent, 'bpmn:Process')) return ['Timer', 'Message', 'Signal', 'Conditional'];
    return ACTING_ORDERS.find(([type]) => is(event, type))?.[1];
  }
}
