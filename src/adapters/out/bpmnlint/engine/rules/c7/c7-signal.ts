import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7EventDefinitions } from './events/C7EventDefinitions.js';
import { C7ExecutableScope } from './events/C7ExecutableScope.js';
import { C7Subscriptions } from './events/C7Subscriptions.js';

/**
 * Reports the signals Camunda 7 refuses to deploy: a signal event without a signal or with a signal
 * without a name, two signal subscriptions with one name in one engine scope, and two root signals
 * with one name.
 */
class C7Signal extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'bpmn:Definitions')) {
      this.checkSignalNames(node, reporter);
      return;
    }
    if (!C7ExecutableScope.contains(node)) {
      return;
    }
    if (is(node, 'bpmn:Event')) {
      this.checkEvent(node, reporter);
    }
    if (is(node, 'bpmn:Process')) {
      this.checkSubscriptions(node, reporter);
    }
  }

  private checkEvent(event: ModdleElement, reporter: Reporter): void {
    const definitions = new C7EventDefinitions(event);
    const label = describeElement(event);
    for (const definition of definitions.actedOn()) {
      if (!is(definition, 'bpmn:SignalEventDefinition')) {
        continue;
      }
      const signal = definition.signalRef;
      if (!signal) {
        reportErrors(event, reporter, {
          message: `${label} has no signal; the engines refuse the file`,
          path: definitions.pathTo(definition, 'signalRef'),
          data: {
            type: ERROR_TYPES.PROPERTY_REQUIRED,
            node: definition,
            parentNode: event,
            requiredProperty: 'signalRef',
            hint: `\`bpmn set <file> ${event.id} signal=<SignalName>\`.`,
          },
        });
      } else if (!signal.name) {
        reportErrors(event, reporter, {
          message: `Signal ${signal.id} of ${label} has no name; the engines refuse the file`,
          path: definitions.pathTo(definition, 'signalRef', 'name'),
          data: {
            type: ERROR_TYPES.PROPERTY_REQUIRED,
            node: signal,
            parentNode: event,
            requiredProperty: 'name',
            hint: `\`bpmn set <file> ${signal.id} name=<SignalName>\`.`,
          },
        });
      }
    }
  }

  private checkSubscriptions(process: ModdleElement, reporter: Reporter): void {
    for (const { first, el, name, path } of new C7Subscriptions(process).duplicates('signal')) {
      reportErrors(el, reporter, {
        message: `${describeElement(el)} waits for signal "${name}" like ${first.id} in the same scope; the engines refuse two signal subscriptions with one name`,
        path,
        data: {
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
          node: el,
          parentNode: null,
          duplicatedProperty: 'name',
          duplicatedPropertyValue: name,
          first,
          hint: `Use another signal: \`bpmn set <file> ${el.id} signal=<OtherName>\`.`,
        },
      });
    }
  }

  /** The engines refuse duplicate root signal names, even of an unused signal, once a process runs. */
  private checkSignalNames(definitions: ModdleElement, reporter: Reporter): void {
    const roots: ModdleElement[] = definitions.rootElements ?? [];
    if (!roots.some((root) => is(root, 'bpmn:Process') && root.isExecutable === true)) {
      return;
    }
    const firstByName = new Map<string, ModdleElement>();
    for (const signal of roots.filter((root) => is(root, 'bpmn:Signal'))) {
      const name = signal.name;
      if (!name) {
        continue;
      }
      const first = firstByName.get(name);
      if (!first) {
        firstByName.set(name, signal);
        continue;
      }
      reportErrors(signal, reporter, {
        message: `Signals ${first.id} and ${signal.id} are both named "${name}"; the engines refuse duplicate signal names`,
        path: ['name'],
        data: {
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
          node: signal,
          parentNode: null,
          duplicatedProperty: 'name',
          duplicatedPropertyValue: name,
          first,
          hint: `\`bpmn set <file> ${signal.id} name=<OtherName>\` (or point its events at ${first.id} and remove it).`,
        },
      });
    }
  }
}

export default defineRule(
  { ruleName: 'c7-signal', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7Signal,
);
