import { is, isAny } from 'bpmnlint-utils';
import { C7Rule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';

/** A definition of the kind a reference rule checks, on an event the engines run: where its reference sits and what it references. */
export interface EventReference {
  event: ModdleElement;
  definition: ModdleElement;
  /** `messageRef`, `signalRef`, `errorRef` or `escalationRef` */
  property: string;
  path: (string | number)[];
  referenced: ModdleElement | undefined;
}

/**
 * The base of the Camunda 7 rules on what a message, signal, error or escalation event references:
 * a rule names the `kind` and the `events` it applies to and implements `checkReference(reference)`
 * for each definition of that kind the engines act on.
 * Camunda 7 resolves the reference when it deploys the file and refuses it when the reference or
 * what the engine reads of it is missing.
 *
 * @example an error end event that names no error
 * <bpmn:endEvent id="Failed">
 *   <bpmn:errorEventDefinition />  <!-- no errorRef -->
 * </bpmn:endEvent>
 */
export abstract class C7EventReferenceRule extends C7Rule {
  protected abstract readonly kind: 'Message' | 'Signal' | 'Error' | 'Escalation';
  protected abstract readonly events: string[];

  protected visit(node: ModdleElement): void {
    if (!is(node, 'bpmn:Event') || !EngineScope.C7.contains(node) || !isAny(node, this.events)) {
      return;
    }
    const definitions = new C7EventDefinitions(node);
    const property = `${this.kind.toLowerCase()}Ref`;
    for (const definition of definitions.actedOn()) {
      if (is(definition, `bpmn:${this.kind}EventDefinition`)) {
        this.checkReference({ event: node, definition, property, path: definitions.pathTo(definition, property), referenced: definition.get(property) });
      }
    }
  }

  protected abstract checkReference(reference: EventReference): void;

  /** The event names nothing: `missing` says what, `set` how to set it. */
  protected reportMissing({ event, definition, property, path }: EventReference, missing: string, set: string, after = ''): void {
    this.report(event, `${ElementKinds.describe(event)} ${missing}; the engines refuse the file`, { path, type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: property, hint: `\`bpmn set <file> ${event.id} ${set}\`${after}.` });
  }

  /** What `owner` references has no name. */
  protected reportUnnamed(owner: ModdleElement, referenced: ModdleElement, subject: string, path: (string | number)[]): void {
    this.report(owner, `${subject} has no name; the engines refuse the file`, { path: [...path, 'name'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: referenced, requiredProperty: 'name', hint: `\`bpmn set <file> ${referenced.id} name=<${referenced.$type.slice('bpmn:'.length)}Name>\`.` });
  }

  /** The error or escalation thrown has no code. */
  protected reportUncoded({ event, path, referenced }: EventReference): void {
    const code = `${this.kind.toLowerCase()}Code`;
    if (!referenced || String(referenced.get(code) ?? '').trim()) return;
    this.report(event, `${this.kind} ${referenced.id} thrown by ${ElementKinds.describe(event)} has no ${code}; the engines refuse the file`, { path: [...path, code], type: ERROR_TYPES.PROPERTY_REQUIRED, node: referenced, requiredProperty: code, hint: `\`bpmn set <file> ${event.id} ${code}=<CODE>\`.` });
  }
}
