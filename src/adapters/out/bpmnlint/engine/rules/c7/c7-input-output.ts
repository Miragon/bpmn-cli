import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7Host } from './extensions/C7Host.js';
import { ExtensionHints } from './extensions/ExtensionHints.js';
import { ElementKinds } from '../describe.js';

/**
 * Reports camunda:inputOutput where the Camunda 7 engines refuse it: on a start or boundary event,
 * a gateway or an event sub-process, and output parameters on an end event or a multi-instance
 * activity.
 */
class C7InputOutput extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): boolean | void {
    if (!C7Host.visits(node)) {
      return false;
    }
    if (!is(node, 'bpmn:FlowNode') || !C7Host.isExecutable(node)) {
      return;
    }
    const host = new C7Host(node);
    const mappings = host.camundaExtensions('inputOutput');
    const [first] = mappings;
    if (!first) {
      return;
    }
    const hints = new ExtensionHints(host);
    const mapping = hints.typeName('inputOutput');
    const unsupported = this.unsupportedHost(node);
    if (unsupported) {
      host.report(reporter, {
        message: `${mapping} on ${host.describe()}: the engines do not support input/output mappings on ${unsupported} and refuse the file`,
        path: host.extensionPath(first.index),
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
        node: first.value,
        extensionElement: first.value,
        hint: `Move the mappings to the next activity and remove them here: \`bpmn ext remove <file> ${node.id} ${mapping}\`.`,
      });
      return;
    }
    const withOutputs = mappings.find(({ value }) => (value.get('outputParameters') ?? []).length);
    if (!withOutputs) {
      return;
    }
    const refusal = this.outputRefusal(host, hints, mapping);
    if (refusal) {
      host.report(reporter, {
        ...refusal,
        path: host.extensionPath(withOutputs.index, 'outputParameters'),
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        node: withOutputs.value,
        property: 'outputParameters',
      });
    }
  }

  /** Why the engines refuse output parameters on the host, with the fix; undefined where they take them. */
  private outputRefusal(
    host: C7Host,
    hints: ExtensionHints,
    mapping: string,
  ): { message: string; hint: string } | undefined {
    const node = host.node;
    const parameter = hints.typeName('outputParameter');
    const dropOutputs = `Remove the output parameters: rebuild the mapping without them (\`bpmn ext list <file> ${node.id} --json\`, then \`bpmn ext add <file> ${node.id} ${mapping} --replace --xml '...'\`).`;
    if (is(node, 'bpmn:EndEvent')) {
      return {
        message: `${parameter} on end event ${node.id}: the engines refuse output mappings on end events`,
        hint: dropOutputs,
      };
    }
    if (this.isMultiInstance(node)) {
      return {
        message: `${parameter} on multi-instance ${host.describe()}: the engines refuse output mappings on multi-instance activities`,
        hint: `${dropOutputs} Collect results in an activity inside the loop instead.`,
      };
    }
    return undefined;
  }

  private isMultiInstance(node: ModdleElement): boolean {
    const loop = node.loopCharacteristics;
    return !!loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics');
  }

  /** `a startEvent`, `a boundaryEvent:timer`, `an event sub-process`; undefined where the engines take mappings. */
  private unsupportedHost(node: ModdleElement): string | undefined {
    if (is(node, 'bpmn:SubProcess') && node.triggeredByEvent === true) {
      return 'an event sub-process';
    }
    if (is(node, 'bpmn:StartEvent') || is(node, 'bpmn:BoundaryEvent') || is(node, 'bpmn:Gateway')) {
      return `a ${ElementKinds.of(node)}`;
    }
    return undefined;
  }
}

export default defineRule(
  { ruleName: 'c7-input-output', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7InputOutput,
);
