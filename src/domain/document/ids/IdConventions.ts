export type QualifierMode = 'off' | 'optional' | 'required';

/** The id conventions the core takes, as plain data (from a .bpmnlintrc or a host's table). */
export interface IdConventions {
  /**
   * the prefix of new ids per BPMN type ('bpmn:ServiceTask': 'serviceTask_') and per event
   * trigger ('bpmn:StartEvent:timer': 'timerStartEvent_'); other types take bpmn-cli's own
   * prefix (UNCHECKED_PREFIXES)
   */
  prefixes: Record<string, string>;
  /** under `required` a new event with a trigger takes the qualified prefix (default optional) */
  qualifier?: QualifierMode;
  /** the case of the body after the prefix; absent (`any`): camelCase, unchecked */
  case?: 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case';
  /** where they come from (`.bpmnlintrc in models`) */
  source?: string;
  /**
   * types and event triggers (`bpmn:EndEvent:escalation`) checked with a prefix new ids cannot
   * follow: they take bpmn-cli's own prefix, or the plain one
   */
  ignored?: string[];
}

const GATEWAY = 'gateway_';
const EVENT = 'event_';
const SUB_PROCESS = 'subProcess_';
const ASSOCIATION = 'association_';

/**
 * element-id-naming's defaults (@miragon/bpmnlint-plugin-rules), resolved per concrete type: new
 * ids follow them where no .bpmnlintrc declares other conventions. A guard test keeps them in
 * step with the plugin.
 */
export const DEFAULT_ID_CONVENTIONS: IdConventions = {
  prefixes: {
    'bpmn:StartEvent': 'startEvent_',
    'bpmn:EndEvent': 'endEvent_',
    'bpmn:BoundaryEvent': EVENT,
    'bpmn:IntermediateCatchEvent': EVENT,
    'bpmn:IntermediateThrowEvent': EVENT,
    'bpmn:Task': 'task_',
    'bpmn:ServiceTask': 'serviceTask_',
    'bpmn:UserTask': 'userTask_',
    'bpmn:SendTask': 'sendTask_',
    'bpmn:ReceiveTask': 'receiveTask_',
    'bpmn:ManualTask': 'manualTask_',
    'bpmn:ScriptTask': 'scriptTask_',
    'bpmn:BusinessRuleTask': 'businessRuleTask_',
    'bpmn:CallActivity': 'callActivity_',
    'bpmn:SubProcess': SUB_PROCESS,
    'bpmn:AdHocSubProcess': SUB_PROCESS,
    'bpmn:Transaction': SUB_PROCESS,
    'bpmn:ExclusiveGateway': GATEWAY,
    'bpmn:ParallelGateway': GATEWAY,
    'bpmn:InclusiveGateway': GATEWAY,
    'bpmn:EventBasedGateway': GATEWAY,
    'bpmn:ComplexGateway': GATEWAY,
    'bpmn:SequenceFlow': 'flow_',
    'bpmn:MessageFlow': 'messageFlow_',
    'bpmn:Collaboration': 'collaboration_',
    'bpmn:Participant': 'participant_',
    'bpmn:Lane': 'lane_',
    'bpmn:DataObjectReference': 'dataObject_',
    'bpmn:DataStoreReference': 'dataStore_',
    'bpmn:TextAnnotation': 'textAnnotation_',
    'bpmn:Group': 'group_',
    'bpmn:Association': ASSOCIATION,
    'bpmn:DataInputAssociation': ASSOCIATION,
    'bpmn:DataOutputAssociation': ASSOCIATION,
    'bpmn:StartEvent:message': 'messageStartEvent_',
    'bpmn:StartEvent:timer': 'timerStartEvent_',
    'bpmn:StartEvent:signal': 'signalStartEvent_',
    'bpmn:StartEvent:conditional': 'conditionalStartEvent_',
    'bpmn:StartEvent:error': 'errorStartEvent_',
    'bpmn:StartEvent:escalation': 'escalationStartEvent_',
    'bpmn:StartEvent:compensate': 'compensateStartEvent_',
    'bpmn:EndEvent:message': 'messageEndEvent_',
    'bpmn:EndEvent:error': 'errorEndEvent_',
    'bpmn:EndEvent:signal': 'signalEndEvent_',
    'bpmn:EndEvent:escalation': 'escalationEndEvent_',
    'bpmn:EndEvent:terminate': 'terminateEndEvent_',
    'bpmn:EndEvent:compensate': 'compensateEndEvent_',
    'bpmn:EndEvent:cancel': 'cancelEndEvent_',
    'bpmn:IntermediateCatchEvent:message': 'messageEvent_',
    'bpmn:IntermediateCatchEvent:timer': 'timerEvent_',
    'bpmn:IntermediateCatchEvent:signal': 'signalEvent_',
    'bpmn:IntermediateCatchEvent:conditional': 'conditionalEvent_',
    'bpmn:IntermediateCatchEvent:link': 'linkEvent_',
    'bpmn:IntermediateThrowEvent:message': 'messageEvent_',
    'bpmn:IntermediateThrowEvent:signal': 'signalEvent_',
    'bpmn:IntermediateThrowEvent:escalation': 'escalationEvent_',
    'bpmn:IntermediateThrowEvent:link': 'linkEvent_',
    'bpmn:IntermediateThrowEvent:compensate': 'compensateEvent_',
    'bpmn:BoundaryEvent:message': 'messageEvent_',
    'bpmn:BoundaryEvent:timer': 'timerEvent_',
    'bpmn:BoundaryEvent:error': 'errorEvent_',
    'bpmn:BoundaryEvent:signal': 'signalEvent_',
    'bpmn:BoundaryEvent:escalation': 'escalationEvent_',
    'bpmn:BoundaryEvent:conditional': 'conditionalEvent_',
    'bpmn:BoundaryEvent:compensate': 'compensateEvent_',
    'bpmn:BoundaryEvent:cancel': 'cancelEvent_',
  },
  qualifier: 'optional',
  case: 'camelCase',
};

/**
 * bpmn-cli's own prefix for a type element-id-naming does not check, also where a declaration
 * leaves a type out or switches it off, is its lcfirst local name (`message_`, `laneSet_`,
 * `timerEventDefinition_`), except for these. A named process takes no prefix at all: its id is
 * the deployment key.
 */
export const UNCHECKED_PREFIXES: Record<string, string> = {
  'bpmn:DataObject': 'dataObjectItem_',
  'bpmn:DataStore': 'dataStoreItem_',
};
