import type { BpmnlintEngineReport } from '../bpmnlint-contract.js';

/**
 * The bpmn-cli code of every camunda-compat rule, the agent-facing W_C7_* / W_C8_* codes, with the
 * rules that report it as bpmnlint names them (`camunda-compat/` left out, `bpmnlint/<rule>`), or
 * `<rule>#<data.type>` for the findings of one kind of a rule that splits by kind. bpmn-cli's own
 * rules declare theirs; the rules bpmn-cli turns off have none.
 */
export class EngineCodes {
  static readonly TABLE: Readonly<Record<'c7' | 'c8', Readonly<Record<string, readonly string[]>>>> = {
    c7: { W_C7_DEPLOY_HISTORY_TTL: ['history-time-to-live'] },
    c8: {
      W_C8_CONDITION_IGNORED: ['sequence-flow-condition#camunda.propertyNotAllowed'],
      W_C8_DEPLOY_AD_HOC_SUBPROCESS: ['ad-hoc-sub-process'],
      W_C8_DEPLOY_CALLED_ELEMENT: ['called-element', 'no-business-id', 'no-propagate-all-parent-variables'],
      W_C8_DEPLOY_ERROR: ['error-reference'],
      W_C8_DEPLOY_ESCALATION: ['escalation-boundary-event-attached-to-ref', 'escalation-reference'],
      W_C8_DEPLOY_EVENT_DEFINITION: ['wait-for-completion'],
      W_C8_DEPLOY_EVENT_GATEWAY: ['event-based-gateway-target'],
      W_C8_DEPLOY_EXECUTABLE: ['executable-process'],
      W_C8_DEPLOY_EXPRESSION: ['feel-compatibility', 'no-expression'],
      W_C8_DEPLOY_EXTENSION: ['agent-fromai-contract', 'agent-tool-documentation', 'agent-tool-output-key', 'connector-properties', 'duplicate-task-headers', 'io-mapping', 'no-binding-type', 'no-job-priority-definition', 'no-version-tag', 'no-zeebe-properties', 'secrets', 'start-event-form', 'start-event-form-embedded', 'unresolvable-secret-reference', 'variable-name', 'version-tag'],
      W_C8_DEPLOY_IMPLEMENTATION: ['implementation'],
      W_C8_DEPLOY_LINK: ['link-event'],
      W_C8_DEPLOY_LISTENER: ['before-all-execution-listener', 'cancel-execution-listener', 'duplicate-execution-listener-headers', 'duplicate-execution-listeners', 'execution-listener', 'no-before-all-execution-listener', 'no-cancel-execution-listener', 'no-execution-listener-headers', 'no-execution-listeners', 'no-task-listeners', 'task-listener'],
      W_C8_DEPLOY_MESSAGE: ['message-reference', 'subscription'],
      W_C8_DEPLOY_MULTI_INSTANCE: ['loop-characteristics'],
      W_C8_DEPLOY_SIGNAL: ['signal-reference'],
      W_C8_DEPLOY_START_EVENT: ['bpmnlint/start-event-required', 'no-multiple-none-start-events'],
      W_C8_DEPLOY_TIMER: ['timer'],
      W_C8_DEPLOY_UNSUPPORTED: ['collapsed-subprocess', 'element-type', 'inclusive-gateway', 'no-interrupting-event-subprocess', 'no-loop', 'no-signal-event-sub-process'],
      W_C8_DEPLOY_USER_TASK: ['no-candidate-users', 'no-priority-definition', 'no-task-schedule', 'no-zeebe-user-task', 'priority-definition', 'task-schedule', 'user-task-form'],
      W_C8_EXCLUSIVE_GATEWAY: ['sequence-flow-condition'],
      W_C8_JOB_WORKER_USER_TASK: ['zeebe-user-task'],
      W_C8_STANDARD_LOOP: ['loop-characteristics#camunda.propertyTypeNotAllowed'],
    },
  };

  /** What a rule reports that bpmn-cli has no code for yet (a rule a newer camunda-compat adds). */
  static readonly UNMAPPED: Readonly<Record<'c7' | 'c8', string>> = { c7: 'W_C7_ENGINE_RULE', c8: 'W_C8_ENGINE_RULE' };

  /** Codes camunda-compat reports as refused at deploy that Camunda 8.9 deploys (engine-checked): the flow out of an exclusive or inclusive gateway is never taken, a standard loop runs once. */
  static readonly RUNTIME: readonly string[] = ['W_C8_EXCLUSIVE_GATEWAY', 'W_C8_STANDARD_LOOP'];

  private static readonly BY_RULE = { c7: EngineCodes.byRule('c7'), c8: EngineCodes.byRule('c8') };

  static codeOf(platform: 'c7' | 'c8', rule: string, report: BpmnlintEngineReport): string {
    const name = rule.replace(/^camunda-compat\//, '');
    const codes = EngineCodes.BY_RULE[platform];
    return codes.get(`${name}#${report.data?.type}`) ?? codes.get(name) ?? EngineCodes.UNMAPPED[platform];
  }

  private static byRule(platform: 'c7' | 'c8'): Map<string, string> {
    return new Map(Object.entries(EngineCodes.TABLE[platform]).flatMap(([code, rules]) => rules.map((rule) => [rule, code] as const)));
  }
}
