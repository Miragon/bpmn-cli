import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';

/** Where Camunda 8 ignores input mappings: on events of a type, some only without an event definition. */
const INPUTS_IGNORED: Array<[type: string, noneOnly: boolean, where: string]> = [
  ['bpmn:StartEvent', false, 'start events'],
  ['bpmn:BoundaryEvent', false, 'boundary events'],
  ['bpmn:IntermediateThrowEvent', true, 'none intermediate throw events'],
  ['bpmn:EndEvent', true, 'none end events'],
];

/**
 * An input mapping on a start, boundary, none intermediate throw or none end event, where only
 * output mappings work.
 * Camunda 8 deploys the file and silently ignores the mapping.
 *
 * @example an input mapping on a start event
 * <bpmn:startEvent id="Received">
 *   <bpmn:extensionElements><zeebe:ioMapping><zeebe:input source="=1" target="count" /></zeebe:ioMapping></bpmn:extensionElements>  <!-- an output mapping -->
 * </bpmn:startEvent>
 */
class C8InputMappingPlacementRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    const node = host.node;
    const noDefinitions = !(node.eventDefinitions ?? []).length;
    const ignoredOn = INPUTS_IGNORED.find(([type, noneOnly]) => is(node, type) && (!noneOnly || noDefinitions))?.[2];
    if (!ignoredOn) return;
    const hint = host.hint();
    for (const { value, index, type } of host.zeebeValues()) {
      if (type.name !== 'zeebe:ioMapping') continue;
      (value.inputParameters ?? []).forEach((input: ModdleElement, inputIndex: number) => {
        this.reportContent(host, `The input mapping ${input.target ? `to ${input.target} ` : ''}on ${host.describe()} has no effect: Camunda 8 ignores input mappings on ${ignoredOn} (output mappings work there)`, { path: host.extensionPath(index, 'inputParameters', inputIndex), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: value, extensionElement: input, hint: hint ? `Remove it: ${hint.extRemove(`${hint.name('input')}[target=${input.target ?? ''}]`)} (set the variable in an activity before it, or as an output mapping of the element before).` : 'Remove it from the XML.' });
      });
    }
  }
}

export default defineRule({ ruleName: 'c8-input-mapping-placement', code: 'W_C8_MISPLACED_EXTENSION', impact: 'runtime' }, C8InputMappingPlacementRule);
