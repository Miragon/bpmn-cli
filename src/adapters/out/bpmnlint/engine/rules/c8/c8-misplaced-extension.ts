import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8CheckedElement, type ZeebeValue } from './extensions/C8CheckedElement.js';
import { ZeebeSchema } from './extensions/ZeebeSchema.js';

/**
 * Reports zeebe extension elements Camunda 8 does not read where they are: on a host that does not
 * read them (`zeebe:taskDefinition` on a Camunda user task), a child element loose in the
 * extension elements instead of in its container, and input mappings on start, boundary, none
 * intermediate throw and none end events, where only output mappings work.
 */
class C8MisplacedExtension extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    const checked = C8CheckedElement.forNode(node);
    if (!checked) {
      return;
    }

    for (const zeebeValue of checked.zeebeValues()) {
      if (zeebeValue.placement === 'loose') {
        this.reportLoose(checked, zeebeValue, reporter);
      } else if (zeebeValue.placement === 'misplaced') {
        this.reportMisplaced(checked, zeebeValue, reporter);
      }
    }
    this.checkIgnoredInputs(checked, reporter);
  }

  private reportLoose(
    checked: C8CheckedElement,
    { value, index, type }: ZeebeValue,
    reporter: Reporter,
  ): void {
    const [container] = ZeebeSchema.instance.containersOf(type);
    const hint = checked.hint();
    checked.report(
      reporter,
      `${checked.spell(type.name)} sits directly in the extension elements of ${checked.describe()}, but belongs inside ${checked.spell(container?.name ?? '')}; Camunda 8 ignores it`,
      checked.extensionPath(index),
      {
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
        node: checked.el,
        extensionElement: value,
        hint: hint
          ? `Remove it (${hint.extRemove(index)}) and add it again, \`bpmn ext add\` files it into its container: ${hint.extAdd(`${hint.nameOf(value)} ...`)}.`
          : 'Remove it (remove it from the XML) and add it again, `bpmn ext add` files it into its container: edit the XML.',
      },
    );
  }

  private reportMisplaced(
    checked: C8CheckedElement,
    { value, index, type }: ZeebeValue,
    reporter: Reporter,
  ): void {
    const hosts = type.hosts
      .filter((host) => host.startsWith('bpmn:'))
      .map((host) => host.slice('bpmn:'.length))
      .map((host) => `${host.charAt(0).toLowerCase()}${host.slice(1)}`);
    const readOn = hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ');
    const hint = checked.hint();
    checked.report(
      reporter,
      `${checked.spell(type.name)} on ${checked.describe()} has no effect: Camunda 8 reads it on ${readOn} only`,
      checked.extensionPath(index),
      {
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
        node: checked.el,
        extensionElement: value,
        hint: `Remove it: ${hint ? hint.extRemove(index) : 'remove it from the XML'}.`,
      },
    );
  }

  private checkIgnoredInputs(checked: C8CheckedElement, reporter: Reporter): void {
    const ignoredOn = this.inputsIgnoredOn(checked.el);
    if (!ignoredOn) {
      return;
    }
    const hint = checked.hint();
    for (const { value, index, type } of checked.zeebeValues()) {
      if (type.name !== 'zeebe:ioMapping') {
        continue;
      }
      (value.inputParameters ?? []).forEach((input: ModdleElement, inputIndex: number) => {
        checked.report(
          reporter,
          `The input mapping ${input.target ? `to ${input.target} ` : ''}on ${checked.describe()} has no effect: Camunda 8 ignores input mappings on ${ignoredOn} (output mappings work there)`,
          checked.extensionPath(index, 'inputParameters', inputIndex),
          {
            type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
            node: value,
            extensionElement: input,
            hint: hint
              ? `Remove it: ${hint.extRemove(`${hint.name('input')}[target=${input.target ?? ''}]`)} (set the variable in an activity before it, or as an output mapping of the element before).`
              : 'Remove it from the XML.',
          },
        );
      });
    }
  }

  private inputsIgnoredOn(host: ModdleElement): string | undefined {
    if (is(host, 'bpmn:StartEvent')) {
      return 'start events';
    }
    if (is(host, 'bpmn:BoundaryEvent')) {
      return 'boundary events';
    }
    const hasDefinitions = (host.eventDefinitions ?? []).length > 0;
    if (is(host, 'bpmn:IntermediateThrowEvent') && !hasDefinitions) {
      return 'none intermediate throw events';
    }
    if (is(host, 'bpmn:EndEvent') && !hasDefinitions) {
      return 'none end events';
    }
    return undefined;
  }
}

export default defineRule(
  { ruleName: 'c8-misplaced-extension', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-misplaced-extension': ['W_C8_MISPLACED_EXTENSION', 'runtime'] } },
  C8MisplacedExtension,
);
