import type { BpmnElement } from '../document/BpmnElement.js';
import { Triggers, type Trigger } from './Triggers.js';

export type Family = 'task' | 'subProcess' | 'callActivity' | 'gateway' | 'event' | 'participant' | 'lane' | 'data' | 'artifact';

export interface KindDefinition {
  kind: string;
  type: string;
  family: Family;
  aliases: string[];
  triggers?: Trigger[];
  props?: Record<string, unknown>;
  branchesByCondition?: true;
  synchronises?: true;
  namedAsQuestion?: true;
  description: string;
}

export class Kinds {
  static readonly FLOW_NODE_FAMILIES: ReadonlySet<Family> = new Set<Family>(['task', 'subProcess', 'callActivity', 'gateway', 'event']);

  static readonly ALL: readonly KindDefinition[] = [
    { kind: 'task', type: 'bpmn:Task', family: 'task', aliases: [], description: 'Generic task' },
    { kind: 'userTask', type: 'bpmn:UserTask', family: 'task', aliases: ['user'], description: 'Task performed by a human' },
    { kind: 'serviceTask', type: 'bpmn:ServiceTask', family: 'task', aliases: ['service'], description: 'Automated task (worker / connector)' },
    { kind: 'scriptTask', type: 'bpmn:ScriptTask', family: 'task', aliases: ['script'], description: 'Task executing a script' },
    { kind: 'sendTask', type: 'bpmn:SendTask', family: 'task', aliases: ['send'], description: 'Task sending a message' },
    { kind: 'receiveTask', type: 'bpmn:ReceiveTask', family: 'task', aliases: ['receive'], description: 'Task waiting for a message' },
    { kind: 'manualTask', type: 'bpmn:ManualTask', family: 'task', aliases: ['manual'], description: 'Task done outside the engine' },
    { kind: 'businessRuleTask', type: 'bpmn:BusinessRuleTask', family: 'task', aliases: ['rule', 'businessRule', 'decision'], description: 'Task evaluating a decision / rule' },
    { kind: 'subProcess', type: 'bpmn:SubProcess', family: 'subProcess', aliases: ['sub'], description: 'Embedded sub-process (expanded by default, set expanded=false to collapse)' },
    { kind: 'eventSubProcess', type: 'bpmn:SubProcess', family: 'subProcess', aliases: ['eventSub'], props: { triggeredByEvent: true }, description: 'Event sub-process (triggeredByEvent=true); create it as eventSubProcess:<trigger> (message|timer|signal|conditional|error|escalation|compensate) to get its start event in the same command' },
    { kind: 'adHocSubProcess', type: 'bpmn:AdHocSubProcess', family: 'subProcess', aliases: ['adhoc'], description: 'Ad-hoc sub-process' },
    { kind: 'transaction', type: 'bpmn:Transaction', family: 'subProcess', aliases: [], description: 'Transaction sub-process' },
    { kind: 'callActivity', type: 'bpmn:CallActivity', family: 'callActivity', aliases: ['call'], description: 'Calls another process (set calledElement=<processId>)' },
    { kind: 'exclusiveGateway', type: 'bpmn:ExclusiveGateway', family: 'gateway', aliases: ['xor', 'exclusive'], branchesByCondition: true, namedAsQuestion: true, description: 'XOR: exactly one outgoing path (name it as a question, name the branches)' },
    { kind: 'parallelGateway', type: 'bpmn:ParallelGateway', family: 'gateway', aliases: ['and', 'parallel'], synchronises: true, description: 'AND: all outgoing paths' },
    { kind: 'inclusiveGateway', type: 'bpmn:InclusiveGateway', family: 'gateway', aliases: ['or', 'inclusive'], branchesByCondition: true, synchronises: true, namedAsQuestion: true, description: 'OR: one or more outgoing paths' },
    { kind: 'complexGateway', type: 'bpmn:ComplexGateway', family: 'gateway', aliases: ['complex'], branchesByCondition: true, synchronises: true, description: 'Complex: a custom split / join rule (no Camunda 7 / 8 engine runs it)' },
    { kind: 'eventBasedGateway', type: 'bpmn:EventBasedGateway', family: 'gateway', aliases: ['eventBased', 'event-based', 'eventGateway'], description: 'Waits for the first of several catching events' },
    { kind: 'startEvent', type: 'bpmn:StartEvent', family: 'event', aliases: ['start'], triggers: ['none', 'message', 'timer', 'signal', 'conditional', 'error', 'escalation', 'compensate'], description: 'Start event (error/escalation/compensate only inside an eventSubProcess)' },
    { kind: 'endEvent', type: 'bpmn:EndEvent', family: 'event', aliases: ['end'], triggers: ['none', 'message', 'error', 'signal', 'escalation', 'terminate', 'compensate', 'cancel'], description: 'End event' },
    { kind: 'intermediateCatchEvent', type: 'bpmn:IntermediateCatchEvent', family: 'event', aliases: ['catch', 'icatch', 'catchEvent'], triggers: ['message', 'timer', 'signal', 'conditional', 'link'], description: 'Intermediate catching event (waits)' },
    { kind: 'intermediateThrowEvent', type: 'bpmn:IntermediateThrowEvent', family: 'event', aliases: ['throw', 'ithrow', 'throwEvent'], triggers: ['none', 'message', 'signal', 'escalation', 'link', 'compensate'], description: 'Intermediate throwing event' },
    { kind: 'boundaryEvent', type: 'bpmn:BoundaryEvent', family: 'event', aliases: ['boundary'], triggers: ['message', 'timer', 'error', 'signal', 'escalation', 'conditional', 'compensate', 'cancel'], description: 'Boundary event attached to an activity (--on <activityId>)' },
    { kind: 'participant', type: 'bpmn:Participant', family: 'participant', aliases: ['pool'], description: 'Pool; the first one wraps the existing process, further ones get a new process (--black-box for none)' },
    { kind: 'lane', type: 'bpmn:Lane', family: 'lane', aliases: [], description: 'Lane inside a process (--in <processId>)' },
    { kind: 'dataObject', type: 'bpmn:DataObjectReference', family: 'data', aliases: ['data', 'dataObjectReference'], description: 'Data object (reference + backing bpmn:DataObject)' },
    { kind: 'dataStore', type: 'bpmn:DataStoreReference', family: 'data', aliases: ['store', 'dataStoreReference'], description: 'Data store reference' },
    { kind: 'textAnnotation', type: 'bpmn:TextAnnotation', family: 'artifact', aliases: ['note', 'annotation', 'text'], description: 'Text annotation (connect it to an element to draw an association)' },
    { kind: 'group', type: 'bpmn:Group', family: 'artifact', aliases: [], description: 'Group drawn around its members (--members <id,...>; the members reference its category value)' },
  ];

