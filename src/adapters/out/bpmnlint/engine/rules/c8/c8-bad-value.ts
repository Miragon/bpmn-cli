import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8Events } from './tasks/C8Events.js';
import { ExecutableScope } from './tasks/ExecutableScope.js';
import { ModdlePath } from './tasks/ModdlePath.js';
import { isBlank, isFeel } from './tasks/utils/value.js';
import { ZeebeExtensions } from './tasks/ZeebeExtensions.js';
import { ZeebeHint } from './extensions/ZeebeHint.js';
import { sh } from '../shell.js';

/**
 * Reports values Camunda 8 deploys but cannot use: job retries that are no number (an incident on
 * every instance) and task headers without key or value (dropped from the job).
 */
class C8BadValue extends C8Rule {
  private static readonly JOB_TASKS = [
    'bpmn:ServiceTask',
    'bpmn:SendTask',
    'bpmn:ScriptTask',
    'bpmn:BusinessRuleTask',
  ];

  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'zeebe:TaskHeaders') || is(node, 'zeebe:ExecutionListeners')) {
      this.checkHeadersOf(node, reporter);
      return;
    }
    if (this.isJobHost(node) && ExecutableScope.covers(node)) {
      this.checkRetries(node, reporter);
    }
  }

  private isJobHost(node: ModdleElement): boolean {
    if (isAny(node, C8BadValue.JOB_TASKS)) {
      return true;
    }
    const definition = is(node, 'bpmn:ThrowEvent') ? C8Events.definitionOf(node) : undefined;
    return !!definition && is(definition, 'bpmn:MessageEventDefinition');
  }

  private checkRetries(node: ModdleElement, reporter: Reporter): void {
    const taskDefinition = ZeebeExtensions.valuesOf(node, 'zeebe:TaskDefinition')[0];
    const retries = taskDefinition?.retries;
    if (retries === undefined || isFeel(retries) || /^\s*-?\d+\s*$/.test(retries)) {
      return;
    }
    reportErrors(node, reporter, {
      message: `The ${ZeebeHint.prefixOf(node)}:taskDefinition of ${describeElement(node)} has retries="${retries}", which is no number; it deploys, but every instance gets an incident when it reaches ${node.id}`,
      path: [...ModdlePath.between(node, taskDefinition), 'retries'],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node: taskDefinition,
        parentNode: node,
        property: 'retries',
        hint: ZeebeHint.of(node)?.replace(taskDefinition, { retries: '3' }) ?? 'edit the XML.',
      },
    });
  }

  private checkHeadersOf(node: ModdleElement, reporter: Reporter): void {
    const host = ZeebeExtensions.readHostOf(node);
    if (!host) {
      return;
    }
    if (is(node, 'zeebe:TaskHeaders')) {
      this.checkHeaders(node, host, '', reporter);
      return;
    }
    if (is(host, 'bpmn:SequenceFlow')) {
      return;
    }
    (node.listeners ?? []).forEach((listener: ModdleElement, index: number) => {
      if (listener.headers) {
        this.checkHeaders(listener.headers, host, `execution listener ${index + 1} of `, reporter);
      }
    });
  }

  private checkHeaders(
    headers: ModdleElement,
    host: ModdleElement,
    inListener: string,
    reporter: Reporter,
  ): void {
    const owner = ModdlePath.ownerOf(host);
    const where = `${inListener}${host.id ? describeElement(host) : describeElement(host, owner)}`;
    const hint = host.id && !inListener ? ZeebeHint.of(host) : undefined;
    (headers.values ?? []).forEach((header: ModdleElement, index: number) => {
      const missing = isBlank(header.key) ? 'key' : isBlank(header.value) ? 'value' : undefined;
      if (!missing) {
        return;
      }
      reportErrors(owner, reporter, {
        message: `Task header ${header.key ? `"${header.key}"` : index + 1} of ${where} has no ${missing}; Camunda 8 drops it, the job does not carry it`,
        path: [...ModdlePath.between(owner, header), missing],
        data: {
          type: ERROR_TYPES.PROPERTY_REQUIRED,
          node: header,
          parentNode: owner,
          requiredProperty: missing,
          hint: hint ? this.headerHint(hint, header, index, missing) : 'Fix it in the XML.',
        },
      });
    });
  }

  /** Re-add a header without key (after removing it) or without value: `bpmn ext add` replaces the header of its key. */
  private headerHint(hint: ZeebeHint, header: ModdleElement, index: number, missing: 'key' | 'value'): string {
    const add = hint.extAdd(`${hint.name('header')} key=${header.key ?? '<key>'} value=<value>`);
    if (missing === 'value') {
      return `Give it a value: ${add}.`;
    }
    const remove = `\`bpmn ext remove <file> ${hint.target} ${sh(`${hint.name('taskHeaders')}/${hint.name('header')}[${index}]`)}\``;
    return `Remove it (${remove}) and add it with a key: ${add}.`;
  }
}

export default defineRule(
  { ruleName: 'c8-bad-value', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-bad-value': ['W_C8_BAD_VALUE', 'runtime'] } },
  C8BadValue,
);
