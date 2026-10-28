import { is, isAny } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRules.js';
import { ElementKinds } from '../ElementKinds.js';

import { EngineScope } from '../EngineScope.js';
import { FirstOfKey } from '../FirstOfKey.js';
import { Shell } from '../Shell.js';
import { C7Diagram } from './C7Diagram.js';
import { C7EventDefinitions } from './C7EventDefinitions.js';
import { C7ExtraStartHint } from './C7ExtraStartHint.js';
import { C7FlowGraph } from './C7FlowGraph.js';

const WAITING_TRIGGERS = ['message', 'timer', 'signal', 'conditional'];
const REFERENCE_BY_TRIGGER: Record<string, string> = { message: 'messageRef', signal: 'signalRef' };

/**
 * Reports the flow Camunda 7 refuses or runs other than modeled, in what the engines run (not the
 * content of an ad-hoc sub-process): exclusive gateways without a usable default or with
 * conditions where none count, event-based gateways with other targets than catch events or
 * branches waiting for one name, connected complex gateways and ad-hoc sub-processes, empty
 * conditions, missing or extra start events, and transactions without a start event.
 */
class C7Flows extends C7Rule {
  protected visit(node: ModdleElement): boolean {
    if (is(node, 'bpmn:Process') && node.isExecutable !== true) return false;
    if (is(node, 'bpmn:EventBasedGateway')) this.checkEventGateway(node);
    if (is(node, 'bpmn:ExclusiveGateway')) this.checkExclusiveGateway(node, C7FlowGraph.forElement(node).outgoing(node));
    if (is(node, 'bpmn:ComplexGateway')) this.checkComplexGateway(node);
    if (is(node, 'bpmn:AdHocSubProcess')) this.checkAdHocSubProcess(node);
    if (is(node, 'bpmn:SequenceFlow')) this.checkEmptyFlowCondition(node);
    else if (is(node, 'bpmn:Event')) this.checkEmptyEventCondition(node);
    if (isAny(node, ['bpmn:Process', 'bpmn:SubProcess']) && !is(node, 'bpmn:AdHocSubProcess')) this.checkStartEvents(node);
    return !is(node, 'bpmn:AdHocSubProcess');
  }