  static readonly REJECTED_TYPES: Readonly<Record<string, string>> = {
    'bpmn:ChoreographyTask': 'choreographies are not supported',
    'bpmn:SubChoreography': 'choreographies are not supported',
    'bpmn:CallChoreography': 'choreographies are not supported',
    'bpmn:ImplicitThrowEvent': 'implicit throw events are not supported',
  };

  static byName(kind: string): KindDefinition | undefined {
    return Kinds.ALL.find((definition) => definition.kind === kind);
  }

  static of(element: BpmnElement): KindDefinition | undefined {
    if (element.is('bpmn:SubProcess') && !element.is('bpmn:AdHocSubProcess') && !element.is('bpmn:Transaction')) {
      return element.get<boolean | undefined>('triggeredByEvent') ? Kinds.byName('eventSubProcess') : Kinds.byName('subProcess');
    }
    return Kinds.ALL.find((definition) => definition.type === element.type);
  }

  static label(element: BpmnElement): string {
    const definition = Kinds.of(element);
    if (!definition) {
      return element.type;
    }
    const trigger = Triggers.of(element);
    return trigger && trigger !== 'none' ? `${definition.kind}:${trigger}` : definition.kind;
  }

  static labelOrType(element: BpmnElement): string {
    if (Kinds.of(element)) {
      return Kinds.label(element);
    }
    return element.is('bpmn:DataAssociation') ? 'dataAssociation' : Kinds.typeLabel(element);
  }

  static typeLabel(element: BpmnElement): string {
    const local = element.type.split(':')[1] ?? element.type;
    return local.charAt(0).toLowerCase() + local.slice(1);
  }

  static branchesByCondition(element: BpmnElement): boolean {
    return !!Kinds.of(element)?.branchesByCondition;
  }

  static ignoresConditions(element: BpmnElement): boolean {
    return Kinds.of(element)?.family === 'gateway' && !Kinds.branchesByCondition(element);
  }

  static synchronises(element: BpmnElement): boolean {
    return !!Kinds.of(element)?.synchronises;
  }

  static namedAsQuestion(element: BpmnElement): boolean {
    return !!Kinds.of(element)?.namedAsQuestion;
  }

  static isEventSubProcess(element: BpmnElement | undefined): boolean {
    return element?.is('bpmn:SubProcess') === true && element.get<boolean | undefined>('triggeredByEvent') === true;
  }

  static gatewayList(): string {
    const gateways = Kinds.ALL.filter((definition) => definition.family === 'gateway').map((definition) => (definition.aliases[0] ? `${definition.kind} (${definition.aliases[0]})` : definition.kind));
    return `${gateways.slice(0, -1).join(', ')} or ${gateways.at(-1)}`;
  }
}
