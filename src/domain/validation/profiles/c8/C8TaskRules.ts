import type { El } from '../../../document/utils/moddle.js';
import { attr, idOf, peek } from '../../utils/element.js';
import { sh } from '../../utils/hint.js';
import { blank, feelOf, isFeel, missing, nameAttr } from '../../utils/c8-value.js';
import { C8Rules } from './C8Rules.js';

/** How tasks are implemented: jobs, scripts, decisions, published messages, user tasks, loops. */
export class C8TaskRules extends C8Rules {
  /** A job: exactly one zeebe:taskDefinition with a type (static job retries checked too). */
  private checkTaskDefinition(el: El, label: string, alternative?: { local: string; count: number; text: string }): void {
    const tds = this.zeebe(el, 'taskDefinition');
    const id = idOf(el)!;
    const alt = alternative?.count ?? 0;
    if (tds.length === 0 && alt === 0) {
      this.push('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'impl', `${label} has no ${this.zeebeName('taskDefinition')}${alternative ? ` (nor ${alternative.text})` : ''}: Camunda 8 needs the job type a worker subscribes to and refuses the file`, `Give it a job type: \`bpmn ext add <file> ${id} ${this.zeebeName('taskDefinition')} type=<jobType>\`${alternative?.local === 'script' ? ` (or a FEEL script: \`bpmn ext add <file> ${id} ${this.zeebeName('script')} expression==<expression> resultVariable=<variable>\`)` : alternative?.local === 'calledDecision' ? ` (or call a DMN decision: \`bpmn ext add <file> ${id} ${this.zeebeName('calledDecision')} decisionId=<decisionId> resultVariable=<variable>\`)` : ''}.`);
      return;
    }
    if (tds.length && alt) {
      this.push('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'impl:both', `${label} has both a ${this.zeebeName('taskDefinition')} and ${alternative!.text}; Camunda 8 needs exactly one of them and refuses the file`, `Keep one: \`bpmn ext remove <file> ${id} ${this.zeebeName('taskDefinition')}\` (or \`bpmn ext remove <file> ${id} ${this.zeebeName(alternative!.local)}\`).`);
    }
    for (const td of tds.slice(0, 1)) {
      const type = attr(td, 'type');
      if (missing(type)) {
        this.push('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'impl:type', `The ${this.zeebeName('taskDefinition')} of ${label} has no type; Camunda 8 refuses the file`, this.fixHint(el, undefined, td, { type: '<jobType>' }));
      }
      const retries = attr(td, 'retries');
      if (retries !== undefined && !isFeel(retries) && !/^\s*-?\d+\s*$/.test(retries)) {
        this.push('runtime', 'W_C8_BAD_VALUE', el, undefined, 'retries', `The ${this.zeebeName('taskDefinition')} of ${label} has retries="${retries}", which is no number; it deploys, but every instance gets an incident when it reaches ${id}`, this.fixHint(el, undefined, td, { retries: '3' }));
      }
    }
  }

  /** The message a send task / message throw or end event references needs a name. */
  private checkThrownMessage(el: El, label: string): void {
    const msg = this.messageOf(el);
    if (msg && !nameAttr(msg)) {
      this.push('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'messageName', `Message ${idOf(msg)} of ${label} has no name; Camunda 8 refuses the file`, `\`bpmn set <file> ${idOf(msg)} name=<MessageName>\`.`, [idOf(msg)!]);
    }
  }

  checkServiceLike(el: El): void {
    const label = this.describe(el);
    const id = idOf(el)!;
    if (this.kit.is(el, 'bpmn:ServiceTask')) {
      this.checkTaskDefinition(el, label);
    } else if (this.kit.is(el, 'bpmn:SendTask')) {
      const pm = this.zeebe(el, 'publishMessage');
      this.checkTaskDefinition(el, label, { local: 'publishMessage', count: pm.length, text: `a ${this.zeebeName('publishMessage')}` });
      this.checkThrownMessage(el, label);
      if (pm.length && !this.zeebe(el, 'taskDefinition').length) {
        this.checkPublishMessage(el, el, pm[0]!, label);
      }
    } else if (this.kit.is(el, 'bpmn:ScriptTask')) {
      const scripts = this.zeebe(el, 'script');
      this.checkTaskDefinition(el, label, { local: 'script', count: scripts.length, text: `a ${this.zeebeName('script')}` });
      const script = scripts[0];
      if (script && !this.zeebe(el, 'taskDefinition').length) {
        const expr = attr(script, 'expression');
        if (blank(expr)) {
          this.push('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'script:expression', `The ${this.zeebeName('script')} of ${label} has no expression; Camunda 8 refuses the file`, this.fixHint(el, undefined, script, { expression: '=<expression>' }));
        } else if (!isFeel(expr)) {
          this.push('deploy', 'W_C8_DEPLOY_EXPRESSION', el, undefined, 'script:expression', `The ${this.zeebeName('script')} expression "${expr}" of ${label} is a static value; Camunda 8 needs a FEEL expression starting with = and refuses the file`, this.fixHint(el, undefined, script, { expression: `=${expr!.trim()}` }));
        }
        if (missing(attr(script, 'resultVariable'))) {
          this.push('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'script:resultVariable', `The ${this.zeebeName('script')} of ${label} has no resultVariable; Camunda 8 refuses the file`, this.fixHint(el, undefined, script, { resultVariable: '<variable>' }));
        }
      }
    } else if (this.kit.is(el, 'bpmn:BusinessRuleTask')) {
      const calls = this.zeebe(el, 'calledDecision');
      this.checkTaskDefinition(el, label, { local: 'calledDecision', count: calls.length, text: `a ${this.zeebeName('calledDecision')}` });
      const call = calls[0];
      if (call && !this.zeebe(el, 'taskDefinition').length) {
        if (missing(attr(call, 'decisionId'))) {
          this.push('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'decision:decisionId', `The ${this.zeebeName('calledDecision')} of ${label} has no decisionId; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} calledDecision=<decisionId>\`.`);
        }
        if (missing(attr(call, 'resultVariable'))) {
          this.push('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'decision:resultVariable', `The ${this.zeebeName('calledDecision')} of ${label} has no resultVariable; Camunda 8 refuses the file`, this.fixHint(el, undefined, call, { resultVariable: '<variable>' }));
        }
      }
    }
  }

  /** A message throw / end event: a job, or a zeebe:publishMessage in its message definition. */
  checkMessageThrow(el: El, def: El): void {
    const label = this.describe(el);
    const pm = this.zeebe(def, 'publishMessage');
    this.checkTaskDefinition(el, label, { local: 'publishMessage', count: pm.length, text: `a ${this.zeebeName('publishMessage')} in its message event definition` });
    this.checkThrownMessage(el, label);
    if (pm.length && !this.zeebe(el, 'taskDefinition').length) {
      this.checkPublishMessage(el, def, pm[0]!, label);
    }
  }

  /** zeebe:publishMessage: Camunda 8.9 checks it (message, correlationKey) but does not run it. */
  private checkPublishMessage(el: El, host: El, pm: El, label: string): void {
    const id = idOf(el)!;
    if (!this.messageOf(el)) {
      this.push('deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'publish:messageRef', `${label} publishes no message (no message reference); Camunda 8 refuses the file`, `\`bpmn set <file> ${id} message=<MessageName>\`.`);
    }
    if (missing(attr(pm, 'correlationKey'))) {
      this.push('deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'publish:correlationKey', `The ${this.zeebeName('publishMessage')} of ${label} has no correlationKey; Camunda 8 refuses the file`, `${this.extAdd(host, host === el ? undefined : el, `${this.zeebeName('publishMessage')} correlationKey==<expression>`)}.`);
    }
    const send = this.kit.is(el, 'bpmn:SendTask');
    this.push('runtime', 'W_C8_UNSUPPORTED_IMPLEMENTATION', el, undefined, 'publishMessage', `${label} publishes its message with ${this.zeebeName('publishMessage')}: Camunda 8.9 accepts the file but does not run it (${send ? 'the instance gets an incident: only job worker send tasks are supported' : 'the event completes without sending anything'})`, `Use a job worker: \`bpmn ext remove <file> ${id} ${send ? '' : 'definition.'}${this.zeebeName('publishMessage')}\`, then \`bpmn ext add <file> ${id} ${this.zeebeName('taskDefinition')} type=<jobType>\`.`);
  }

  checkCallActivity(el: El): void {
    const id = idOf(el)!;
    const calls = this.zeebe(el, 'calledElement');
    const bpmnCalled = peek<string>(el, 'calledElement');
    if (!calls.length) {
      this.push('deploy', 'W_C8_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement', `Call activity ${id} has no ${this.zeebeName('calledElement')}${bpmnCalled ? ` (Camunda 8 does not read the BPMN calledElement="${bpmnCalled}")` : ''}; Camunda 8 refuses the file`, `\`bpmn ext add <file> ${id} ${this.zeebeName('calledElement')} processId=${sh(bpmnCalled || '<processId>')} propagateAllChildVariables=false\`.`);
      return;
    }
    if (missing(attr(calls[0], 'processId'))) {
      this.push('deploy', 'W_C8_DEPLOY_CALLED_ELEMENT', el, undefined, 'processId', `The ${this.zeebeName('calledElement')} of call activity ${id} has no processId; Camunda 8 refuses the file`, this.fixHint(el, undefined, calls[0]!, { processId: '<processId>' }));
    }
  }

  checkUserTask(el: El): void {
    const id = idOf(el)!;
    const label = this.describe(el);
    const camunda = this.zeebe(el, 'userTask').length > 0;
    if (!camunda) {
      this.push('practice', 'W_C8_JOB_WORKER_USER_TASK', el, undefined, 'jobWorkerUserTask', `${label} has no ${this.zeebeName('userTask')}: Camunda 8 creates a job of type io.camunda.zeebe:userTask for it instead of a user task, which the v2 user task API (/v2/user-tasks) and Tasklist in V2 mode do not list`, `Make it a Camunda user task: \`bpmn ext add <file> ${id} ${this.zeebeName('userTask')}\` (a form then needs formId or externalReference instead of an embedded formKey).`);
    }
    const form = this.zeebe(el, 'formDefinition')[0];
    if (!form) return;
    const has = (attribute: string): boolean => !blank(attr(form, attribute));
    const [one, other] = camunda ? ['formId', 'externalReference'] : ['formId', 'formKey'];
    if (has(one!) === has(other!)) {
      const what = has(one!) ? `both ${one} and ${other}` : camunda && has('formKey') ? 'only an embedded formKey, which Camunda user tasks do not read' : `neither ${one} nor ${other}`;
      this.push('deploy', 'W_C8_DEPLOY_USER_TASK', el, undefined, 'form', `The ${this.zeebeName('formDefinition')} of ${camunda ? 'Camunda' : 'job worker'} user task ${id} has ${what}; Camunda 8 needs exactly one of ${one} and ${other} and refuses the file`, `Rebuild it with one of them: \`bpmn ext add <file> ${id} ${this.zeebeName('formDefinition')} formId=<formId> --replace\` (${camunda ? 'a linked form deployed with the process, or externalReference=<url>' : 'a linked form, or formKey=<key>'}).`);
    }
  }

  checkMultiInstance(activity: El): void {
    const loop = peek<El>(activity, 'loopCharacteristics');
    const id = idOf(activity)!;
    if (this.kit.is(loop, 'bpmn:StandardLoopCharacteristics')) {
      this.push('runtime', 'W_C8_STANDARD_LOOP', activity, undefined, 'standardLoop', `${this.describe(activity)} has a standard loop; Camunda 8 does not support standard loops and runs the activity once`, `Remove it (\`bpmn set <file> ${id} loop=none\`) and model the loop with a gateway, or make it a multi-instance: \`bpmn set <file> ${id} loop=sequential\`, then \`bpmn ext add <file> ${id} loop.${this.zeebeName('loopCharacteristics')} inputCollection==<items> inputElement=<item>\`.`);
      return;
    }
    if (!this.kit.is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
    const zl = this.zeebe(loop!, 'loopCharacteristics');
    const add = `\`bpmn ext add <file> ${id} loop.${this.zeebeName('loopCharacteristics')} inputCollection==<items> inputElement=<item>\``;
    if (!zl.length) {
      this.push('deploy', 'W_C8_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi', `Multi-instance ${this.describe(activity)} has no ${this.zeebeName('loopCharacteristics')} on its loop (a BPMN loop cardinality or a camunda:collection is not read); Camunda 8 refuses the file`, `${add} (outputCollection=<results> outputElement==<expression> collects results).`);
    } else {
      const zeebeLoop = zl[0]!;
      const input = attr(zeebeLoop, 'inputCollection');
      if (blank(input)) {
        this.push('deploy', 'W_C8_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:inputCollection', `The ${this.zeebeName('loopCharacteristics')} of multi-instance ${this.describe(activity)} has no inputCollection; Camunda 8 refuses the file`, this.fixHint(loop!, activity, zeebeLoop, { inputCollection: '=<items>' }));
      } else if (!isFeel(input)) {
        this.push('deploy', 'W_C8_DEPLOY_EXPRESSION', activity, undefined, 'mi:inputCollection', `inputCollection="${input}" of multi-instance ${this.describe(activity)} is a static value; Camunda 8 needs a FEEL expression (=${input!.trim()}) and refuses the file`, this.fixHint(loop!, activity, zeebeLoop, { inputCollection: `=${input!.trim()}` }));
      }
      const oc = attr(zeebeLoop, 'outputCollection');
      const oe = attr(zeebeLoop, 'outputElement');
      if ((oc === undefined) !== (oe === undefined)) {
        this.push('deploy', 'W_C8_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:output', `The ${this.zeebeName('loopCharacteristics')} of multi-instance ${this.describe(activity)} has ${oc !== undefined ? 'an outputCollection without outputElement' : 'an outputElement without outputCollection'}; Camunda 8 refuses the file`, `\`bpmn ext add <file> ${id} loop.${this.zeebeName('loopCharacteristics')} ${oc !== undefined ? 'outputElement==<expression>' : 'outputCollection=<variable>'}\`.`);
      } else if (oe !== undefined && !isFeel(oe)) {
        this.push('deploy', 'W_C8_DEPLOY_EXPRESSION', activity, undefined, 'mi:outputElement', `outputElement="${oe}" of multi-instance ${this.describe(activity)} is a static value; Camunda 8 needs a FEEL expression (=${oe.trim()}) and refuses the file`, this.fixHint(loop!, activity, zeebeLoop, { outputElement: `=${oe.trim()}` }));
      }
    }
    const cc = peek<El>(loop, 'completionCondition');
    const body = peek<string>(cc, 'body');
    if (cc) {
      this.checkFeel(activity, undefined, 'mi:completion', `The completion condition of multi-instance ${this.describe(activity)}`, body, `\`bpmn set <file> ${id} ${sh(`completion==${feelOf((body ?? '').trim().slice(1))}`)}\` (check the FEEL syntax).`);
    }
    if (cc && !isFeel(body)) {
      this.push('runtime', 'W_C8_EXPRESSION', activity, undefined, 'mi:completion', `The completion condition "${body ?? ''}" of multi-instance ${this.describe(activity)} is no FEEL expression (=...); it deploys, but every completed instance gets an incident (expected a boolean, got a string)`, `\`bpmn set <file> ${id} ${sh(`completion==${feelOf(body ?? '')}`)}\` (check the FEEL syntax).`);
    }
  }
}
