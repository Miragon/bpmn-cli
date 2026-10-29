import { is, isAny } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement, type ReportPath } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';

import { SetCommand } from '../support/SetCommand.js';
import { Shell } from '../support/Shell.js';
import { Values } from '../support/Values.js';
import { C7Diagram } from './support/C7Diagram.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';
import { ImplementationHost } from './support/ImplementationHost.js';

const MAX_DAYS = 2147483647;
const DECISION_MAPPERS = ['singleEntry', 'singleResult', 'collectEntries', 'resultList'];
const JOB_PRIORITIZED = ['bpmn:Activity', 'bpmn:Gateway', 'bpmn:Event'];
const VARIABLE_EVENTS = ['create', 'update', 'delete'];
const FORM_BINDINGS = ['deployment', 'latest', 'version'];
const BINDINGS = ['latest', 'deployment', 'version', 'versionTag'];

/** A `camunda:*Binding` that picks the version of the process, case or decision called, with the attributes a binding of `version` or `versionTag` needs. */
interface Binding {
  binding: string;
  version: string;
  versionTag?: string;
  allowed: string[];
}

/**
 * camunda attribute values Camunda 7 cannot interpret: history time to live, priorities, bindings,
 * called elements, form references, multi-instance loops.
 * Camunda 7 refuses to deploy most of them; the rest deploy but fail or resolve the wrong thing
 * when the process runs.
 *
 * - `c7-history-time-to-live`: a history time to live that is no number of days or P<n>D.
 * - `c7-attribute-value`: a job or task priority that is neither an integer nor an expression; an
 *   unknown decision result mapper.
 * - `c7-bad-value`: an unknown called element, case or decision binding; a user task priority that
 *   is neither a number nor an expression; variable events other than create, update and delete.
 * - `c7-binding-version`: a version or versionTag binding without the version or version tag it
 *   binds to, also of a form reference.
 * - `c7-called-element`: a call activity with neither called element nor case reference, or with
 *   both.
 * - `c7-form`: a form reference next to a form key; a form reference without a binding of
 *   deployment, latest or version.
 * - `c7-multi-instance`: a loop with neither cardinality nor collection; an empty cardinality; an
 *   element variable without collection.
 *
 * @example a history time to live in words
 * <bpmn:process id="Order" isExecutable="true" camunda:historyTimeToLive="6 months">  <!-- days: 180 -->
 */
