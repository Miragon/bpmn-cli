import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type ReportPath } from '../CamundaRules.js';
import { ElementKinds } from '../ElementKinds.js';

import { EngineScope } from '../EngineScope.js';
import { ModdlePath } from '../ModdlePath.js';
import { Shell } from '../Shell.js';
import { Values } from '../Values.js';
import { C8EventDefinitions } from './C8EventDefinitions.js';
import { C8Host } from './C8Host.js';
import { FeelExpression } from './feel/FeelExpression.js';
import { ZeebeHint } from './ZeebeHint.js';

const FEEL_ATTRIBUTES: Record<string, string[]> = {
  'zeebe:TaskDefinition': ['type', 'retries'],
  'zeebe:LoopCharacteristics': ['inputCollection', 'outputElement'],
  'zeebe:CalledElement': ['processId'],
  'zeebe:CalledDecision': ['decisionId'],
  'zeebe:Script': ['expression'],
  'zeebe:Subscription': ['correlationKey'],
  'zeebe:AssignmentDefinition': ['assignee', 'candidateGroups', 'candidateUsers'],
  'zeebe:TaskSchedule': ['dueDate', 'followUpDate'],
  'zeebe:PriorityDefinition': ['priority'],
  'zeebe:AdHoc': ['activeElementsCollection', 'outputElement'],
};
const TIMER_KINDS = ['timeDate', 'timeDuration', 'timeCycle'];

/**
 * Where a value sits: the element reported on, the element holding the property, and the path;
 * `related` is another element the finding names (the message of a correlation key).
 */
interface ValueSite {
  owner: ModdleElement;
  holder: ModdleElement;
  property: string;
  path: ReportPath;
  related?: ModdleElement;
}

/**
 * Reports values Camunda 8 parses as FEEL at deploy and refuses: a `=` value that is no valid FEEL
 * (JUEL habits named), and a static or JUEL value where Camunda 8 needs a FEEL expression.
 */
class C8FeelExpression extends C8Rule {
  protected visit(node: ModdleElement): void {
    if (is(node, 'bpmn:Definitions')) return this.checkMessageAndSignalNames(node);
    if (String(node.$type).startsWith('zeebe:')) return this.checkExtension(node);
    if (!EngineScope.C8.runs(node) || is(node, 'bpmn:Transaction')) return;
    if (is(node, 'bpmn:SequenceFlow')) this.checkCondition(node, node.conditionExpression, `sequence flow ${node.id}`);
    if (is(node, 'bpmn:AdHocSubProcess')) this.checkCondition(node, node.completionCondition, `ad-hoc sub-process ${node.id}`);
    if (is(node, 'bpmn:Activity')) this.checkMultiInstance(node);
    if (is(node, 'bpmn:ScriptTask')) this.checkScript(node);
    if (is(node, 'bpmn:ReceiveTask')) this.checkCorrelationKey(node);
    if (is(node, 'bpmn:Event')) this.checkEvent(node);
  }

  private checkExtension(node: ModdleElement): void {
    const host = C8Host.readHostOf(node);
    if (!host) return;
    this.checkFeelAttributes(node, FEEL_ATTRIBUTES[node.$type] ?? [], host, '');
    if (is(node, 'zeebe:IoMapping')) for (const mapping of [...(node.inputParameters ?? []), ...(node.outputParameters ?? [])]) this.checkFeelAttributes(mapping, ['source'], host, ' (in zeebe:ioMapping)');
  }

  private checkFeelAttributes(element: ModdleElement, attributes: string[], host: ModdleElement, container: string): void {
    const owner = ModdlePath.ownerOf(host);
    const where = `${ZeebeHint.typeName(element)}${container} of ${host.id ? ElementKinds.describe(host) : ElementKinds.describe(host, owner)}`;
    for (const attribute of attributes) this.checkSyntax(`${attribute} of ${where}`, element[attribute], this.siteOf(owner, element, attribute), this.extensionHint(element, attribute, host, container !== ''));
  }

  /** A mapping is added again for its target, an element inside another is rebuilt with its container, a flat one is replaced. */
  private extensionHint(element: ModdleElement, attribute: string, host: ModdleElement, nested: boolean): string {
    const hint = ZeebeHint.of(host);
    if ((is(element, 'zeebe:Input') || is(element, 'zeebe:Output')) && element.target) {
      const args = `${ZeebeHint.typeName(element)} ${Shell.quote(`${attribute}==${FeelExpression.fromJuel(String(element[attribute] ?? '').trim().slice(1)).trim()}`)} target=${Shell.quote(element.target)}`;
      return `${hint ? hint.extAdd(args) : 'edit the XML'} (replaces the mapping of that target; check the FEEL syntax).`;
    }
    if (nested) return hint ? hint.rebuild(ZeebeHint.typeName(element.$parent)) : 'Fix it in the XML.';
    return ZeebeHint.fix(host, element, { [attribute]: '=<FEEL expression>' });
  }