  private checkExclusiveGateway(node: ModdleElement, outgoing: ModdleElement[]): void {
    if (!outgoing.length) return this.report('c7-exclusive-gateway', node, `Exclusive gateway ${node.id} has no outgoing flow; the engines refuse the file`, { path: ['outgoing'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'outgoing', hint: `Continue it: \`bpmn add <file> <kind> "<Name>" --after ${node.id}\`.` });
    const defaultFlow = node.default;
    if (outgoing.length === 1) {
      const [flow] = outgoing;
      if (flow.conditionExpression) this.reportCondition(node, flow, flow === defaultFlow ? `Default flow ${flow.id} of exclusive gateway ${node.id} has a condition; the engines refuse the file` : `Exclusive gateway ${node.id} has a single outgoing flow ${flow.id} with a condition; the engines refuse the file`);
      return;
    }
    if (defaultFlow?.conditionExpression && outgoing.includes(defaultFlow)) this.reportCondition(node, defaultFlow, `Default flow ${defaultFlow.id} of exclusive gateway ${node.id} has a condition; the engines refuse the file`);
    const unconditioned = outgoing.filter((flow) => flow !== defaultFlow && !flow.conditionExpression);
    if (!defaultFlow && unconditioned.length === 1) {
      const [flow] = unconditioned;
      this.report('c7-implicit-default-flow', node, `Flow ${flow.id} of exclusive gateway ${node.id} has no condition and is not the default flow; the engines take it as the default and log a warning`, { path: ['default'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'default', sequenceFlow: flow, hint: `\`bpmn set <file> ${flow.id} default=true\`.` });
    }
    if (!defaultFlow && unconditioned.length < 2) return;
    for (const flow of unconditioned) {
      const asDefault = defaultFlow ? '' : ` or make one of them the default: \`bpmn set <file> ${flow.id} default=true\``;
      this.report('c7-exclusive-gateway', node, `Flow ${flow.id} of exclusive gateway ${node.id} has no condition and is not the default flow${defaultFlow ? '' : ` (${unconditioned.length} such flows)`}; the engines refuse the file`, { path: null, type: ERROR_TYPES.PROPERTY_REQUIRED, node: flow, requiredProperty: 'conditionExpression', hint: `\`bpmn set <file> ${flow.id} ${Shell.quote('condition=${...}')}\`${asDefault}.` });
    }
  }

  /** The condition of `flow` goes: the path is null, as the flow is no property of the gateway. */
  private reportCondition(node: ModdleElement, flow: ModdleElement, message: string): void {
    this.report('c7-exclusive-gateway', node, message, { path: null, type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: flow, property: 'conditionExpression', hint: `\`bpmn set <file> ${flow.id} condition=\`.` });
  }

  /** A branch the engines refuse, or two waiting for one message or signal name; the finding is on a branch, no property of the gateway: the path is null. */
  private checkEventGateway(node: ModdleElement): void {
    const graph = C7FlowGraph.forElement(node);
    const firsts = new FirstOfKey<ModdleElement>();
    for (const flow of graph.outgoing(node)) {
      const target = flow.targetRef;
      if (!target) continue;
      const leadsTo = `Event-based gateway ${node.id} leads to ${ElementKinds.describe(target)}`;
      if (!is(target, 'bpmn:IntermediateCatchEvent')) {
        this.report('c7-event-gateway', node, `${leadsTo}; the engines accept only intermediate catch events (message, timer, signal, conditional) there and refuse the file`, { path: null, type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED, node: target, sequenceFlow: flow, hint: `Put a catch event in front of it: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${flow.id} --message <MessageName>\` (or :timer --timer PT1H).` });
        continue;
      }
      const definitions = new C7EventDefinitions(target).actedOn();
      const [definition] = definitions;
      if (definitions.length !== 1 || !WAITING_TRIGGERS.includes(ElementKinds.trigger(definition))) {
        this.report('c7-event-gateway', node, `${leadsTo}; after an event-based gateway the engines accept only message, timer, signal and conditional catch events and refuse the file`, { path: null, type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED, node: target, sequenceFlow: flow, hint: `\`bpmn set <file> ${target.id} trigger=message message=<MessageName>\` (or trigger=timer timer=PT1H).` });
        continue;
      }
      if (graph.incoming(target).length > 1) this.report('c7-event-gateway', node, `${ElementKinds.describe(target)} after event-based gateway ${node.id} has other incoming flows; the engines refuse the file`, { path: null, type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: target, sequenceFlow: flow, property: 'incoming', hint: `Join before the gateway instead, and keep only ${flow.id} into ${target.id} (\`bpmn set <file> <otherFlowId> target=<nodeId>\`).` });
      const trigger = ElementKinds.trigger(definition);
      const referenceProperty = REFERENCE_BY_TRIGGER[trigger];
      const name = referenceProperty ? definition.get(referenceProperty)?.name : undefined;
      const first = referenceProperty && name ? firsts.repeats(`${trigger}\u0000${name}`, target) : undefined;
      if (first) this.report('c7-event-gateway', node, `Branches ${first.id} and ${target.id} of event-based gateway ${node.id} wait for the same ${trigger} "${name}"; the engines refuse the file`, { path: null, type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, first, node: target, duplicatedProperty: referenceProperty, duplicatedPropertyValue: name, hint: `\`bpmn set <file> ${target.id} ${trigger}=<OtherName>\`, or remove one branch.` });
    }
  }

  /** The engines do not run complex gateways: one a sequence flow connects is refused, one nothing connects deploys. */
  private checkComplexGateway(node: ModdleElement): void {
    const graph = C7FlowGraph.forElement(node);
    const incoming = graph.incoming(node);
    const flows = [...incoming, ...graph.outgoing(node)];
    if (flows.length) this.report('c7-complex-gateway', node, `Complex gateway ${node.id} is connected; the engines do not run complex gateways and refuse the file (invalid ${incoming.length ? 'destination' : 'source'} '${node.id}' of sequence flow ${flows[0].id})`, { path: null, type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED, flows, hint: `\`bpmn retype <file> ${node.id} inclusiveGateway\` (or exclusiveGateway: one path).` });
  }

  /** The engines do not run ad-hoc sub-processes: one with a sequence flow, a boundary event or a multi-instance loop is refused (Operaton deploys one with a valid loop). */
  private checkAdHocSubProcess(node: ModdleElement): void {
    const graph = C7FlowGraph.forElement(node);
    const incoming = graph.incoming(node);
    const flows = [...incoming, ...graph.outgoing(node)];
    const boundaryEvents = graph.boundaryEvents(node);
    const retype = `Make it an embedded sub-process: \`bpmn retype <file> ${node.id} subProcess\`, then give its content a start event and flows (\`bpmn add <file> startEvent "<Name>" --in ${node.id}\`, \`bpmn connect <file> <fromId> <toId>\`)`;
    if (flows.length || boundaryEvents.length) {
      const parts = [this.listed('sequence flow', flows), this.listed('boundary event', boundaryEvents)].filter(Boolean);
      const refusal = flows.length ? `invalid ${incoming.length ? 'destination' : 'source'} '${node.id}' of sequence flow ${flows[0].id}` : 'invalid reference in boundary event';
      this.report('c7-ad-hoc-sub-process', node, `Ad-hoc sub-process ${node.id} is connected (${parts.join(' and ')}); the engines do not run ad-hoc sub-processes and refuse the file (${refusal})`, { path: null, type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED, flows, boundaryEvents, hint: `${retype}.` });
    } else if (node.loopCharacteristics && is(node.loopCharacteristics, 'bpmn:MultiInstanceLoopCharacteristics') && !C7Diagram.of(node).operaton) {
      this.report('c7-ad-hoc-sub-process', node, `Ad-hoc sub-process ${node.id} has a multi-instance loop; the engines do not run ad-hoc sub-processes, and Camunda 7 and CIB seven refuse the file (ENGINE-01009, "activity" is null)`, { path: ['loopCharacteristics'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'loopCharacteristics', hint: `${retype}, or drop the loop: \`bpmn set <file> ${node.id} loop=none\`.` });
    }
  }

  /** `sequence flows F1, F2`, or '' for none. */
  private listed(kind: string, elements: ModdleElement[]): string {
    return elements.length ? `${kind}${elements.length > 1 ? 's' : ''} ${elements.map((element) => element.id).join(', ')}` : '';
  }

  /** A condition without expression or script on a flow the engines evaluate (not a default flow, not out of a parallel or event-based gateway) deploys and fails when evaluated. */
  private checkEmptyFlowCondition(flow: ModdleElement): void {
    const condition = flow.conditionExpression;
    const source = flow.sourceRef;
    if (!condition || !this.isEmpty(condition) || (source && (isAny(source, ['bpmn:ParallelGateway', 'bpmn:EventBasedGateway']) || source.default === flow))) return;
    this.report('c7-empty-condition', flow, `Sequence flow ${flow.id} has an empty condition (no expression and no ${C7Diagram.of(flow).prefix}:resource): it deploys, but the engines fail when they evaluate it`, { path: ['conditionExpression'], type: ERROR_TYPES.EXPRESSION_REQUIRED, node: condition, property: 'conditionExpression', hint: `Give it one: \`bpmn set <file> ${flow.id} ${Shell.quote('condition=${expression}')}\`, or remove it: \`bpmn set <file> ${flow.id} condition=\`.` });
  }

  private checkEmptyEventCondition(event: ModdleElement): void {
    const definitions = new C7EventDefinitions(event);
    const prefix = C7Diagram.of(event).prefix;
    for (const definition of definitions.actedOn()) {
      const condition = is(definition, 'bpmn:ConditionalEventDefinition') ? definition.condition : undefined;
      if (condition && this.isEmpty(condition)) this.report('c7-empty-condition', event, `Conditional event ${event.id} has an empty condition (no expression and no ${prefix}:resource): it deploys, but evaluating it fails when the process runs`, { path: ['eventDefinitions', definitions.all().indexOf(definition), 'condition'], type: ERROR_TYPES.EXPRESSION_REQUIRED, node: condition, property: 'condition', hint: `\`bpmn set <file> ${event.id} ${Shell.quote('when=${expression}')}\` (or a script: \`bpmn set <file> ${event.id} condition.${prefix}:resource=deployment://<script>.groovy condition.language=groovy\`).` });
    }
  }

  private isEmpty(expression: ModdleElement): boolean {
    return ![expression.body, expression.get('camunda:resource')].some((text) => typeof text === 'string' && text.trim() !== '');
  }

  /**
   * A process or sub-process without a start event (an empty one too) is refused, a transaction
   * fails when reached; a second none or timer start event of a process, a second start event of a
   * sub-process is refused. An event sub-process without one is left to other rules.
   */
  private checkStartEvents(scope: ModdleElement): void {
    const nodes: ModdleElement[] = (scope.flowElements ?? []).filter((element: ModdleElement) => is(element, 'bpmn:FlowNode'));
    const starts = nodes.filter((element) => is(element, 'bpmn:StartEvent'));
    const isProcess = is(scope, 'bpmn:Process');
    const what = nodes.length ? 'has no start event' : 'is empty, without a start event';
    const missing = { path: ['flowElements'], type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED, requiredType: 'bpmn:StartEvent', hint: this.missingStartHint(scope.id, nodes.length > 0, !isProcess) };
    if (!starts.length && is(scope, 'bpmn:Transaction')) this.report('c7-transaction-start', scope, `Transaction ${scope.id} ${what}: it deploys, but every instance that reaches it fails ("No initial activity found for subprocess ${scope.id}")`, missing);
    else if (!starts.length && !EngineScope.isEventSubProcess(scope)) this.report('c7-start-event', scope, `${isProcess ? 'Process' : 'Sub-process'} ${scope.id} ${what}; the engines refuse the file (${isProcess ? 'process' : 'subProcess'} must define a startEvent element)`, missing);
    const limited = isProcess ? starts.filter((start) => new C7EventDefinitions(start).actedOn().every((definition) => is(definition, 'bpmn:TimerEventDefinition'))) : starts;
    const [first, ...rest] = limited;
    const kind = is(scope, 'bpmn:Transaction') ? 'Transaction' : 'Sub-process';
    for (const extra of rest) {
      const message = isProcess ? `Start event ${extra.id} is a second none or timer start event of process ${scope.id} (with ${first.id}); the engines allow only one and refuse the file` : `${EngineScope.isEventSubProcess(scope) ? 'Event sub-process' : kind} ${scope.id} has ${limited.length} start events (${limited.map((start) => start.id).join(', ')}); the engines allow only one in a sub-process and refuse the file`;
      this.report('c7-start-event', extra, message, { path: null, type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, first, hint: new C7ExtraStartHint(scope, first, extra).text() });
    }
  }

  /** Add a start event before the first node (or into an empty scope); a sub-process may go instead. */
  private missingStartHint(scopeId: string, hasNodes: boolean, removable: boolean): string {
    const add = hasNodes ? `Add one: \`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${scopeId}, then connect it)` : `Add content: \`bpmn add <file> startEvent "<Name>" --in ${scopeId}\` and continue from it`;
    return `${add}${removable ? `, or remove it: \`bpmn remove <file> ${scopeId}\`` : ''}.`;
  }
}

export default defineRule(
  {
    ruleName: 'c7-flows',
    kind: 'engine-specific',
    targetEngine: 'c7',
    findings: {
      'c7-event-gateway': ['W_C7_DEPLOY_EVENT_GATEWAY', 'deploy'],
      'c7-exclusive-gateway': ['W_C7_DEPLOY_EXCLUSIVE_GATEWAY', 'deploy'],
      'c7-implicit-default-flow': ['W_C7_EXCLUSIVE_GATEWAY_DEFAULT', 'practice'],
      'c7-complex-gateway': ['W_C7_DEPLOY_COMPLEX_GATEWAY', 'deploy'],
      'c7-ad-hoc-sub-process': ['W_C7_DEPLOY_AD_HOC_SUBPROCESS', 'deploy'],
      'c7-empty-condition': ['W_C7_EMPTY_CONDITION', 'runtime'],
      'c7-start-event': ['W_C7_DEPLOY_START_EVENT', 'deploy'],
      'c7-transaction-start': ['W_C7_TRANSACTION_NO_START', 'runtime'],
    },
  },
  C7Flows,
);
