import { is } from 'bpmnlint-utils';
import { C7Rule, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';

/**
 * The base of the Camunda 7 rules on what the BPMN schema requires of an event definition: a rule
 * implements `checkDefinition(definition)` for each event definition of the file, also of one the
 * engines ignore or do not run, and `checkEvent(event)` for what it checks of the event first.
 * Camunda 7 validates the file against the schema before it deploys it. A report about a
 * definition goes on the event that holds it, with the fix for that event.
 *
 * @example a conditional event without condition
 * <bpmn:intermediateCatchEvent id="Ready"><bpmn:conditionalEventDefinition /></bpmn:intermediateCatchEvent>
 */
export abstract class C7EventDefinitionSchemaRule extends C7Rule {
  protected visit(node: ModdleElement): void {
    if (is(node, 'bpmn:Event')) {
      this.checkEvent(node);
      for (const definition of new C7EventDefinitions(node).all()) {
        this.checkDefinition(definition);
      }
    } else if (is(node, 'bpmn:EventDefinition') && !(node.$parent && is(node.$parent, 'bpmn:Event'))) {
      this.checkDefinition(node);
    }
  }

  protected checkEvent(_event: ModdleElement): void {}

  protected abstract checkDefinition(definition: ModdleElement): void;

  protected reportSchema(definition: ModdleElement, message: string, data: { path: (string | number)[]; type: string; hint: string; [detail: string]: unknown }): void {
    this.report(this.eventOf(definition) ?? definition, message, { ...data, node: definition });
  }

  /** `Conditional event X`, among several definitions `The conditional definition of <event>`, without an event the definition itself. */
  protected subjectName(definition: ModdleElement, single: string): string {
    const event = this.eventOf(definition);
    if (!event) {
      return `${definition.$type}${definition.id ? ` ${definition.id}` : ''}`;
    }
    return new C7EventDefinitions(event).all().length > 1 ? `The ${ElementKinds.trigger(definition)} definition of ${ElementKinds.describe(event)}` : `${single} ${event.id}`;
  }

  protected subjectPath(definition: ModdleElement, ...rest: string[]): (string | number)[] {
    const event = this.eventOf(definition);
    return event ? new C7EventDefinitions(event).pathTo(definition, ...rest) : rest;
  }

  /** The fix `bpmn set <file> <event> <command>` (with `keeps` in brackets), or among several definitions how to drop this one when the engines act on another one. */
  protected subjectHint(definition: ModdleElement, command: string, keeps = ''): string {
    const event = this.eventOf(definition);
    if (!event) return 'Fix it in the XML.';
    const definitions = new C7EventDefinitions(event);
    if (definitions.all().length < 2) {
      return `\`bpmn set <file> ${event.id} ${command}\`${keeps ? ` (${keeps})` : ''}.`;
    }
    const only = `\`bpmn set <file> ${event.id} ${command}\` (keeps only the ${ElementKinds.trigger(definition)} definition)`;
    const acting = definitions.acting();
    if (!acting || acting === definition) return `${only}.`;
    const trigger = ElementKinds.trigger(acting);
    return `The engines act on the ${trigger} definition and ignore this one, but they validate it too: drop it with \`bpmn set <file> ${event.id} trigger=${trigger}\` (keeps only the ${trigger}), or ${only}.`;
  }

  /** The event with an id that holds `definition`: a report about the definition goes on it. */
  private eventOf(definition: ModdleElement): ModdleElement | undefined {
    const parent = definition.$parent;
    return parent && is(parent, 'bpmn:Event') && parent.id ? parent : undefined;
  }
}
