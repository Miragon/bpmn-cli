export type QualifierMode = 'off' | 'optional' | 'required';

export type Body = 'camel' | 'pascal' | 'snake' | 'kebab';

export interface IdState {
  type: string;
  trigger?: string;
}

export interface IdConventions {
  prefixes: Record<string, string>;
  qualifier?: QualifierMode;
  case?: 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case';
  source?: string;
  ignored?: string[];
}

export class IdDefaults {
  static readonly CONVENTIONS: IdConventions = {
    prefixes: {
      'bpmn:StartEvent': 'startEvent_',
      'bpmn:EndEvent': 'endEvent_',
      'bpmn:BoundaryEvent': 'event_',
      'bpmn:IntermediateCatchEvent': 'event_',
      'bpmn:IntermediateThrowEvent': 'event_',
      'bpmn:Task': 'task_',
      'bpmn:ServiceTask': 'serviceTask_',
      'bpmn:UserTask': 'userTask_',
      'bpmn:SendTask': 'sendTask_',
      'bpmn:ReceiveTask': 'receiveTask_',
      'bpmn:ManualTask': 'manualTask_',
      'bpmn:ScriptTask': 'scriptTask_',
      'bpmn:BusinessRuleTask': 'businessRuleTask_',
      'bpmn:CallActivity': 'callActivity_',
      'bpmn:SubProcess': 'subProcess_',
      'bpmn:AdHocSubProcess': 'subProcess_',
      'bpmn:Transaction': 'subProcess_',
      'bpmn:ExclusiveGateway': 'gateway_',
      'bpmn:ParallelGateway': 'gateway_',
      'bpmn:InclusiveGateway': 'gateway_',
      'bpmn:EventBasedGateway': 'gateway_',
      'bpmn:ComplexGateway': 'gateway_',
      'bpmn:SequenceFlow': 'flow_',
      'bpmn:MessageFlow': 'messageFlow_',
      'bpmn:Collaboration': 'collaboration_',
      'bpmn:Participant': 'participant_',
      'bpmn:Lane': 'lane_',
      'bpmn:DataObjectReference': 'dataObject_',
      'bpmn:DataStoreReference': 'dataStore_',
      'bpmn:TextAnnotation': 'textAnnotation_',
      'bpmn:Group': 'group_',
      'bpmn:Association': 'association_',
      'bpmn:DataInputAssociation': 'association_',
      'bpmn:DataOutputAssociation': 'association_',
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

  static readonly UNCHECKED_PREFIXES: Readonly<Record<string, string>> = {
    'bpmn:DataObject': 'dataObjectItem_',
    'bpmn:DataStore': 'dataStoreItem_',
  };
}
