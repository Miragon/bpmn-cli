export const ZEEBE_URI = 'http://camunda.org/schema/zeebe/1.0';

/** Camunda 7 content, in its own namespace and in Operaton's copy of it. */
export const CAMUNDA_7_PREFIX_BY_URI = new Map([
  ['http://camunda.org/schema/1.0/bpmn', 'camunda'],
  ['http://operaton.org/schema/1.0/bpmn', 'operaton'],
]);
