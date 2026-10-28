import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import type { C7Host, HostExtension } from './extensions/C7Host.js';
import { C7ExtensionRule } from './extensions/C7HostRule.js';
import { CamundaPlacement } from './extensions/CamundaPlacement.js';
import type { ExtensionHints } from './extensions/ExtensionHints.js';

const EXECUTION_EVENTS = ['start', 'end'];
const TASK_EVENTS = ['create', 'assignment', 'complete', 'update', 'delete', 'timeout'];
const IMPLEMENTATIONS = ['class', 'expression', 'delegateExpression'];

type ListenerReport = (
  message: string,
  steps: (string | number)[],
  type: string,
  details: Record<string, unknown>,
) => void;

/**
 * Reports execution and task listeners the Camunda 7 engines refuse to deploy: without
 * implementation, without event or with an event they do not know, with a script without
 * scriptFormat, and timeout task listeners without timer or id.
 */
class C7Listener extends C7ExtensionRule {
  protected checkExtensions(host: C7Host, hints: ExtensionHints, reporter: Reporter): void {
    const placement = new CamundaPlacement(host);
    for (const extension of placement.readExtensions()) {
      if (extension.local === 'executionListener' || extension.local === 'taskListener') {
        this.checkListener(host, extension, hints, reporter);
      }
    }
  }

  private checkListener(
    host: C7Host,
    extension: HostExtension,
    hints: ExtensionHints,
    reporter: Reporter,
  ): void {
    const { value: listener, index, local } = extension;
    const event: string | undefined = listener.get('event');
    const label = `${hints.typeName(local)}${event ? ` (event ${event})` : ''} of ${host.describe()}`;
    const report: ListenerReport = (message, steps, type, details) =>
      host.report(reporter, {
        message,
        path: host.extensionPath(index, ...steps),
        type,
        node: listener,
        ...details,
      });

    if (!this.hasImplementation(listener)) {
      report(
        `${label} has no class, expression, delegateExpression or script; the engines refuse the file`,
        [],
        ERROR_TYPES.PROPERTY_REQUIRED,
        {
          requiredProperty: [...IMPLEMENTATIONS, 'script'],
          hint: hints.rebuild(extension, { expression: '${...}' }),
        },
      );
    }
    if (!is(host.node, 'bpmn:SequenceFlow')) {
      this.checkEvent(extension, label, hints, report);
    }
    if (listener.script && !this.nonEmpty(listener.script.get('scriptFormat'))) {
      report(
        `The script of ${label} has no scriptFormat; the engines refuse the file`,
        ['script', 'scriptFormat'],
        ERROR_TYPES.PROPERTY_REQUIRED,
        { requiredProperty: 'scriptFormat', hint: hints.rebuild(extension) },
      );
    }
    if (local === 'taskListener' && event === 'timeout') {
      this.checkTimeout(extension, label, hints, report);
    }
  }

  private checkEvent(
    extension: HostExtension,
    label: string,
    hints: ExtensionHints,
    report: ListenerReport,
  ): void {
    const { value: listener, local } = extension;
    const event: string | undefined = listener.get('event');
    const allowed = local === 'taskListener' ? TASK_EVENTS : EXECUTION_EVENTS;
    const rebuild = hints.rebuild(extension, { event: `<${allowed.join('|')}>` });
    if (event === undefined) {
      report(`${label} has no event; the engines refuse the file`, ['event'], ERROR_TYPES.PROPERTY_REQUIRED, {
        requiredProperty: 'event',
        hint: `Set event to one of ${allowed.join(', ')}. ${rebuild}`,
      });
    } else if (!allowed.includes(event)) {
      const take = event === 'take' && local === 'executionListener' ? 'take is only read on sequence flows. ' : '';
      report(
        `${label}: event "${event}" is not one of ${allowed.join(', ')}; the engines refuse the file`,
        ['event'],
        ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        { property: 'event', hint: `${take}${rebuild}` },
      );
    }
  }

  private checkTimeout(
    extension: HostExtension,
    label: string,
    hints: ExtensionHints,
    report: ListenerReport,
  ): void {
    const listener = extension.value;
    const hasTimer = (listener.get('eventDefinitions') ?? []).some((definition: ModdleElement) =>
      is(definition, 'bpmn:TimerEventDefinition'),
    );
    if (!hasTimer) {
      report(
        `${label} has no bpmn:timerEventDefinition; the engines refuse the file`,
        ['eventDefinitions'],
        ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
        { requiredType: 'bpmn:TimerEventDefinition', hint: hints.rebuild(extension) },
      );
    }
    if (listener.get('id') === undefined) {
      report(
        `${label} has no id, which the engines require on timeout task listeners; they refuse the file`,
        ['id'],
        ERROR_TYPES.PROPERTY_REQUIRED,
        { requiredProperty: 'id', hint: hints.rebuild(extension, { id: '<listenerId>' }) },
      );
    }
  }

  private hasImplementation(listener: ModdleElement): boolean {
    return (
      IMPLEMENTATIONS.some((name) => this.nonEmpty(listener.get(name))) ||
      listener.script !== undefined
    );
  }

  private nonEmpty(text: unknown): boolean {
    return typeof text === 'string' && text.trim() !== '';
  }
}

export default defineRule(
  { ruleName: 'c7-listener', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7Listener,
);