class C7ValuesRule extends C7Rule {
  protected visit(node: ModdleElement): boolean {
    if (is(node, 'bpmn:Process') && node.get('isExecutable') !== true) return false;
    const prefix = C7Diagram.of(node).prefix;
    const attributes = new CamundaAttributes(node);
    if (is(node, 'bpmn:Process')) {
      this.checkHistoryTimeToLive(node, attributes.defined('historyTimeToLive'), prefix);
    }
    this.checkAttributeValues(node, attributes, prefix);
    const bindings = this.bindingsOf(node, attributes);
    for (const { binding, allowed } of bindings.filter((candidate) => this.bindingProblem(attributes, candidate) === 'value')) {
      this.report('c7-bad-value', node, `${prefix}:${binding}="${attributes.defined(binding)}" on ${ElementKinds.describe(node)} is not one of ${allowed.join(', ')}; the engines accept the file but cannot resolve the reference as intended`, { path: [binding], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: binding, hint: `${new SetCommand(node.id).of(`${prefix}:${binding}=latest`)}.` });
    }
    const priority = is(node, 'bpmn:UserTask') ? attributes.defined('priority') : undefined;
    if (priority !== undefined && !Values.isPriority(priority)) {
      this.report('c7-bad-value', node, `${prefix}:priority="${priority}" on ${ElementKinds.describe(node)} is not a number or expression; creating the task fails`, { path: ['priority'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'priority', hint: `${new SetCommand(node.id).of(`${prefix}:priority=50`)}.` });
    }
    if (is(node, 'bpmn:Event')) this.checkVariableEvents(node, prefix);
    for (const binding of bindings) {
      const problem = this.bindingProblem(attributes, binding);
      if (problem === 'version') {
        this.reportBindingVersion(node, binding.binding, 'version', binding.version, '<n>', prefix);
      }
      if (problem === 'versionTag') {
        this.reportBindingVersion(node, binding.binding, 'versionTag', binding.versionTag!, '<tag>', prefix);
      }
    }
    const hasForm = isAny(node, ['bpmn:UserTask', 'bpmn:StartEvent']) && attributes.defined('formRef') !== undefined;
    if (hasForm && attributes.defined('formRefBinding') === 'version' && attributes.defined('formRefVersion') === undefined) {
      this.reportBindingVersion(node, 'formRefBinding', 'version', 'formRefVersion', '<n>', prefix);
    }
    if (is(node, 'bpmn:CallActivity')) {
      this.checkCalledElement(node, attributes.defined('caseRef'), prefix);
    }
    if (hasForm) this.checkForm(node, attributes, prefix);
    if (is(node, 'bpmn:Activity')) this.checkMultiInstance(node, prefix);
    return !is(node, 'bpmn:AdHocSubProcess');
  }

  private checkHistoryTimeToLive(node: ModdleElement, timeToLive: string | undefined, prefix: string): void {
    const days = Values.nonEmpty(timeToLive) ? (/^\+?(\d+)$/.exec(timeToLive) ?? /^P(\d+)D$/.exec(timeToLive)) : undefined;
    if (!Values.nonEmpty(timeToLive) || (days && Number(days[1]) <= MAX_DAYS)) {
      return;
    }
    this.report('c7-history-time-to-live', node, `${prefix}:historyTimeToLive="${timeToLive}" of process ${node.id} is not a number of days (or P<n>D); the engines refuse it`, { path: ['historyTimeToLive'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'historyTimeToLive', hint: `\`bpmn set <file> ${node.id} ${prefix}:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).` });
  }

  /** Job and external task priorities that are no number or expression, and an unknown decision result mapper: the engines refuse the file. */
  private checkAttributeValues(node: ModdleElement, attributes: CamundaAttributes, prefix: string): void {
    const command = new SetCommand(node.id);
    if (is(node, 'bpmn:Process')) {
      for (const name of ['jobPriority', 'taskPriority']) {
        this.checkPriority(node, node, [], command, name, prefix);
      }
    }
    if (isAny(node, JOB_PRIORITIZED) && !is(node, 'bpmn:AdHocSubProcess')) {
      this.checkPriority(node, node, [], command, 'jobPriority', prefix);
      const loop = node.get('loopCharacteristics');
      if (loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
        this.checkPriority(loop, node, ['loopCharacteristics'], new SetCommand(node.id, 'loop.'), 'jobPriority', prefix);
      }
    }
    for (const host of ImplementationHost.forElement(node)) {
      if (host.isExternal) {
        this.checkPriority(host.element, node, host.path, host.command, 'taskPriority', prefix);
      }
    }
    const mapper = is(node, 'bpmn:BusinessRuleTask') && attributes.defined('decisionRef') !== undefined ? attributes.defined('mapDecisionResult') : undefined;
    if (mapper !== undefined && !DECISION_MAPPERS.includes(mapper)) {
      this.report('c7-attribute-value', node, `${prefix}:mapDecisionResult="${mapper}" on ${ElementKinds.describe(node)} is not one of ${DECISION_MAPPERS.join(', ')}; the engines refuse the file`, { path: ['mapDecisionResult'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'mapDecisionResult', hint: `${command.of(`${prefix}:mapDecisionResult=singleEntry`)} (or another of the four).` });
    }
  }

  /** `element` carries the priority; `reported` is the element it sits on, or the element itself. */
  private checkPriority(element: ModdleElement, reported: ModdleElement, path: ReportPath, command: SetCommand, name: string, prefix: string): void {
    const value = new CamundaAttributes(element).defined(name);
    if (value === undefined || Values.isPriority(value)) return;
    this.report('c7-attribute-value', reported, `${prefix}:${name}="${value}" on ${ElementKinds.describe(element, element === reported ? undefined : reported)} is not a number or expression; the engines refuse it`, { path: [...path, name], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: element, property: name, hint: reported.id ? `${command.of(`${prefix}:${name}=50`)} (an integer or \${...}).` : 'Use an integer.' });
  }

  private checkVariableEvents(node: ModdleElement, prefix: string): void {
    for (const { definition, index } of new C7EventDefinitions(node).indexedOfType('bpmn:ConditionalEventDefinition')) {
      const events = new CamundaAttributes(definition).defined('variableEvents');
      const unknown = (events ?? '').split(',').map((eventName) => eventName.trim()).filter((eventName) => eventName && !VARIABLE_EVENTS.includes(eventName));
      if (unknown.length) {
        this.report('c7-bad-value', node, `${prefix}:variableEvents="${events}" of ${ElementKinds.describe(node)} lists ${unknown.join(', ')}; only ${VARIABLE_EVENTS.join(', ')} trigger the condition`, { path: ['eventDefinitions', index, 'variableEvents'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: definition, property: 'variableEvents', hint: `${SetCommand.forDefinition(node, index).of(`${prefix}:variableEvents=create, update`)}.` });
      }
    }
  }

  /** The bindings of `node` the engines read: of a call activity, or of a business rule task with a decision. */
  private bindingsOf(node: ModdleElement, attributes: CamundaAttributes): Binding[] {
    if (is(node, 'bpmn:CallActivity')) {
      return [{ binding: 'calledElementBinding', version: 'calledElementVersion', versionTag: 'calledElementVersionTag', allowed: BINDINGS }, { binding: 'caseBinding', version: 'caseVersion', allowed: ['latest', 'deployment', 'version'] }];
    }
    return is(node, 'bpmn:BusinessRuleTask') && attributes.defined('decisionRef') !== undefined ? [{ binding: 'decisionRefBinding', version: 'decisionRefVersion', versionTag: 'decisionRefVersionTag', allowed: BINDINGS }] : [];
  }

  /** What is wrong with a binding: a version it needs is missing, or the value is unknown. */
  private bindingProblem(attributes: CamundaAttributes, { binding, version, versionTag, allowed }: Binding): 'version' | 'versionTag' | 'value' | undefined {
    const value = attributes.defined(binding);
    if (value === undefined) return undefined;
    if (value === 'version' && attributes.any(version) === undefined) {
      return 'version';
    }
    if (value === 'versionTag' && versionTag && attributes.any(versionTag) === undefined) {
      return 'versionTag';
    }
    return allowed.includes(value) ? undefined : 'value';
  }

  private reportBindingVersion(node: ModdleElement, binding: string, value: string, missing: string, placeholder: string, prefix: string): void {
    const latest = `${prefix}:${binding}=latest`;
    this.report('c7-binding-version', node, `${ElementKinds.describe(node)} has ${prefix}:${binding}="${value}" but no ${prefix}:${missing}; the engines refuse the file`, { path: [missing], type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED, property: binding, dependentRequiredProperty: missing, hint: `\`bpmn set <file> ${node.id} ${prefix}:${missing}=${placeholder}\` (or ${binding === 'formRefBinding' ? latest : `\`${latest}\``}).` });
  }

  private checkCalledElement(node: ModdleElement, caseRef: string | undefined, prefix: string): void {
    const calledElement: string | undefined = node.get('calledElement');
    if (calledElement === undefined && caseRef === undefined) {
      this.report('c7-called-element', node, `Call activity ${node.id} has no calledElement (nor ${prefix}:caseRef); the engines refuse the file`, { path: ['calledElement'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'calledElement', hint: `\`bpmn set <file> ${node.id} calledElement=<processId>\`.` });
    } else if (calledElement !== undefined && caseRef !== undefined) {
      this.report('c7-called-element', node, `Call activity ${node.id} has both calledElement and ${prefix}:caseRef; the engines refuse the file`, { path: ['caseRef'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'caseRef', hint: `Keep one: \`bpmn set <file> ${node.id} ${prefix}:caseRef=\`.` });
    }
  }

  /** A `camunda:formRef` next to a `camunda:formKey`, or without a known `camunda:formRefBinding`. */
  private checkForm(node: ModdleElement, attributes: CamundaAttributes, prefix: string): void {
    if (attributes.defined('formKey') !== undefined) {
      this.report('c7-form', node, `${ElementKinds.describe(node)} has both ${prefix}:formKey and ${prefix}:formRef; the engines refuse the file`, { path: ['formKey'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'formKey', hint: `Keep one: \`bpmn set <file> ${node.id} ${prefix}:formKey=\` (or ${prefix}:formRef=).` });
    }
    const binding = attributes.defined('formRefBinding');
    if (binding !== undefined && FORM_BINDINGS.includes(binding)) return;
    const found = binding === undefined ? `no ${prefix}:formRefBinding` : `${prefix}:formRefBinding="${binding}"`;
    const problem = binding === undefined ? { type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'formRefBinding' } : { type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'formRefBinding' };
    this.report('c7-form', node, `${ElementKinds.describe(node)} has ${prefix}:formRef but ${found} (one of ${FORM_BINDINGS.join(', ')} is required); the engines refuse the file`, { path: ['formRefBinding'], ...problem, hint: `\`bpmn set <file> ${node.id} ${prefix}:formRefBinding=latest\`.` });
  }

  /** A loop needs a cardinality or a collection (a `loopDataInputRef` counts, the engines read it as a variable name, also one that is no id of the file), a non-empty cardinality, and a collection for an element variable. */
  private checkMultiInstance(node: ModdleElement, prefix: string): void {
    const loop = node.get('loopCharacteristics');
    if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
    const loopAttributes = new CamundaAttributes(loop);
    const cardinality = loop.get('loopCardinality');
    const hasCollection = loopAttributes.defined('collection') !== undefined || !!loop.get('loopDataInputRef') || C7Diagram.unresolved(loop).has('loopDataInputRef');
    const label = ElementKinds.describe(node);
    const id = node.id;
    if (!cardinality && !hasCollection) {
      const misplaced = new CamundaAttributes(node).any('collection');
      const elementVariable = new CamundaAttributes(node).any('elementVariable');
      const variable = elementVariable !== undefined ? ` ${prefix}:elementVariable= ${Shell.quote(`loop.${prefix}:elementVariable=${elementVariable}`)}` : '';
      const hint = misplaced !== undefined ? `Move it onto the loop: \`bpmn set <file> ${id} ${prefix}:collection= ${Shell.quote(`loop.${prefix}:collection=${misplaced}`)}${variable}\`.` : `\`bpmn set <file> ${id} ${Shell.quote(`loop.${prefix}:collection=\${items}`)} loop.${prefix}:elementVariable=item\` (or \`bpmn set <file> ${id} cardinality=3\`).`;
      this.report('c7-multi-instance', node, `Multi-instance ${label} has neither a loop cardinality nor ${prefix}:collection${misplaced !== undefined ? ` (${prefix}:collection sits on the activity, not on the loop)` : ''}; the engines refuse the file`, { path: ['loopCharacteristics', 'collection'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: loop, requiredProperty: ['loopCardinality', 'collection'], hint });
      return;
    }
    if (cardinality && !Values.nonEmpty(cardinality.get('body')) && !hasCollection) {
      this.report('c7-multi-instance', node, `Multi-instance ${label} has an empty loop cardinality; the engines refuse the file`, { path: ['loopCharacteristics', 'loopCardinality'], type: ERROR_TYPES.EXPRESSION_REQUIRED, node: loop, property: 'loopCardinality', hint: `\`bpmn set <file> ${id} cardinality=3\` (a number or \${...}).` });
    }
    if (loopAttributes.defined('elementVariable') !== undefined && !hasCollection) {
      this.report('c7-multi-instance', node, `Multi-instance ${label} has ${prefix}:elementVariable but no ${prefix}:collection; the engines refuse the file`, { path: ['loopCharacteristics', 'collection'], type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED, node: loop, property: 'elementVariable', dependentRequiredProperty: 'collection', hint: `\`bpmn set <file> ${id} ${Shell.quote(`loop.${prefix}:collection=\${items}`)}\` (or remove it: \`bpmn set <file> ${id} loop.${prefix}:elementVariable=\`).` });
    }
  }
}

export default defineRule(
  {
    ruleName: 'c7-values',
    kind: 'engine-specific',
    targetEngine: 'c7',
    findings: {
      'c7-history-time-to-live': ['W_C7_DEPLOY_HISTORY_TTL', 'deploy'],
      'c7-attribute-value': ['W_C7_DEPLOY_BAD_VALUE', 'deploy'],
      'c7-bad-value': ['W_C7_BAD_VALUE', 'runtime'],
      'c7-binding-version': ['W_C7_DEPLOY_BINDING_VERSION', 'deploy'],
      'c7-called-element': ['W_C7_DEPLOY_CALLED_ELEMENT', 'deploy'],
      'c7-form': ['W_C7_DEPLOY_FORM', 'deploy'],
      'c7-multi-instance': ['W_C7_DEPLOY_MULTI_INSTANCE', 'deploy'],
    },
  },
  C7ValuesRule,
);
