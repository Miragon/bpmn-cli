import type { BpmnlintEngineReport } from '../bpmnlint-contract.js';

/** A code, or for a rule whose findings split by kind: camunda-compat's `data.type` to a code, `default` for the rest. */
type EngineCode = string | { default: string; [dataType: string]: string };

/**
 * The bpmn-cli code of every camunda-compat rule, keyed as bpmnlint reports it (`camunda-compat/<rule>`,
 * `bpmnlint/<rule>`): the agent-facing W_C7_* / W_C8_* codes. bpmn-cli's own rules declare theirs.
 */
export class EngineCodes {
  static readonly TABLE: Readonly<Record<'c7' | 'c8', Readonly<Record<string, EngineCode>>>> = {
    c7: {
      'camunda-compat/history-time-to-live': 'W_C7_DEPLOY_HISTORY_TTL',
    },
    c8: {
      'bpmnlint/start-event-required': 'W_C8_DEPLOY_START_EVENT',
      'camunda-compat/ad-hoc-sub-process': 'W_C8_DEPLOY_AD_HOC_SUBPROCESS',
      'camunda-compat/agent-fromai-contract': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/agent-tool-documentation': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/agent-tool-output-key': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/before-all-execution-listener': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/called-element': 'W_C8_DEPLOY_CALLED_ELEMENT',
      'camunda-compat/cancel-execution-listener': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/collapsed-subprocess': 'W_C8_DEPLOY_UNSUPPORTED',
      'camunda-compat/connector-properties': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/duplicate-execution-listener-headers': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/duplicate-execution-listeners': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/duplicate-task-headers': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/element-type': 'W_C8_DEPLOY_UNSUPPORTED',
      'camunda-compat/error-reference': 'W_C8_DEPLOY_ERROR',
      'camunda-compat/escalation-boundary-event-attached-to-ref': 'W_C8_DEPLOY_ESCALATION',
      'camunda-compat/escalation-reference': 'W_C8_DEPLOY_ESCALATION',
      'camunda-compat/event-based-gateway-target': 'W_C8_DEPLOY_EVENT_GATEWAY',
      'camunda-compat/executable-process': 'W_C8_DEPLOY_EXECUTABLE',
      'camunda-compat/execution-listener': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/feel': 'W_C8_DEPLOY_EXPRESSION',
      'camunda-compat/feel-compatibility': 'W_C8_DEPLOY_EXPRESSION',
      'camunda-compat/implementation': 'W_C8_DEPLOY_IMPLEMENTATION',
      'camunda-compat/inclusive-gateway': 'W_C8_DEPLOY_UNSUPPORTED',
      'camunda-compat/io-mapping': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/link-event': 'W_C8_DEPLOY_LINK',
      'camunda-compat/loop-characteristics': { default: 'W_C8_DEPLOY_MULTI_INSTANCE', 'camunda.propertyTypeNotAllowed': 'W_C8_STANDARD_LOOP' },
      'camunda-compat/message-reference': 'W_C8_DEPLOY_MESSAGE',
      'camunda-compat/no-before-all-execution-listener': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/no-binding-type': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/no-business-id': 'W_C8_DEPLOY_CALLED_ELEMENT',
      'camunda-compat/no-cancel-execution-listener': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/no-candidate-users': 'W_C8_DEPLOY_USER_TASK',
      'camunda-compat/no-execution-listener-headers': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/no-execution-listeners': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/no-expression': 'W_C8_DEPLOY_EXPRESSION',
      'camunda-compat/no-interrupting-event-subprocess': 'W_C8_DEPLOY_UNSUPPORTED',
      'camunda-compat/no-job-priority-definition': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/no-loop': 'W_C8_DEPLOY_UNSUPPORTED',
      'camunda-compat/no-multiple-none-start-events': 'W_C8_DEPLOY_START_EVENT',
      'camunda-compat/no-priority-definition': 'W_C8_DEPLOY_USER_TASK',
      'camunda-compat/no-propagate-all-parent-variables': 'W_C8_DEPLOY_CALLED_ELEMENT',
      'camunda-compat/no-signal-event-sub-process': 'W_C8_DEPLOY_UNSUPPORTED',
      'camunda-compat/no-task-listeners': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/no-task-schedule': 'W_C8_DEPLOY_USER_TASK',
      'camunda-compat/no-version-tag': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/no-zeebe-properties': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/no-zeebe-user-task': 'W_C8_DEPLOY_USER_TASK',
      'camunda-compat/priority-definition': 'W_C8_DEPLOY_USER_TASK',
      'camunda-compat/secrets': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/sequence-flow-condition': { default: 'W_C8_EXCLUSIVE_GATEWAY', 'camunda.propertyNotAllowed': 'W_C8_CONDITION_IGNORED' },
      'camunda-compat/signal-reference': 'W_C8_DEPLOY_SIGNAL',
      'camunda-compat/start-event-form': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/start-event-form-embedded': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/subscription': 'W_C8_DEPLOY_MESSAGE',
      'camunda-compat/task-listener': 'W_C8_DEPLOY_LISTENER',
      'camunda-compat/task-schedule': 'W_C8_DEPLOY_USER_TASK',
      'camunda-compat/timer': 'W_C8_DEPLOY_TIMER',
      'camunda-compat/unresolvable-secret-reference': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/user-task-definition': 'W_C8_DEPLOY_USER_TASK',
      'camunda-compat/user-task-form': 'W_C8_DEPLOY_USER_TASK',
      'camunda-compat/variable-name': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/version-tag': 'W_C8_DEPLOY_EXTENSION',
      'camunda-compat/wait-for-completion': 'W_C8_DEPLOY_EVENT_DEFINITION',
      'camunda-compat/zeebe-user-task': 'W_C8_JOB_WORKER_USER_TASK',
    },
  };

  /** What a rule reports that bpmn-cli has no code for yet (a rule a newer camunda-compat adds). */
  static readonly UNMAPPED: Readonly<Record<'c7' | 'c8', string>> = { c7: 'W_C7_ENGINE_RULE', c8: 'W_C8_ENGINE_RULE' };

  static codeOf(platform: 'c7' | 'c8', rule: string, report: BpmnlintEngineReport): string {
    const code = EngineCodes.TABLE[platform][rule];
    if (code === undefined) return EngineCodes.UNMAPPED[platform];
    if (typeof code === 'string') return code;
    const type = report.data?.type;
    return (type !== undefined ? code[type] : undefined) ?? code.default;
  }
}
