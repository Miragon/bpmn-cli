import { is } from 'bpmnlint-utils';
import { C8Rule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { Values } from '../support/Values.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * A start event Camunda 8 runs that waits for a message or signal whose name is a FEEL
 * expression, for the rules of either trigger (`C8MessageStartNeedsStaticNameRule`,
 * `C8SignalStartNeedsStaticNameRule`).
 * Camunda 8 subscribes to such start events at deploy, before any variable exists, and refuses the
 * file.
 *
 * @example a signal start event with a FEEL name
 * <bpmn:signal id="Go" name="=signalName" />  <!-- a static name -->
 */
export abstract class C8StartNameRule extends C8Rule {
  protected abstract readonly trigger: 'message' | 'signal';
  /** Where Camunda 8 needs the static name, in the message. */
  protected abstract readonly starts: string;

  protected visit(start: ModdleElement): void {
    if (!EngineScope.C8.contains(start) || !is(start, 'bpmn:StartEvent') || !this.applies(start)) {
      return;
    }
    const trigger = this.trigger;
    const kind = `${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}`;
    const reference = C8EventDefinitions.definitionOfType(start, `bpmn:${kind}EventDefinition`)?.get(`${trigger}Ref`);
    const name = reference?.get('name');
    if (Values.isFeel(name)) {
      this.report(start, `Start event ${start.id} catches the ${trigger} "${name}", a FEEL expression; Camunda 8 needs a static ${trigger} name on ${this.starts} and refuses the file`, { path: ['eventDefinitions', 0, `${trigger}Ref`, 'name'], type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED, node: reference, property: 'name', hint: `\`bpmn set <file> ${reference.id} name=<${kind}Name>\`.` });
    }
  }

  protected abstract applies(start: ModdleElement): boolean;
}
