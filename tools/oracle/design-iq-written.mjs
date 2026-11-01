export const ORDER_TO_CASH = 'apps/live-host/test/fixtures/bpmn-edit/order-to-cash.bpmn';

export const WRITTEN_CALLS = [
  { row: 'showXml(xml, { scope })', function: 'showXml', args: [{ scope: 'Participant_acme' }] },
  { row: 'layoutXml(xml, { expand, collapse })', function: 'layoutXml', args: [{ collapse: ['EventSubProcess_customer_support'] }] },
  { row: 'layoutXml(xml, { expand, collapse })', function: 'layoutXml', args: [{ expand: ['EventSubProcess_customer_support'] }] },
  { row: 'the problems: that end showXml', function: 'validateXml', args: [] },
  { row: 'BpmnError and its categories', function: 'applyToXml', xml: '<not-bpmn/>', args: [[{ op: 'tidy' }]] },
];

export const WRITTEN_BUILD = {
  row: 'a model built over many edit_process calls',
  steps: [
    [{ op: 'add', kind: 'startEvent', name: 'Order received', in: 'Process_1', id: 'startEvent_received' }],
    [{ op: 'add', kind: 'userTask', name: 'Check order', after: 'startEvent_received', id: 'userTask_check' }],
    [{ op: 'add', kind: 'endEvent', name: 'Order done', after: 'userTask_check' }],
  ],
};
