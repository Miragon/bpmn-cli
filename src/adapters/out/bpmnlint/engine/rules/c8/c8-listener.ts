import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8CheckedElement, type ZeebeValue } from './extensions/C8CheckedElement.js';

const TASK_LISTENER_EVENT_CHOICE = '<creating|assigning|updating|completing|canceling>';

const TASK_LISTENER_EVENTS = [
  'creating',
  'assigning',
  'updating',
  'completing',
  'canceling',
  'create',
  'assignment',
  'update',
  'complete',
  'cancel',
];

/**
 * Reports execution and task listeners Camunda 8 refuses to deploy: without or with an unknown
 * event type, a start listener on a start or boundary event, an end listener on a gateway,
 * execution listeners on a sequence flow and task listeners on a job worker user task. A listener
 * without type is left to camunda-compat.
 */
class C8Listener extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    const checked = C8CheckedElement.forNode(node);
    if (!checked) {
      return;
    }

    for (const zeebeValue of checked.zeebeValues()) {
      if (zeebeValue.placement === 'flowListeners') {
        this.reportFlowListeners(checked, zeebeValue, reporter);
      } else if (
        zeebeValue.placement === 'read' &&
        zeebeValue.type.name === 'zeebe:executionListeners'
      ) {
        this.checkExecutionListeners(checked, zeebeValue, reporter);
      } else if (
        zeebeValue.placement === 'read' &&
        zeebeValue.type.name === 'zeebe:taskListeners'
      ) {
        this.checkTaskListeners(checked, zeebeValue, reporter);
      }
    }
  }

  private reportFlowListeners(
    checked: C8CheckedElement,
    { value, index }: ZeebeValue,
    reporter: Reporter,
  ): void {
    const hint = checked.hint();
    checked.report(
      reporter,
      `${checked.describe()} has execution listeners; Camunda 8 supports them on processes, activities, events and gateways, not on sequence flows, and refuses the file`,
      checked.extensionPath(index),
      {
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
        node: checked.el,
        extensionElement: value,
        hint: `Remove them (${hint ? hint.extRemove(index) : 'remove it from the XML'}) and put them on the flow's source or target.`,
      },
    );
  }

  private checkExecutionListeners(
    checked: C8CheckedElement,
    { value, index }: ZeebeValue,
    reporter: Reporter,
  ): void {
    const host = checked.el;
    const allowedEvents = this.runsAtLeast(host, '8.10')
      ? ['start', 'end', 'beforeAll', 'cancel']
      : ['start', 'end'];
    (value.listeners ?? []).forEach((listener: ModdleElement, listenerIndex: number) => {
      const eventType: string | undefined = listener.eventType;
      const label = `Execution listener ${listenerIndex + 1}${eventType?.trim() ? ` (${eventType})` : ''} of ${checked.describe()}`;
      const path = checked.extensionPath(index, 'listeners', listenerIndex, 'eventType');
      const rebuild = (lead: string, eventTypeFix: string) =>
        this.rebuildListenerHint(checked, 'executionListener', listenerIndex, lead, `eventType=${eventTypeFix} type=${listener.type ?? '<jobType>'}`);
      if (eventType === undefined || eventType.trim() === '') {
        this.reportMissingEventType(checked, listener, label, path, rebuild('Rebuild it', '<start|end>'), reporter);
      } else if (!allowedEvents.includes(eventType)) {
        this.reportEventType(
          checked,
          listener,
          `${label}: eventType "${eventType}" is not ${this.oneOf(allowedEvents)}; Camunda 8 refuses the file`,
          path,
          rebuild('Rebuild it', '<start|end>'),
          reporter,
        );
      } else if (eventType === 'start' && is(host, 'bpmn:StartEvent')) {
        this.reportEventType(
          checked,
          listener,
          `${label}: Camunda 8 does not support start listeners on start events and refuses the file`,
          path,
          rebuild('Make it an end listener or remove it', 'end'),
          reporter,
        );
      } else if (eventType === 'start' && is(host, 'bpmn:BoundaryEvent')) {
        this.reportEventType(
          checked,
          listener,
          `${label}: Camunda 8 does not support start listeners on boundary events and refuses the file`,
          path,
          rebuild('Make it an end listener or remove it', 'end'),
          reporter,
        );
      } else if (eventType === 'end' && is(host, 'bpmn:Gateway')) {
        this.reportEventType(
          checked,
          listener,
          `${label}: Camunda 8 does not support end listeners on gateways and refuses the file`,
          path,
          rebuild('Make it a start listener or remove it', 'start'),
          reporter,
        );
      }
    });
  }

  private checkTaskListeners(
    checked: C8CheckedElement,
    { value, index }: ZeebeValue,
    reporter: Reporter,
  ): void {
    const hint = checked.hint();
    if (!checked.zeebeValues().some((zeebeValue) => zeebeValue.type.name === 'zeebe:userTask')) {
      checked.report(
        reporter,
        `${checked.describe()} has task listeners but is a job worker user task (no ${checked.spell('zeebe:userTask')}); Camunda 8 allows task listeners on Camunda user tasks only and refuses the file`,
        checked.path('extensionElements'),
        {
          type: ERROR_TYPES.EXTENSION_ELEMENT_REQUIRED,
          node: checked.el,
          requiredExtensionElement: 'zeebe:UserTask',
          hint: hint
            ? `Make it a Camunda user task: ${hint.extAdd(hint.name('userTask'))} (or remove the listeners: \`bpmn ext remove <file> ${hint.target} ${hint.name('taskListeners')}\`).`
            : 'Make it a Camunda user task in the XML (or remove the listeners).',
        },
      );
    }
    (value.listeners ?? []).forEach((listener: ModdleElement, listenerIndex: number) => {
      const eventType: string | undefined = listener.eventType;
      const label = `Task listener ${listenerIndex + 1}${eventType?.trim() ? ` (${eventType})` : ''} of ${checked.describe()}`;
      const path = checked.extensionPath(index, 'listeners', listenerIndex, 'eventType');
      const hint = this.rebuildListenerHint(checked, 'taskListener', listenerIndex, 'Rebuild it', `eventType=${TASK_LISTENER_EVENT_CHOICE} type=${listener.type ?? '<jobType>'}`);
      if (eventType === undefined || eventType.trim() === '') {
        this.reportMissingEventType(checked, listener, label, path, hint, reporter);
      } else if (!TASK_LISTENER_EVENTS.includes(eventType)) {
        this.reportEventType(
          checked,
          listener,
          `${label}: eventType "${eventType}" is not one of creating, assigning, updating, completing, canceling; Camunda 8 refuses the file`,
          path,
          hint,
          reporter,
        );
      }
    });
  }

  private reportMissingEventType(
    checked: C8CheckedElement,
    listener: ModdleElement,
    label: string,
    path: (string | number)[],
    hint: string,
    reporter: Reporter,
  ): void {
    checked.report(reporter, `${label} has no eventType; Camunda 8 refuses the file`, path, {
      type: ERROR_TYPES.PROPERTY_REQUIRED,
      node: listener,
      requiredProperty: 'eventType',
      hint,
    });
  }

  private reportEventType(
    checked: C8CheckedElement,
    listener: ModdleElement,
    message: string,
    path: (string | number)[],
    hint: string,
    reporter: Reporter,
  ): void {
    checked.report(reporter, message, path, {
      type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      node: listener,
      property: 'eventType',
      hint,
    });
  }

  /**
   * `<lead>: <remove the listener>, then <add it again with fix>`: the listener is rebuilt in its
   * list (`zeebe:taskListeners/zeebe:taskListener[0]`).
   */
  private rebuildListenerHint(
    checked: C8CheckedElement,
    listenerLocal: 'executionListener' | 'taskListener',
    listenerIndex: number,
    lead: string,
    fix: string,
  ): string {
    const hint = checked.hint();
    if (!hint) {
      return `${lead}: remove it from the XML, then edit the XML.`;
    }
    const listener = `${hint.name(`${listenerLocal}s`)}/${hint.name(listenerLocal)}`;
    return `${lead}: ${hint.extRemove(`${listener}[${listenerIndex}]`)}, then ${hint.extAdd(`${listener} ${fix}`)}.`;
  }

  private oneOf(values: string[]): string {
    return values.length === 2 ? `${values[0]} or ${values[1]}` : `one of ${values.join(', ')}`;
  }
}

export default defineRule(
  { ruleName: 'c8-listener', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-listener': ['W_C8_DEPLOY_LISTENER', 'deploy'] } },
  C8Listener,
);
