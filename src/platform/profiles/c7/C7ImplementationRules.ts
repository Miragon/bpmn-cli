import type { El } from '../../../model/utils/moddle.js';
import { attr, idOf, isGeneric, peek } from '../utils/element.js';
import { sh } from '../utils/hint.js';
import { nonEmpty } from '../utils/value.js';
import { C7Rules } from './C7Rules.js';

type FieldValue = { kind: 'string' | 'expression'; value: string } | { problem: string };

const SHELL_FLAGS = ['wait', 'redirectError', 'cleanEnv'];
const BINDINGS = ['latest', 'deployment', 'version', 'versionTag'];
const CASE_BINDINGS = ['latest', 'deployment', 'version'];
const FORM_BINDINGS = ['deployment', 'latest', 'version'];
const DECISION_MAPPERS = ['singleEntry', 'singleResult', 'collectEntries', 'resultList'];
const TTL_MAX = 2147483647;

/**
 * How activities and processes are implemented and bound: delegates, external and shell tasks,
 * called elements and decisions, forms, multi-instance loops, priorities, history time to live.
 */
export class C7ImplementationRules extends C7Rules {
  private isExpression(v: string): boolean {
    return /[$#]\{/.test(v);
  }

  private isNumber(v: string): boolean {
    return /^[+-]?\d+$/.test(v.trim()) && v.trim() === v;
  }

  /**
   * A camunda:field's value as the engines parse it: stringValue / camunda:string first, then
   * expression / camunda:expression. None, or attribute and element of one kind together, is
   * refused where the engines read fields. An element without text counts as a value.
   */
  private fieldValue(f: El): FieldValue {
    const pick = (attrName: string, child: string): { value?: string; problem?: string } => {
      const a = attr(f, attrName);
      const kids = this.children(f, child);
      if (a !== undefined && kids.length) return { problem: `both the attribute ${attrName} and a ${this.p}:${child} element` };
      if (kids.length) {
        const text = peek<unknown>(kids[0], '$body');
        return { value: typeof text === 'string' ? text : '' };
      }
      return a !== undefined && a.length > 0 ? { value: a } : {};
    };
    const s = pick('stringValue', 'string');
    if (s.problem) return { problem: s.problem };
    if (s.value !== undefined) return { kind: 'string', value: s.value };
    const e = pick('expression', 'expression');
    if (e.problem) return { problem: e.problem };
    if (e.value !== undefined) return { kind: 'expression', value: e.value };
    return { problem: 'no value' };
  }

  /**
   * Whether the engines parse the camunda:field elements of an implementation: a class or a
   * delegate expression (an expression wins and reads none), a shell task; never an external task.
   */
  fieldsRead(el: El, opts: { type?: string } = {}): boolean {
    if (opts.type !== undefined) return opts.type.toLowerCase() === 'shell';
    const get = (a: string): string | undefined => (isGeneric(el) ? attr(el, a) : this.c7(el, a));
    if (nonEmpty(get('class'))) return true;
    return get('expression') === undefined && nonEmpty(get('delegateExpression'));
  }

  /**
   * Fields without a value where the engines read them; `add` is the `ext add` type argument that
   * replaces one field.
   */
  checkFieldValues(host: El, owner: El | undefined, fields: El[], label: string, add: string | undefined): void {
    fields.forEach((f, i) => {
      const v = this.fieldValue(f);
      if (!('problem' in v)) return;
      const name = attr(f, 'name');
      const hint = add && name !== undefined ? `Give it one: \`bpmn ext add <file> ${add} name=${sh(name)} stringValue=<value>\` (replaces the field of that name; or ${sh('expression=${...}')}).` : `Give it a stringValue or an expression in the XML.`;
      this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `field:${name ?? `#${i}`}`, `${this.p}:field${name !== undefined ? ` "${name}"` : ''} of ${label} has ${v.problem}; the engines refuse the file (a field needs stringValue, expression, a ${this.p}:string or a ${this.p}:expression)`, hint);
    });
  }

  /** camunda:type="shell": a command field, fixed values only, true/false flags. */
  private checkShell(el: El, owner: El | undefined, label: string, add: string | undefined): void {
    const p = this.p;
    const fields = this.camundaExt(el, 'field');
    if (!fields.some((f) => attr(f, 'name') === 'command')) {
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'shell:command', `${label} is a shell task without a ${p}:field named command; the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=command stringValue=<command>\`.` : 'Add a command field in the XML.');
    }
    for (const f of fields) {
      const name = attr(f, 'name') ?? '';
      const v = this.fieldValue(f);
      if ('problem' in v) continue;
      if (v.kind === 'expression') {
        this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, `shell:${name}`, `${p}:field "${name}" of shell task ${label} is an expression; the shell task takes fixed values only and the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=${sh(name)} stringValue=<value>\`.` : 'Use a stringValue.');
      } else if (SHELL_FLAGS.includes(name) && !['true', 'false'].includes(v.value.toLowerCase())) {
        this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, `shell:${name}`, `${p}:field "${name}" of shell task ${label} is "${v.value}", not true or false; the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=${name} stringValue=true\` (or false).` : 'Use true or false.');
      }
    }
  }

  private hasConnector(...hosts: Array<El | undefined>): boolean {
    return hosts.some((h) => !!h && this.camundaExt(h, 'connector').length > 0);
  }

  private validTtl(v: string): boolean {
    const m = /^\+?(\d+)$/.exec(v) ?? /^P(\d+)D$/.exec(v);
    return !!m && Number(m[1]) <= TTL_MAX;
  }

  checkProcess(proc: El): void {
    const id = idOf(proc) ?? '<processId>';
    const ttl = this.c7(proc, 'historyTimeToLive');
    const hint = `\`bpmn set <file> ${id} ${this.p}:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).`;
    if (!nonEmpty(ttl)) {
      this.push('deploy', 'W_C7_DEPLOY_HISTORY_TTL', proc, undefined, 'ttl', `Executable process ${id} has no ${this.p}:historyTimeToLive; Camunda 7.20+, CIB seven and Operaton refuse to deploy it (ENGINE-12018)`, hint);
    } else if (!this.validTtl(ttl)) {
      this.push('deploy', 'W_C7_DEPLOY_HISTORY_TTL', proc, undefined, 'ttl', `${this.p}:historyTimeToLive="${ttl}" of process ${id} is not a number of days (or P<n>D); the engines refuse it`, hint);
    }
    this.checkPriorities(proc, undefined, ['jobPriority', 'taskPriority']);
  }

  /** jobPriority / taskPriority: a number or an expression, checked when the file is deployed. */
  checkPriorities(el: El, owner: El | undefined, names: string[]): void {
    const addr = this.addressOf(el, owner);
    for (const name of names) {
      const v = this.c7(el, name);
      if (v === undefined || this.isNumber(v) || this.isExpression(v)) continue;
      if (!this.kit.camunda.attr(name)?.owners.some((o) => this.kit.is(el, o))) continue;
      this.push('deploy', 'W_C7_DEPLOY_BAD_VALUE', el, owner, `attr:${name}`, `${this.p}:${name}="${v}" on ${this.describe(el, owner)} is not a number or expression; the engines refuse it`, addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${this.p}:${name}=50`)}\` (an integer or \${...}).` : 'Use an integer.');
    }
  }

  checkServiceLike(el: El): void {
    this.checkImplementation(el, undefined, this.describe(el, undefined), { decisionRef: this.kit.is(el, 'bpmn:BusinessRuleTask') });
  }

  /** Implementation of a task, or of the message definition of a message throw / end event. */
  checkImplementation(el: El, owner: El | undefined, label: string, opts: { decisionRef?: boolean; event?: El } = {}): void {
    const addr = this.addressOf(el, owner);
    const set = (kv: string): string => (addr ? `\`bpmn set <file> ${addr.id} ${kv.split(' ').map((p) => sh(`${addr.prefix}${p}`)).join(' ')}\`` : 'edit the XML');
    const type = this.c7(el, 'type');
    const topic = this.c7(el, 'topic');
    const external = type !== undefined && type.toLowerCase() === 'external';
    const shell = type !== undefined && type.toLowerCase() === 'shell';
    const p = this.p;
    // `ext add` type argument for one camunda:field of this element (keyed by name: replaces it)
    const fieldAdd = addr ? `${addr.id} ${sh(`${addr.prefix}${p}:field`)}` : undefined;
    if (type !== undefined && !external && !shell) {
      const mail = type.toLowerCase() === 'mail' ? ' (the standard engine distributions cannot load the mail task)' : '';
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'impl:type', `${p}:type="${type}" on ${label} is not supported (only "external" and "shell")${mail}; the engines refuse the file`, `Use an external task: ${set(`${p}:type=external ${p}:topic=<topic>`)}, or remove it: ${set(`${p}:type=`)}.`);
      return;
    }
    if (shell) this.checkShell(el, owner, label, fieldAdd);
    if (this.fieldsRead(el, { type })) this.checkFieldValues(el, owner, this.camundaExt(el, 'field'), label, fieldAdd);
    const impl =
      ['class', 'delegateExpression', 'expression'].some((a) => nonEmpty(this.c7(el, a))) ||
      external ||
      shell ||
      this.hasConnector(el, opts.event) ||
      (opts.decisionRef === true && this.c7(el, 'decisionRef') !== undefined);
    if (!impl) {
      if (opts.event) {
        const misplaced = ['class', 'delegateExpression', 'expression', 'type', 'topic'].some((a) => this.c7(opts.event, a) !== undefined);
        if (!misplaced) {
          this.push('runtime', 'W_C7_MESSAGE_NO_IMPLEMENTATION', el, owner, 'impl', `${label} has no implementation: it sends nothing and behaves like a none event at run time`, `Give it one: ${set(`${p}:type=external ${p}:topic=<topic>`)} (or ${p}:delegateExpression=\${...}).`);
        }
        return;
      }
      const hint = topic !== undefined ? `It has a ${p}:topic but no ${p}:type: ${set(`${p}:type=external`)}.` : `Give it one: ${set(`${p}:type=external ${p}:topic=<topic>`)} (or ${p}:delegateExpression=\${...}, ${p}:class=..., ${p}:expression=\${...}${opts.decisionRef ? `, ${p}:decisionRef=<decisionId>` : ''}).`;
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'impl', `${label} has no implementation (${p}:class, delegateExpression, expression, type=external${opts.decisionRef ? ', decisionRef' : ''} or a connector); the engines refuse the file`, hint);
      return;
    }
    if (external && topic === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_EXTERNAL_TOPIC', el, owner, 'topic', `${label} is an external task without ${p}:topic; the engines refuse the file`, `${set(`${p}:topic=<topic>`)}.`);
    } else if (external && topic === '') {
      this.push('runtime', 'W_C7_BAD_VALUE', el, owner, 'attr:topic', `${label} is an external task with an empty ${p}:topic; no worker can fetch it`, `${set(`${p}:topic=<topic>`)}.`);
    }
    if (this.c7(el, 'resultVariable') !== undefined && (nonEmpty(this.c7(el, 'class')) || nonEmpty(this.c7(el, 'delegateExpression')))) {
      this.push('deploy', 'W_C7_DEPLOY_RESULT_VARIABLE', el, owner, 'resultVariable', `${label} combines ${p}:resultVariable with ${nonEmpty(this.c7(el, 'class')) ? `${p}:class` : `${p}:delegateExpression`}; the engines support a result variable only with ${p}:expression and refuse the file`, `Remove it: ${set(`${p}:resultVariable=`)} (or switch to ${p}:expression=\${...}).`);
    }
    if (external) this.checkPriorities(el, owner, ['taskPriority']);
  }

  private checkBinding(el: El, binding: string, version: string, versionTag: string | undefined, allowed: string[]): void {
    const id = idOf(el)!;
    const p = this.p;
    const b = this.c7(el, binding);
    if (b === undefined) return;
    if (b === 'version' && this.c7(el, version) === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, binding, `${this.describe(el, undefined)} has ${p}:${binding}="version" but no ${p}:${version}; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:${version}=<n>\` (or \`${p}:${binding}=latest\`).`);
    } else if (b === 'versionTag' && versionTag && this.c7(el, versionTag) === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, binding, `${this.describe(el, undefined)} has ${p}:${binding}="versionTag" but no ${p}:${versionTag}; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:${versionTag}=<tag>\` (or \`${p}:${binding}=latest\`).`);
    } else if (!allowed.includes(b)) {
      this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, `attr:${binding}`, `${p}:${binding}="${b}" on ${this.describe(el, undefined)} is not one of ${allowed.join(', ')}; the engines accept the file but cannot resolve the reference as intended`, `\`bpmn set <file> ${id} ${p}:${binding}=latest\`.`);
    }
  }

  checkCallActivity(el: El): void {
    const id = idOf(el)!;
    const p = this.p;
    const called = peek<string>(el, 'calledElement');
    const caseRef = this.c7(el, 'caseRef');
    if (called === undefined && caseRef === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement', `Call activity ${id} has no calledElement (nor ${p}:caseRef); the engines refuse the file`, `\`bpmn set <file> ${id} calledElement=<processId>\`.`);
    } else if (called !== undefined && caseRef !== undefined) {
      this.push('deploy', 'W_C7_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement+caseRef', `Call activity ${id} has both calledElement and ${p}:caseRef; the engines refuse the file`, `Keep one: \`bpmn set <file> ${id} ${p}:caseRef=\`.`);
    } else if (called === '') {
      this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, 'attr:calledElement', `Call activity ${id} has an empty calledElement; it fails when it runs`, `\`bpmn set <file> ${id} calledElement=<processId>\`.`);
    }
    this.checkBinding(el, 'calledElementBinding', 'calledElementVersion', 'calledElementVersionTag', BINDINGS);
    this.checkBinding(el, 'caseBinding', 'caseVersion', undefined, CASE_BINDINGS);
  }

  checkBusinessRule(el: El): void {
    if (this.c7(el, 'decisionRef') === undefined) return;
    this.checkBinding(el, 'decisionRefBinding', 'decisionRefVersion', 'decisionRefVersionTag', BINDINGS);
    const map = this.c7(el, 'mapDecisionResult');
    if (map !== undefined && !DECISION_MAPPERS.includes(map)) {
      this.push('deploy', 'W_C7_DEPLOY_BAD_VALUE', el, undefined, 'attr:mapDecisionResult', `${this.p}:mapDecisionResult="${map}" on ${this.describe(el, undefined)} is not one of ${DECISION_MAPPERS.join(', ')}; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} ${this.p}:mapDecisionResult=singleEntry\` (or another of the four).`);
    }
  }

  checkForms(el: El): void {
    const id = idOf(el)!;
    const p = this.p;
    const formRef = this.c7(el, 'formRef');
    if (formRef === undefined) return;
    if (this.c7(el, 'formKey') !== undefined) {
      this.push('deploy', 'W_C7_DEPLOY_FORM', el, undefined, 'formKey+formRef', `${this.describe(el, undefined)} has both ${p}:formKey and ${p}:formRef; the engines refuse the file`, `Keep one: \`bpmn set <file> ${id} ${p}:formKey=\` (or ${p}:formRef=).`);
    }
    const binding = this.c7(el, 'formRefBinding');
    if (binding === undefined || !FORM_BINDINGS.includes(binding)) {
      this.push('deploy', 'W_C7_DEPLOY_FORM', el, undefined, 'formRefBinding', `${this.describe(el, undefined)} has ${p}:formRef but ${binding === undefined ? `no ${p}:formRefBinding` : `${p}:formRefBinding="${binding}"`} (one of ${FORM_BINDINGS.join(', ')} is required); the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:formRefBinding=latest\`.`);
    } else if (binding === 'version' && this.c7(el, 'formRefVersion') === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, 'formRefBinding', `${this.describe(el, undefined)} has ${p}:formRefBinding="version" but no ${p}:formRefVersion; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:formRefVersion=<n>\` (or ${p}:formRefBinding=latest).`);
    }
  }

  checkMultiInstance(activity: El): void {
    const loop = peek<El>(activity, 'loopCharacteristics');
    if (!this.kit.is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
    const id = idOf(activity)!;
    const p = this.p;
    const card = peek<El>(loop, 'loopCardinality');
    const collection = this.c7(loop, 'collection');
    // the engines read loopDataInputRef as a variable name, which bpmn-moddle reports on import
    const dataInput = peek<unknown>(loop, 'loopDataInputRef') ?? this.doc.importWarnings.some((w) => (w as { element?: unknown }).element === loop && /loopDataInputRef/.test(String((w as { property?: unknown }).property ?? '')));
    const elementVariable = this.c7(loop, 'elementVariable');
    if (!card && collection === undefined && !dataInput) {
      const misplaced = this.c7(activity, 'collection');
      const message = `Multi-instance ${this.describe(activity, undefined)} has neither a loop cardinality nor ${p}:collection${misplaced !== undefined ? ` (${p}:collection sits on the activity, not on the loop)` : ''}; the engines refuse the file`;
      const hint =
        misplaced !== undefined
          ? `Move it onto the loop: \`bpmn set <file> ${id} ${p}:collection= ${sh(`loop.${p}:collection=${misplaced}`)}${this.c7(activity, 'elementVariable') !== undefined ? ` ${p}:elementVariable= ${sh(`loop.${p}:elementVariable=${this.c7(activity, 'elementVariable')}`)}` : ''}\`.`
          : `\`bpmn set <file> ${id} ${sh(`loop.${p}:collection=\${items}`)} loop.${p}:elementVariable=item\` (or \`bpmn set <file> ${id} cardinality=3\`).`;
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi', message, hint);
      return;
    }
    if (card && !nonEmpty(peek<string>(card, 'body')) && collection === undefined && !dataInput) {
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:cardinality', `Multi-instance ${this.describe(activity, undefined)} has an empty loop cardinality; the engines refuse the file`, `\`bpmn set <file> ${id} cardinality=3\` (a number or \${...}).`);
    }
    if (elementVariable !== undefined && collection === undefined && !dataInput) {
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:elementVariable', `Multi-instance ${this.describe(activity, undefined)} has ${p}:elementVariable but no ${p}:collection; the engines refuse the file`, `\`bpmn set <file> ${id} ${sh(`loop.${p}:collection=\${items}`)}\` (or remove it: \`bpmn set <file> ${id} loop.${p}:elementVariable=\`).`);
    }
  }

  checkScriptTask(el: El): void {
    if (nonEmpty(peek<string>(el, 'script')) || this.c7(el, 'resource') !== undefined) return;
    this.push('deploy', 'W_C7_DEPLOY_SCRIPT', el, undefined, 'script', `Script task ${idOf(el)} has neither a script nor ${this.p}:resource; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} scriptFormat=groovy ${sh('script=...')}\` (or ${this.p}:resource=deployment://<file>).`);
  }

  checkUserTaskPriority(el: El): void {
    const v = this.c7(el, 'priority');
    if (v === undefined || this.isNumber(v) || this.isExpression(v)) return;
    this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, 'attr:priority', `${this.p}:priority="${v}" on ${this.describe(el, undefined)} is not a number or expression; creating the task fails`, `\`bpmn set <file> ${idOf(el)} ${this.p}:priority=50\`.`);
  }
}
