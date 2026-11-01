import { type BpmnElement } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C8TaskRules extends C8Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:ServiceTask') || element.is('bpmn:SendTask') || element.is('bpmn:ScriptTask') || element.is('bpmn:BusinessRuleTask')) {
      this.checkServiceLike(element, reporter);
    }
    if (element.is('bpmn:CallActivity')) {
      this.checkCallActivity(element, reporter);
    }
    if (element.is('bpmn:UserTask')) {
      this.checkUserTask(element, reporter);
    }
    if (element.is('bpmn:Activity')) {
      this.checkMultiInstance(element, reporter);
    }
  }

  private checkTaskDefinition(el: BpmnElement, label: string, reporter: RuleReporter, alternative?: { local: string; count: number; text: string }): void {
    const tds = this.zeebe(el, 'taskDefinition');
    const id = el.id;
    const alt = alternative?.count ?? 0;
    if (tds.length === 0 && alt === 0) {
      reporter.deploy({ code: 'W_C8_DEPLOY_IMPLEMENTATION', element: el, subject: 'impl', message: `${label} has no ${this.zeebeName('taskDefinition')}${alternative ? ` (nor ${alternative.text})` : ''}: Camunda 8 needs the job type a worker subscribes to and refuses the file`, hint: `Give it a job type: \`bpmn ext add <file> ${id} ${this.zeebeName('taskDefinition')} type=<jobType>\`${alternative?.local === 'script' ? ` (or a FEEL script: \`bpmn ext add <file> ${id} ${this.zeebeName('script')} expression==<expression> resultVariable=<variable>\`)` : alternative?.local === 'calledDecision' ? ` (or call a DMN decision: \`bpmn ext add <file> ${id} ${this.zeebeName('calledDecision')} decisionId=<decisionId> resultVariable=<variable>\`)` : ''}.` });
      return;
    }
    if (tds.length && alt) {
      reporter.deploy({ code: 'W_C8_DEPLOY_IMPLEMENTATION', element: el, subject: 'impl:both', message: `${label} has both a ${this.zeebeName('taskDefinition')} and ${alternative!.text}; Camunda 8 needs exactly one of them and refuses the file`, hint: `Keep one: \`bpmn ext remove <file> ${id} ${this.zeebeName('taskDefinition')}\` (or \`bpmn ext remove <file> ${id} ${this.zeebeName(alternative!.local)}\`).` });
    }
    for (const td of tds.slice(0, 1)) {
      const type = this.attr(td, 'type');
      if (this.missing(type)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_IMPLEMENTATION', element: el, subject: 'impl:type', message: `The ${this.zeebeName('taskDefinition')} of ${label} has no type; Camunda 8 refuses the file`, hint: this.fixHint(el, undefined, td, { type: '<jobType>' }) });
      }
      const retries = this.attr(td, 'retries');
      if (retries !== undefined && !this.isFeel(retries) && !/^\s*-?\d+\s*$/.test(retries)) {
        reporter.runtime({ code: 'W_C8_BAD_VALUE', element: el, subject: 'retries', message: `The ${this.zeebeName('taskDefinition')} of ${label} has retries="${retries}", which is no number; it deploys, but every instance gets an incident when it reaches ${id}`, hint: this.fixHint(el, undefined, td, { retries: '3' }) });
      }
    }
  }

  private checkThrownMessage(el: BpmnElement, label: string, reporter: RuleReporter): void {
    const msg = this.messageOf(el);
    if (msg && !this.nameAttr(msg)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_IMPLEMENTATION', element: el, subject: 'messageName', message: `Message ${msg.id} of ${label} has no name; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${msg.id} name=<MessageName>\`.`, related: [msg.id] });
    }
  }

  checkServiceLike(el: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el);
    const id = el.id;
    if (el.is('bpmn:ServiceTask')) {
      this.checkTaskDefinition(el, label, reporter);
    } else if (el.is('bpmn:SendTask')) {
      const pm = this.zeebe(el, 'publishMessage');
      this.checkTaskDefinition(el, label, reporter, { local: 'publishMessage', count: pm.length, text: `a ${this.zeebeName('publishMessage')}` });
      this.checkThrownMessage(el, label, reporter);
      if (pm.length && !this.zeebe(el, 'taskDefinition').length) {
        this.checkPublishMessage(el, el, pm[0]!, label, reporter);
      }
    } else if (el.is('bpmn:ScriptTask')) {
      const scripts = this.zeebe(el, 'script');
      this.checkTaskDefinition(el, label, reporter, { local: 'script', count: scripts.length, text: `a ${this.zeebeName('script')}` });
      const script = scripts[0];
      if (script && !this.zeebe(el, 'taskDefinition').length) {
        const expr = this.attr(script, 'expression');
        if (this.blank(expr)) {
          reporter.deploy({ code: 'W_C8_DEPLOY_IMPLEMENTATION', element: el, subject: 'script:expression', message: `The ${this.zeebeName('script')} of ${label} has no expression; Camunda 8 refuses the file`, hint: this.fixHint(el, undefined, script, { expression: '=<expression>' }) });
        } else if (!this.isFeel(expr)) {
          reporter.deploy({ code: 'W_C8_DEPLOY_EXPRESSION', element: el, subject: 'script:expression', message: `The ${this.zeebeName('script')} expression "${expr}" of ${label} is a static value; Camunda 8 needs a FEEL expression starting with = and refuses the file`, hint: this.fixHint(el, undefined, script, { expression: `=${expr!.trim()}` }) });
        }
        if (this.missing(this.attr(script, 'resultVariable'))) {
          reporter.deploy({ code: 'W_C8_DEPLOY_IMPLEMENTATION', element: el, subject: 'script:resultVariable', message: `The ${this.zeebeName('script')} of ${label} has no resultVariable; Camunda 8 refuses the file`, hint: this.fixHint(el, undefined, script, { resultVariable: '<variable>' }) });
        }
      }
    } else if (el.is('bpmn:BusinessRuleTask')) {
      const calls = this.zeebe(el, 'calledDecision');
      this.checkTaskDefinition(el, label, reporter, { local: 'calledDecision', count: calls.length, text: `a ${this.zeebeName('calledDecision')}` });
      const call = calls[0];
      if (call && !this.zeebe(el, 'taskDefinition').length) {
        if (this.missing(this.attr(call, 'decisionId'))) {
          reporter.deploy({ code: 'W_C8_DEPLOY_IMPLEMENTATION', element: el, subject: 'decision:decisionId', message: `The ${this.zeebeName('calledDecision')} of ${label} has no decisionId; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${id} calledDecision=<decisionId>\`.` });
        }
        if (this.missing(this.attr(call, 'resultVariable'))) {
          reporter.deploy({ code: 'W_C8_DEPLOY_IMPLEMENTATION', element: el, subject: 'decision:resultVariable', message: `The ${this.zeebeName('calledDecision')} of ${label} has no resultVariable; Camunda 8 refuses the file`, hint: this.fixHint(el, undefined, call, { resultVariable: '<variable>' }) });
        }
      }
    }
  }

  checkMessageThrow(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el);
    const pm = this.zeebe(def, 'publishMessage');
    this.checkTaskDefinition(el, label, reporter, { local: 'publishMessage', count: pm.length, text: `a ${this.zeebeName('publishMessage')} in its message event definition` });
    this.checkThrownMessage(el, label, reporter);
    if (pm.length && !this.zeebe(el, 'taskDefinition').length) {
      this.checkPublishMessage(el, def, pm[0]!, label, reporter);
    }
  }

  private checkPublishMessage(el: BpmnElement, host: BpmnElement, pm: BpmnElement, label: string, reporter: RuleReporter): void {
    const id = el.id;
    if (!this.messageOf(el)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_MESSAGE', element: el, subject: 'publish:messageRef', message: `${label} publishes no message (no message reference); Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${id} message=<MessageName>\`.` });
    }
    if (this.missing(this.attr(pm, 'correlationKey'))) {
      reporter.deploy({ code: 'W_C8_DEPLOY_MESSAGE', element: el, subject: 'publish:correlationKey', message: `The ${this.zeebeName('publishMessage')} of ${label} has no correlationKey; Camunda 8 refuses the file`, hint: `${this.extAdd(host, host === el ? undefined : el, `${this.zeebeName('publishMessage')} correlationKey==<expression>`)}.` });
    }
    const send = el.is('bpmn:SendTask');
    reporter.runtime({ code: 'W_C8_UNSUPPORTED_IMPLEMENTATION', element: el, subject: 'publishMessage', message: `${label} publishes its message with ${this.zeebeName('publishMessage')}: Camunda 8.9 accepts the file but does not run it (${send ? 'the instance gets an incident: only job worker send tasks are supported' : 'the event completes without sending anything'})`, hint: `Use a job worker: \`bpmn ext remove <file> ${id} ${send ? '' : 'definition.'}${this.zeebeName('publishMessage')}\`, then \`bpmn ext add <file> ${id} ${this.zeebeName('taskDefinition')} type=<jobType>\`.` });
  }

  checkCallActivity(el: BpmnElement, reporter: RuleReporter): void {
    const id = el.id;
    const calls = this.zeebe(el, 'calledElement');
    const bpmnCalled = el.peek<string>('calledElement');
    if (!calls.length) {
      reporter.deploy({ code: 'W_C8_DEPLOY_CALLED_ELEMENT', element: el, subject: 'calledElement', message: `Call activity ${id} has no ${this.zeebeName('calledElement')}${bpmnCalled ? ` (Camunda 8 does not read the BPMN calledElement="${bpmnCalled}")` : ''}; Camunda 8 refuses the file`, hint: `\`bpmn ext add <file> ${id} ${this.zeebeName('calledElement')} processId=${ShellWords.quote(bpmnCalled || '<processId>')} propagateAllChildVariables=false\`.` });
      return;
    }
    if (this.missing(this.attr(calls[0], 'processId'))) {
      reporter.deploy({ code: 'W_C8_DEPLOY_CALLED_ELEMENT', element: el, subject: 'processId', message: `The ${this.zeebeName('calledElement')} of call activity ${id} has no processId; Camunda 8 refuses the file`, hint: this.fixHint(el, undefined, calls[0]!, { processId: '<processId>' }) });
    }
  }

  checkUserTask(el: BpmnElement, reporter: RuleReporter): void {
    const id = el.id;
    const label = this.describe(el);
    const camunda = this.zeebe(el, 'userTask').length > 0;
    if (!camunda) {
      reporter.practice({ code: 'W_C8_JOB_WORKER_USER_TASK', element: el, subject: 'jobWorkerUserTask', message: `${label} has no ${this.zeebeName('userTask')}: Camunda 8 creates a job of type io.camunda.zeebe:userTask for it instead of a user task, which the v2 user task API (/v2/user-tasks) and Tasklist in V2 mode do not list`, hint: `Make it a Camunda user task: \`bpmn ext add <file> ${id} ${this.zeebeName('userTask')}\` (a form then needs formId or externalReference instead of an embedded formKey).` });
    }
    const form = this.zeebe(el, 'formDefinition')[0];
    if (!form) {
      return;
    }
    const has = (attribute: string): boolean => !this.blank(this.attr(form, attribute));
    const [one, other] = camunda ? ['formId', 'externalReference'] : ['formId', 'formKey'];
    if (has(one!) === has(other!)) {
      const what = has(one!) ? `both ${one} and ${other}` : camunda && has('formKey') ? 'only an embedded formKey, which Camunda user tasks do not read' : `neither ${one} nor ${other}`;
      reporter.deploy({ code: 'W_C8_DEPLOY_USER_TASK', element: el, subject: 'form', message: `The ${this.zeebeName('formDefinition')} of ${camunda ? 'Camunda' : 'job worker'} user task ${id} has ${what}; Camunda 8 needs exactly one of ${one} and ${other} and refuses the file`, hint: `Rebuild it with one of them: \`bpmn ext add <file> ${id} ${this.zeebeName('formDefinition')} formId=<formId> --replace\` (${camunda ? 'a linked form deployed with the process, or externalReference=<url>' : 'a linked form, or formKey=<key>'}).` });
    }
  }

  checkMultiInstance(activity: BpmnElement, reporter: RuleReporter): void {
    const loop = activity.peek<BpmnElement>('loopCharacteristics');
    const id = activity.id;
    if (loop?.is('bpmn:StandardLoopCharacteristics')) {
      reporter.runtime({ code: 'W_C8_STANDARD_LOOP', element: activity, subject: 'standardLoop', message: `${this.describe(activity)} has a standard loop; Camunda 8 does not support standard loops and runs the activity once`, hint: `Remove it (\`bpmn set <file> ${id} loop=none\`) and model the loop with a gateway, or make it a multi-instance: \`bpmn set <file> ${id} loop=sequential\`, then \`bpmn ext add <file> ${id} loop.${this.zeebeName('loopCharacteristics')} inputCollection==<items> inputElement=<item>\`.` });
      return;
    }
    if (!loop?.is('bpmn:MultiInstanceLoopCharacteristics')) {
      return;
    }
    const zl = this.zeebe(loop!, 'loopCharacteristics');
    const add = `\`bpmn ext add <file> ${id} loop.${this.zeebeName('loopCharacteristics')} inputCollection==<items> inputElement=<item>\``;
    if (!zl.length) {
      reporter.deploy({ code: 'W_C8_DEPLOY_MULTI_INSTANCE', element: activity, subject: 'mi', message: `Multi-instance ${this.describe(activity)} has no ${this.zeebeName('loopCharacteristics')} on its loop (a BPMN loop cardinality or a camunda:collection is not read); Camunda 8 refuses the file`, hint: `${add} (outputCollection=<results> outputElement==<expression> collects results).` });
    } else {
      const zeebeLoop = zl[0]!;
      const input = this.attr(zeebeLoop, 'inputCollection');
      if (this.blank(input)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_MULTI_INSTANCE', element: activity, subject: 'mi:inputCollection', message: `The ${this.zeebeName('loopCharacteristics')} of multi-instance ${this.describe(activity)} has no inputCollection; Camunda 8 refuses the file`, hint: this.fixHint(loop!, activity, zeebeLoop, { inputCollection: '=<items>' }) });
      } else if (!this.isFeel(input)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_EXPRESSION', element: activity, subject: 'mi:inputCollection', message: `inputCollection="${input}" of multi-instance ${this.describe(activity)} is a static value; Camunda 8 needs a FEEL expression (=${input!.trim()}) and refuses the file`, hint: this.fixHint(loop!, activity, zeebeLoop, { inputCollection: `=${input!.trim()}` }) });
      }
      const oc = this.attr(zeebeLoop, 'outputCollection');
      const oe = this.attr(zeebeLoop, 'outputElement');
      if ((oc === undefined) !== (oe === undefined)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_MULTI_INSTANCE', element: activity, subject: 'mi:output', message: `The ${this.zeebeName('loopCharacteristics')} of multi-instance ${this.describe(activity)} has ${oc !== undefined ? 'an outputCollection without outputElement' : 'an outputElement without outputCollection'}; Camunda 8 refuses the file`, hint: `\`bpmn ext add <file> ${id} loop.${this.zeebeName('loopCharacteristics')} ${oc !== undefined ? 'outputElement==<expression>' : 'outputCollection=<variable>'}\`.` });
      } else if (oe !== undefined && !this.isFeel(oe)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_EXPRESSION', element: activity, subject: 'mi:outputElement', message: `outputElement="${oe}" of multi-instance ${this.describe(activity)} is a static value; Camunda 8 needs a FEEL expression (=${oe.trim()}) and refuses the file`, hint: this.fixHint(loop!, activity, zeebeLoop, { outputElement: `=${oe.trim()}` }) });
      }
    }
    const cc = loop?.peek<BpmnElement>('completionCondition');
    const body = cc?.peek<string>('body');
    if (cc) {
      this.checkFeel(activity, undefined, 'mi:completion', `The completion condition of multi-instance ${this.describe(activity)}`, body, `\`bpmn set <file> ${id} ${ShellWords.quote(`completion==${this.feelOf((body ?? '').trim().slice(1))}`)}\` (check the FEEL syntax).`, reporter);
    }
    if (cc && !this.isFeel(body)) {
      reporter.runtime({ code: 'W_C8_EXPRESSION', element: activity, subject: 'mi:completion', message: `The completion condition "${body ?? ''}" of multi-instance ${this.describe(activity)} is no FEEL expression (=...); it deploys, but every completed instance gets an incident (expected a boolean, got a string)`, hint: `\`bpmn set <file> ${id} ${ShellWords.quote(`completion==${this.feelOf(body ?? '')}`)}\` (check the FEEL syntax).` });
    }
  }
}