  private checkCondition(node: ModdleElement, condition: ModdleElement | undefined, label: string): void {
    if (!condition) return;
    const flow = is(node, 'bpmn:SequenceFlow');
    const property = flow ? 'conditionExpression' : 'completionCondition';
    const site = { owner: node, holder: node, property, path: [property] };
    const what = flow ? 'condition' : 'completion condition';
    const body: string = condition.body ?? '';
    const hints = flow ? this.flowConditionHints(node.id, body) : this.completionHints(node.id, body);
    if (Values.isFeel(body)) this.checkSyntax(`The ${what} of ${label}`, body, site, hints.invalid);
    else this.reportAt(site, `The ${what} "${body.trim()}" of ${label} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, hints.notFeel);
  }

  private flowConditionHints(id: string, body: string): { invalid: string; notFeel: string } {
    return {
      invalid: `\`bpmn set <file> ${id} ${Shell.quote(`condition==${FeelExpression.fromJuel(body.trim().slice(1))}`)}\` (check the FEEL syntax: and / or, = for equality, not(...)).`,
      notFeel: body.trim() ? `\`bpmn set <file> ${id} ${Shell.quote(`condition==${FeelExpression.fromJuel(body)}`)}\` (check the FEEL syntax: and / or, = for equality).` : `Give it one (\`bpmn set <file> ${id} ${Shell.quote('condition== <expression>')}\`) or remove it (\`bpmn set <file> ${id} condition=\`).`,
    };
  }

  private completionHints(id: string, body: string): { invalid: string; notFeel: string } {
    const fix = `\`bpmn set <file> ${id} ${Shell.quote(`completion==${FeelExpression.fromJuel(Values.isFeel(body) ? body.trim().slice(1) : body)}`)}\` (check the FEEL syntax)`;
    return { invalid: `${fix}.`, notFeel: `${fix}, or remove it: \`bpmn set <file> ${id} completion=\`.` };
  }

  private checkMultiInstance(activity: ModdleElement): void {
    const loop = activity.loopCharacteristics;
    if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
    const label = `multi-instance ${ElementKinds.describe(activity)}`;
    const [zeebeLoop] = C8Host.valuesOf(loop, 'zeebe:LoopCharacteristics');
    if (zeebeLoop && !Values.isBlank(zeebeLoop.inputCollection) && !Values.isFeel(zeebeLoop.inputCollection)) this.reportStatic(activity, zeebeLoop, 'inputCollection', label);
    if (zeebeLoop && zeebeLoop.outputCollection !== undefined && zeebeLoop.outputElement !== undefined && !Values.isFeel(zeebeLoop.outputElement)) this.reportStatic(activity, zeebeLoop, 'outputElement', label);
    if (!loop.completionCondition) return;
    const body: string = loop.completionCondition.body ?? '';
    this.checkSyntax(`The completion condition of ${label}`, body, { owner: activity, holder: loop, property: 'completionCondition', path: ['loopCharacteristics', 'completionCondition'] }, `\`bpmn set <file> ${activity.id} ${Shell.quote(`completion==${FeelExpression.fromJuel(body.trim().slice(1))}`)}\` (check the FEEL syntax).`);
  }

  private reportStatic(activity: ModdleElement, zeebeLoop: ModdleElement, property: string, label: string): void {
    const value: string = zeebeLoop[property];
    this.reportAt(this.siteOf(activity, zeebeLoop, property), `${property}="${value}" of ${label} is a static value; Camunda 8 needs a FEEL expression (=${value.trim()}) and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, ZeebeHint.fix(activity.loopCharacteristics, zeebeLoop, { [property]: `=${value.trim()}` }));
  }

  private checkScript(task: ModdleElement): void {
    const [script] = C8Host.valuesOf(task, 'zeebe:Script');
    const expression = script?.expression;
    if (!script || C8Host.valuesOf(task, 'zeebe:TaskDefinition').length || Values.isBlank(expression) || Values.isFeel(expression)) return;
    this.reportAt(this.siteOf(task, script, 'expression'), `The zeebe:script expression "${expression}" of ${ElementKinds.describe(task)} is a static value; Camunda 8 needs a FEEL expression starting with = and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, ZeebeHint.fix(task, script, { expression: `=${expression.trim()}` }));
  }

  private checkEvent(event: ModdleElement): void {
    const definition = C8EventDefinitions.definitionOf(event);
    if (!definition) return;
    if (is(definition, 'bpmn:TimerEventDefinition')) this.checkTimer(event, definition);
    else if (is(definition, 'bpmn:ConditionalEventDefinition')) this.checkConditionalEvent(event, definition);
    else if (is(definition, 'bpmn:MessageEventDefinition') && is(event, 'bpmn:CatchEvent')) this.checkCorrelationKey(event);
  }

