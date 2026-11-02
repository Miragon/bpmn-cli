import { type BpmnElement } from '../../../model/index.js';
import type { C7ImplementationRules } from './C7ImplementationRules.js';
import { C7Rules } from './C7Rules.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7BindingRules extends C7Rules {
  private static readonly BINDINGS = ['latest', 'deployment', 'version', 'versionTag'];
  private static readonly CASE_BINDINGS = ['latest', 'deployment', 'version'];
  private static readonly FORM_BINDINGS = ['deployment', 'latest', 'version'];
  private static readonly DECISION_MAPPERS = ['singleEntry', 'singleResult', 'collectEntries', 'resultList'];
  private static readonly TTL_MAX = 2147483647;

  constructor(
    context: RuleContext,
    private readonly implementation: C7ImplementationRules,
  ) {
    super(context);
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    if (!reporter.executable) {
      return;
    }
    if (element.is('bpmn:Process')) {
      this.checkProcess(element, reporter);
    }
    if (element.is('bpmn:BusinessRuleTask')) {
      this.checkBusinessRule(element, reporter);
    }
    if (element.is('bpmn:CallActivity')) {
      this.checkCallActivity(element, reporter);
    }
    if (element.is('bpmn:UserTask') || element.is('bpmn:StartEvent')) {
      this.checkForms(element, reporter);
    }
    if (element.is('bpmn:UserTask')) {
      this.checkUserTaskPriority(element, reporter);
    }
    if (element.is('bpmn:Activity')) {
      this.checkMultiInstance(element, reporter);
    }
    if (element.is('bpmn:ScriptTask')) {
      this.checkScriptTask(element, reporter);
    }
  }

  private static validTtl(ttl: string): boolean {
    const match = /^\+?(\d+)$/.exec(ttl) ?? /^P(\d+)D$/.exec(ttl);
    return !!match && Number(match[1]) <= C7BindingRules.TTL_MAX;
  }

  private checkProcess(proc: BpmnElement, reporter: RuleReporter): void {
    const id = proc.id ?? '<processId>';
    const ttl = this.c7(proc, 'historyTimeToLive');
    const hint = `\`bpmn set <file> ${id} ${this.prefix}:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).`;
    if (!this.nonEmpty(ttl)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_HISTORY_TTL', element: proc, subject: 'ttl', message: `Executable process ${id} has no ${this.prefix}:historyTimeToLive; Camunda 7.20+, CIB seven and Operaton refuse to deploy it (ENGINE-12018)`, hint });
    } else if (!C7BindingRules.validTtl(ttl)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_HISTORY_TTL', element: proc, subject: 'ttl', message: `${this.prefix}:historyTimeToLive="${ttl}" of process ${id} is not a number of days (or P<n>D); the engines refuse it`, hint });
    }
    this.implementation.checkPriorities(proc, undefined, ['jobPriority', 'taskPriority'], reporter);
  }

  private checkBinding(el: BpmnElement, binding: string, version: string, versionTag: string | undefined, allowed: string[], reporter: RuleReporter): void {
    const bindingValue = this.c7(el, binding);
    if (bindingValue === undefined) {
      return;
    }
    if (bindingValue === 'version' && this.c7(el, version) === undefined) {
      reporter.deploy({ code: 'W_C7_DEPLOY_BINDING_VERSION', element: el, subject: binding, message: `${this.describe(el, undefined)} has ${this.prefix}:${binding}="version" but no ${this.prefix}:${version}; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} ${this.prefix}:${version}=<n>\` (or \`${this.prefix}:${binding}=latest\`).` });
    } else if (bindingValue === 'versionTag' && versionTag && this.c7(el, versionTag) === undefined) {
      reporter.deploy({ code: 'W_C7_DEPLOY_BINDING_VERSION', element: el, subject: binding, message: `${this.describe(el, undefined)} has ${this.prefix}:${binding}="versionTag" but no ${this.prefix}:${versionTag}; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} ${this.prefix}:${versionTag}=<tag>\` (or \`${this.prefix}:${binding}=latest\`).` });
    } else if (!allowed.includes(bindingValue)) {
      reporter.runtime({ code: 'W_C7_BAD_VALUE', element: el, subject: `attr:${binding}`, message: `${this.prefix}:${binding}="${bindingValue}" on ${this.describe(el, undefined)} is not one of ${allowed.join(', ')}; the engines accept the file but cannot resolve the reference as intended`, hint: `\`bpmn set <file> ${el.id} ${this.prefix}:${binding}=latest\`.`, fix: { op: 'set', id: el.id, set: { [`${this.prefix}:${binding}`]: 'latest' } } });
    }
  }

  private checkCallActivity(el: BpmnElement, reporter: RuleReporter): void {
    const called = el.peek<string>('calledElement');
    const caseRef = this.c7(el, 'caseRef');
    if (called === undefined && caseRef === undefined) {
      reporter.deploy({ code: 'W_C7_DEPLOY_CALLED_ELEMENT', element: el, subject: 'calledElement', message: `Call activity ${el.id} has no calledElement (nor ${this.prefix}:caseRef); the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} calledElement=<processId>\`.` });
    } else if (called !== undefined && caseRef !== undefined) {
      reporter.deploy({ code: 'W_C7_DEPLOY_CALLED_ELEMENT', element: el, subject: 'calledElement+caseRef', message: `Call activity ${el.id} has both calledElement and ${this.prefix}:caseRef; the engines refuse the file`, hint: `Keep one: \`bpmn set <file> ${el.id} ${this.prefix}:caseRef=\`.` });
    } else if (called === '') {
      reporter.runtime({ code: 'W_C7_BAD_VALUE', element: el, subject: 'attr:calledElement', message: `Call activity ${el.id} has an empty calledElement; it fails when it runs`, hint: `\`bpmn set <file> ${el.id} calledElement=<processId>\`.` });
    }
    this.checkBinding(el, 'calledElementBinding', 'calledElementVersion', 'calledElementVersionTag', C7BindingRules.BINDINGS, reporter);
    this.checkBinding(el, 'caseBinding', 'caseVersion', undefined, C7BindingRules.CASE_BINDINGS, reporter);
  }

  private checkBusinessRule(el: BpmnElement, reporter: RuleReporter): void {
    if (this.c7(el, 'decisionRef') === undefined) {
      return;
    }
    this.checkBinding(el, 'decisionRefBinding', 'decisionRefVersion', 'decisionRefVersionTag', C7BindingRules.BINDINGS, reporter);
    const map = this.c7(el, 'mapDecisionResult');
    if (map !== undefined && !C7BindingRules.DECISION_MAPPERS.includes(map)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_BAD_VALUE', element: el, subject: 'attr:mapDecisionResult', message: `${this.prefix}:mapDecisionResult="${map}" on ${this.describe(el, undefined)} is not one of ${C7BindingRules.DECISION_MAPPERS.join(', ')}; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} ${this.prefix}:mapDecisionResult=singleEntry\` (or another of the four).`, fix: { op: 'set', id: el.id, set: { [`${this.prefix}:mapDecisionResult`]: 'singleEntry' } } });
    }
  }

  private checkForms(el: BpmnElement, reporter: RuleReporter): void {
    const formRef = this.c7(el, 'formRef');
    if (formRef === undefined) {
      return;
    }
    if (this.c7(el, 'formKey') !== undefined) {
      reporter.deploy({ code: 'W_C7_DEPLOY_FORM', element: el, subject: 'formKey+formRef', message: `${this.describe(el, undefined)} has both ${this.prefix}:formKey and ${this.prefix}:formRef; the engines refuse the file`, hint: `Keep one: \`bpmn set <file> ${el.id} ${this.prefix}:formKey=\` (or ${this.prefix}:formRef=).` });
    }
    const binding = this.c7(el, 'formRefBinding');
    if (binding === undefined || !C7BindingRules.FORM_BINDINGS.includes(binding)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_FORM', element: el, subject: 'formRefBinding', message: `${this.describe(el, undefined)} has ${this.prefix}:formRef but ${binding === undefined ? `no ${this.prefix}:formRefBinding` : `${this.prefix}:formRefBinding="${binding}"`} (one of ${C7BindingRules.FORM_BINDINGS.join(', ')} is required); the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} ${this.prefix}:formRefBinding=latest\`.`, fix: { op: 'set', id: el.id, set: { [`${this.prefix}:formRefBinding`]: 'latest' } } });
    } else if (binding === 'version' && this.c7(el, 'formRefVersion') === undefined) {
      reporter.deploy({ code: 'W_C7_DEPLOY_BINDING_VERSION', element: el, subject: 'formRefBinding', message: `${this.describe(el, undefined)} has ${this.prefix}:formRefBinding="version" but no ${this.prefix}:formRefVersion; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} ${this.prefix}:formRefVersion=<n>\` (or ${this.prefix}:formRefBinding=latest).` });
    }
  }

  checkMultiInstance(activity: BpmnElement, reporter: RuleReporter): void {
    const loop = activity.peek<BpmnElement>('loopCharacteristics');
    if (!loop?.is('bpmn:MultiInstanceLoopCharacteristics')) {
      return;
    }
    const card = loop?.peek<BpmnElement>('loopCardinality');
    const collection = this.c7(loop, 'collection');
    const dataInput = loop?.peek<unknown>('loopDataInputRef') ?? this.document.importWarnings.some((warning) => (warning as { element?: unknown }).element === loop?.raw && /loopDataInputRef/.test(String((warning as { property?: unknown }).property ?? '')));
    const elementVariable = this.c7(loop, 'elementVariable');
    if (!card && collection === undefined && !dataInput) {
      const misplaced = this.c7(activity, 'collection');
      const message = `Multi-instance ${this.describe(activity, undefined)} has neither a loop cardinality nor ${this.prefix}:collection${misplaced !== undefined ? ` (${this.prefix}:collection sits on the activity, not on the loop)` : ''}; the engines refuse the file`;
      const hint =
        misplaced !== undefined
          ? `Move it onto the loop: \`bpmn set <file> ${activity.id} ${this.prefix}:collection= ${ShellWords.quote(`loop.${this.prefix}:collection=${misplaced}`)}${this.c7(activity, 'elementVariable') !== undefined ? ` ${this.prefix}:elementVariable= ${ShellWords.quote(`loop.${this.prefix}:elementVariable=${this.c7(activity, 'elementVariable')}`)}` : ''}\`.`
          : `\`bpmn set <file> ${activity.id} ${ShellWords.quote(`loop.${this.prefix}:collection=\${items}`)} loop.${this.prefix}:elementVariable=item\` (or \`bpmn set <file> ${activity.id} cardinality=3\`).`;
      reporter.deploy({ code: 'W_C7_DEPLOY_MULTI_INSTANCE', element: activity, subject: 'mi', message, hint });
      return;
    }
    if (card && !this.nonEmpty(card.peek<string>('body')) && collection === undefined && !dataInput) {
      reporter.deploy({ code: 'W_C7_DEPLOY_MULTI_INSTANCE', element: activity, subject: 'mi:cardinality', message: `Multi-instance ${this.describe(activity, undefined)} has an empty loop cardinality; the engines refuse the file`, hint: `\`bpmn set <file> ${activity.id} cardinality=3\` (a number or \${...}).` });
    }
    if (elementVariable !== undefined && collection === undefined && !dataInput) {
      reporter.deploy({ code: 'W_C7_DEPLOY_MULTI_INSTANCE', element: activity, subject: 'mi:elementVariable', message: `Multi-instance ${this.describe(activity, undefined)} has ${this.prefix}:elementVariable but no ${this.prefix}:collection; the engines refuse the file`, hint: `\`bpmn set <file> ${activity.id} ${ShellWords.quote(`loop.${this.prefix}:collection=\${items}`)}\` (or remove it: \`bpmn set <file> ${activity.id} loop.${this.prefix}:elementVariable=\`).` });
    }
  }

  private checkScriptTask(el: BpmnElement, reporter: RuleReporter): void {
    if (this.nonEmpty(el.peek<string>('script')) || this.c7(el, 'resource') !== undefined) {
      return;
    }
    reporter.deploy({ code: 'W_C7_DEPLOY_SCRIPT', element: el, subject: 'script', message: `Script task ${el.id} has neither a script nor ${this.prefix}:resource; the engines refuse the file`, hint: `\`bpmn set <file> ${el.id} scriptFormat=groovy ${ShellWords.quote('script=...')}\` (or ${this.prefix}:resource=deployment://<file>).` });
  }

  private checkUserTaskPriority(el: BpmnElement, reporter: RuleReporter): void {
    const priority = this.c7(el, 'priority');
    if (priority === undefined || this.isNumber(priority) || this.isExpression(priority)) {
      return;
    }
    reporter.runtime({ code: 'W_C7_BAD_VALUE', element: el, subject: 'attr:priority', message: `${this.prefix}:priority="${priority}" on ${this.describe(el, undefined)} is not a number or expression; creating the task fails`, hint: `\`bpmn set <file> ${el.id} ${this.prefix}:priority=50\`.`, fix: { op: 'set', id: el.id, set: { [`${this.prefix}:priority`]: '50' } } });
  }
}
