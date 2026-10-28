export type QualifierMode = 'off' | 'optional' | 'required';

/** The id conventions the core takes, as plain data (from a .bpmnlintrc or a host's table). */
export interface IdConventions {
  /**
   * the prefix of new ids per BPMN type ('bpmn:ServiceTask': 'serviceTask_') and per event
   * trigger ('bpmn:StartEvent:timer': 'timerStartEvent_'); other types follow the file's style
   */
  prefixes: Record<string, string>;
  /** under `required` a new event with a trigger takes the qualified prefix (default optional) */
  qualifier?: QualifierMode;
  /** the case of the body after a declared prefix; absent: the file's case */
  case?: 'camelCase' | 'PascalCase' | 'snake_case';
  /** where they come from (`.bpmnlintrc in models`) */
  source?: string;
  /**
   * types and event triggers (`bpmn:EndEvent:escalation`) checked with a prefix new ids cannot
   * follow: they follow the file's style
   */
  ignored?: string[];
}