  private checkTimer(event: ModdleElement, definition: ModdleElement): void {
    const kinds = TIMER_KINDS.filter((kind) => definition[kind]);
    const [kind] = kinds;
    if (kinds.length !== 1 || !kind || (kind === 'timeCycle' && is(event, 'bpmn:IntermediateCatchEvent'))) return;
    this.checkSyntax(`The ${kind} of ${ElementKinds.describe(event)}`, definition[kind].body, this.siteOf(event, definition, kind), `\`bpmn set <file> ${event.id} ${Shell.quote('timer==<FEEL expression>')}\` (check the FEEL syntax).`);
  }

  private checkConditionalEvent(event: ModdleElement, definition: ModdleElement): void {
    const condition = definition.condition;
    if (!condition) return;
    const site = this.siteOf(event, definition, 'condition');
    const body: string = condition.body ?? '';
    const fix = (expression: string) => `\`bpmn set <file> ${event.id} ${Shell.quote(`when==${FeelExpression.fromJuel(expression)}`)}\` (check the FEEL syntax).`;
    if (Values.isFeel(body)) this.checkSyntax(`The condition of conditional event ${event.id}`, body, site, fix(body.trim().slice(1)));
    else this.reportAt(site, `The condition "${body.trim()}" of conditional event ${event.id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, fix(body));
  }

  private checkCorrelationKey(el: ModdleElement): void {
    const holder = C8EventDefinitions.messageHolderOf(el);
    const message = holder?.messageRef;
    if (!message || !Values.hasName(message) || (is(el, 'bpmn:StartEvent') && is(el.$parent, 'bpmn:Process'))) return;
    const subscriptions = C8Host.valuesOf(message, 'zeebe:Subscription');
    const [subscription] = subscriptions;
    const key = subscription?.correlationKey;
    if (subscriptions.length !== 1 || Values.isBlank(key) || Values.isFeel(key)) return;
    const site = { owner: el, holder: subscription, property: 'correlationKey', path: [...ModdlePath.between(el, holder), 'messageRef', ...ModdlePath.between(message, subscription), 'correlationKey'], related: message };
    this.reportAt(site, `The correlationKey "${key}" of message ${message.id} is a static value; Camunda 8 needs a FEEL expression (=${key.trim()}) and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, ZeebeHint.fix(message, subscription, { correlationKey: `=${key.trim()}` }));
  }

  private checkMessageAndSignalNames(definitions: ModdleElement): void {
    for (const used of this.usedMessagesAndSignals(definitions)) {
      const kind = is(used, 'bpmn:Signal') ? 'signal' : 'message';
      if (used.id && Values.hasName(used)) this.checkSyntax(`The name of ${kind} ${used.id}`, used.name, { owner: used, holder: used, property: 'name', path: ['name'] }, `\`bpmn set <file> ${used.id} ${Shell.quote('name==<FEEL expression>')}\` (check the FEEL syntax), or a static name.`);
    }
  }

  private usedMessagesAndSignals(definitions: ModdleElement): Set<ModdleElement> {
    const used = new Set<ModdleElement>();
    const pending: ModdleElement[] = (definitions.rootElements ?? []).filter((root: ModdleElement) => is(root, 'bpmn:Process'));
    while (pending.length) {
      for (const element of pending.pop().flowElements ?? []) {
        if (element.flowElements) pending.push(element);
        if (!is(element, 'bpmn:FlowNode')) continue;
        const message = C8EventDefinitions.messageOf(element);
        if (message) used.add(message);
        for (const definition of element.eventDefinitions ?? []) if (is(definition, 'bpmn:SignalEventDefinition') && definition.signalRef) used.add(definition.signalRef);
      }
    }
    return used;
  }

  private checkSyntax(what: string, value: unknown, site: ValueSite, hint: string): void {
    if (!Values.isFeel(value)) return;
    const expression = String(value).trim();
    const problem = new FeelExpression(expression.slice(1)).problem();
    if (problem) this.reportAt(site, `${what} "${expression}" is no valid FEEL: ${problem}; Camunda 8 parses it at deploy and refuses the file`, ERROR_TYPES.FEEL_EXPRESSION_INVALID, hint);
  }

  private reportAt({ owner, holder, property, path, related }: ValueSite, message: string, type: string, hint: string): void {
    this.report('c8-feel-expression', owner, message, { path, type, node: holder, property, ...(related ? { related } : {}), hint });
  }

  private siteOf(owner: ModdleElement, holder: ModdleElement, property: string): ValueSite {
    return { owner, holder, property, path: [...ModdlePath.between(owner, holder), property] };
  }
}

export default defineRule(
  { ruleName: 'c8-feel-expression', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-feel-expression': ['W_C8_DEPLOY_EXPRESSION', 'deploy'] } },
  C8FeelExpression,
);
