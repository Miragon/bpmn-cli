import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { ModdlePath } from '../support/ModdlePath.js';
import { Shell } from '../support/Shell.js';
import { Values } from '../support/Values.js';
import { C8FeelRule, type FeelCondition, type ValueSite } from './C8FeelRule.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';
import { C8Host } from './support/C8Host.js';
import { FeelExpression } from './support/feel/FeelExpression.js';
import { ZeebeHint } from './support/ZeebeHint.js';

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
 * A value starting with = that is no valid FEEL: in a zeebe extension element, a condition, a
 * multi-instance completion condition, a timer, or the name of a message or signal the process
 * uses.
 * Camunda 8 parses every FEEL expression at deploy and refuses the file.
 *
 * @example a FEEL condition with Camunda 7 operators
 * <bpmn:conditionExpression>=amount &gt; 1000 &amp;&amp; approved</bpmn:conditionExpression>  <!-- FEEL: and -->
 */
class C8FeelExpressionValidRule extends C8FeelRule {
  protected visit(node: ModdleElement): void {
    if (is(node, 'bpmn:Definitions')) return this.checkMessageAndSignalNames(node);
    if (String(node.$type).startsWith('zeebe:')) return this.checkExtension(node);
    if (!this.runs(node)) return;
    const condition = is(node, 'bpmn:Event') ? undefined : this.conditionOf(node);
    if (condition) this.checkCondition(condition);
    if (is(node, 'bpmn:Activity')) this.checkCompletionCondition(node);
    if (is(node, 'bpmn:Event')) this.checkEvent(node);
  }

  private checkExtension(node: ModdleElement): void {
    const host = C8Host.readHostOf(node);
    if (!host) return;
    this.checkFeelAttributes(node, FEEL_ATTRIBUTES[node.$type] ?? [], host, '');
    if (is(node, 'zeebe:IoMapping')) {
      for (const mapping of [...(node.inputParameters ?? []), ...(node.outputParameters ?? [])]) {
        this.checkFeelAttributes(mapping, ['source'], host, ' (in zeebe:ioMapping)');
      }
    }
  }

  private checkFeelAttributes(element: ModdleElement, attributes: string[], host: ModdleElement, container: string): void {
    const owner = ModdlePath.ownerOf(host);
    const where = `${ZeebeHint.typeName(element)}${container} of ${host.id ? ElementKinds.describe(host) : ElementKinds.describe(host, owner)}`;
    for (const attribute of attributes) {
      this.checkSyntax(`${attribute} of ${where}`, element[attribute], this.siteOf(owner, element, attribute), this.extensionHint(element, attribute, host, container !== ''));
    }
  }

  /** A mapping is added again for its target, an element inside another is rebuilt with its container, a flat one is replaced. */
  private extensionHint(element: ModdleElement, attribute: string, host: ModdleElement, nested: boolean): string {
    const hint = ZeebeHint.of(host);
    if ((is(element, 'zeebe:Input') || is(element, 'zeebe:Output')) && element.target) {
      const args = `${ZeebeHint.typeName(element)} ${Shell.quote(`${attribute}==${FeelExpression.fromJuel(String(element[attribute] ?? '').trim().slice(1)).trim()}`)} target=${Shell.quote(element.target)}`;
      return `${hint ? hint.extAdd(args) : 'edit the XML'} (replaces the mapping of that target; check the FEEL syntax).`;
    }
    if (nested) {
      return hint ? hint.rebuild(ZeebeHint.typeName(element.$parent)) : 'Fix it in the XML.';
    }
    return ZeebeHint.fix(host, element, { [attribute]: '=<FEEL expression>' });
  }

  private checkCondition({ site, what, label, body, invalidHint }: FeelCondition): void {
    if (Values.isFeel(body)) {
      this.checkSyntax(`The ${what} of ${label}`, body, site, invalidHint);
    }
  }

  private checkCompletionCondition(activity: ModdleElement): void {
    const loop = activity.loopCharacteristics;
    if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics') || !loop.completionCondition) {
      return;
    }
    const body: string = loop.completionCondition.body ?? '';
    this.checkSyntax(`The completion condition of multi-instance ${ElementKinds.describe(activity)}`, body, { owner: activity, holder: loop, property: 'completionCondition', path: ['loopCharacteristics', 'completionCondition'] }, `\`bpmn set <file> ${activity.id} ${Shell.quote(`completion==${FeelExpression.fromJuel(body.trim().slice(1))}`)}\` (check the FEEL syntax).`);
  }

  private checkEvent(event: ModdleElement): void {
    const definition = C8EventDefinitions.definitionOf(event);
    if (definition && is(definition, 'bpmn:TimerEventDefinition')) {
      this.checkTimer(event, definition);
    }
    const condition = this.conditionOf(event);
    if (condition) this.checkCondition(condition);
  }

  private checkTimer(event: ModdleElement, definition: ModdleElement): void {
    const kinds = TIMER_KINDS.filter((kind) => definition[kind]);
    const [kind] = kinds;
    if (kinds.length !== 1 || !kind || (kind === 'timeCycle' && is(event, 'bpmn:IntermediateCatchEvent'))) {
      return;
    }
    this.checkSyntax(`The ${kind} of ${ElementKinds.describe(event)}`, definition[kind].body, this.siteOf(event, definition, kind), `\`bpmn set <file> ${event.id} ${Shell.quote('timer==<FEEL expression>')}\` (check the FEEL syntax).`);
  }

  private checkMessageAndSignalNames(definitions: ModdleElement): void {
    for (const used of this.usedMessagesAndSignals(definitions)) {
      const kind = is(used, 'bpmn:Signal') ? 'signal' : 'message';
      if (used.id && Values.hasName(used)) {
        this.checkSyntax(`The name of ${kind} ${used.id}`, used.name, { owner: used, holder: used, property: 'name', path: ['name'] }, `\`bpmn set <file> ${used.id} ${Shell.quote('name==<FEEL expression>')}\` (check the FEEL syntax), or a static name.`);
      }
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
        for (const definition of element.eventDefinitions ?? []) {
          if (is(definition, 'bpmn:SignalEventDefinition') && definition.signalRef) {
            used.add(definition.signalRef);
          }
        }
      }
    }
    return used;
  }

  private checkSyntax(what: string, value: unknown, site: ValueSite, hint: string): void {
    if (!Values.isFeel(value)) return;
    const expression = String(value).trim();
    const problem = new FeelExpression(expression.slice(1)).problem();
    if (problem) {
      this.reportAt(site, `${what} "${expression}" is no valid FEEL: ${problem}; Camunda 8 parses it at deploy and refuses the file`, ERROR_TYPES.FEEL_EXPRESSION_INVALID, hint);
    }
  }
}

export default defineRule({ ruleName: 'c8-feel-expression-valid', code: 'W_C8_DEPLOY_EXPRESSION', impact: 'deploy' }, C8FeelExpressionValidRule);
