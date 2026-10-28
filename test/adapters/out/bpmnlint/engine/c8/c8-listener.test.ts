import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-listener.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const EXECUTION = (...listeners: string[]) =>
  `<zeebe:executionListeners>${listeners.map((listener) => `<zeebe:executionListener ${listener} />`).join('')}</zeebe:executionListeners>`;
const TASK = (...listeners: string[]) =>
  `<zeebe:taskListeners>${listeners.map((listener) => `<zeebe:taskListener ${listener} />`).join('')}</zeebe:taskListeners>`;
const SERVICE_TASK = (extra = '') =>
  `<bpmn:serviceTask id="serviceTask_charge">${ext(`<zeebe:taskDefinition type="charge" />${extra}`)}</bpmn:serviceTask>`;
const USER_TASK = (inner: string) =>
  `<bpmn:userTask id="userTask_review">${ext(inner)}</bpmn:userTask>`;

const EXECUTION_TYPE = (index: number, listenerIndex = 0) => [
  'extensionElements',
  'values',
  index,
  'listeners',
  listenerIndex,
  'eventType',
];

verifyEngineRule('c8-listener', rule, {
  valid: [
    {
      name: 'start and end listeners on a task, a start listener on a gateway, an end listener on a start event',
      moddleElement: engineModel(
        'c8',
        `<bpmn:startEvent id="startEvent_received">${ext(EXECUTION('eventType="end" type="audit"'))}</bpmn:startEvent>
        ${SERVICE_TASK(EXECUTION('eventType="start" type="audit"', 'eventType="end" type="audit"'))}
        <bpmn:exclusiveGateway id="gateway_approved">${ext(EXECUTION('eventType="start" type="audit"'))}</bpmn:exclusiveGateway>`,
      ),
    },
    {
      name: 'task listeners with every event type on a Camunda user task',
      moddleElement: engineModel(
        'c8',
        USER_TASK(
          `<zeebe:userTask />${TASK(
            'eventType="creating" type="audit"',
            'eventType="assigning" type="audit"',
            'eventType="updating" type="audit"',
            'eventType="completing" type="audit"',
            'eventType="canceling" type="audit"',
            'eventType="complete" type="audit"',
          )}`,
        ),
      ),
    },
    {
      name: 'a listener without type (camunda-compat reports it)',
      moddleElement: engineModel(
        'c8',
        `${SERVICE_TASK(EXECUTION('eventType="start"'))}${USER_TASK(`<zeebe:userTask />${TASK('eventType="creating"')}`)}`,
      ),
    },
    {
      name: 'beforeAll and cancel listeners on Camunda 8.10 (camunda-compat checks where they go)',
      moddleElement: engineModel(
        'c8',
        SERVICE_TASK(
          EXECUTION('eventType="beforeAll" type="audit"', 'eventType="cancel" type="audit"'),
        ),
      ),
    },
    {
      name: 'listeners in a non-executable process',
      moddleElement: engineModel(
        'c8',
        `<bpmn:startEvent id="startEvent_received">${ext(EXECUTION('eventType="start" type="audit"'))}</bpmn:startEvent>`,
        { processAttributes: 'isExecutable="false"' },
      ),
    },
    {
      name: 'listeners inside a transaction (Camunda 8 refuses the transaction as a whole)',
      moddleElement: engineModel(
        'c8',
        `<bpmn:transaction id="transaction_booking">
          <bpmn:startEvent id="startEvent_booking">${ext(EXECUTION('eventType="start" type="audit"'))}</bpmn:startEvent>
        </bpmn:transaction>`,
      ),
    },
    {
      name: 'task listeners on a service task (c8-misplaced-extension reports them)',
      moddleElement: engineModel('c8', SERVICE_TASK(TASK('eventType="foo" type="audit"'))),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel(
        'c7',
        `<bpmn:startEvent id="startEvent_received">${ext('<camunda:executionListener event="start" class="Audit" />')}</bpmn:startEvent>`,
      ),
    },
  ],
  invalid: [
    {
      name: 'task listeners on a job worker user task',
      moddleElement: engineModel('c8', USER_TASK(TASK('eventType="creating" type="audit"'))),
      report: {
        id: 'userTask_review',
        message:
          'userTask userTask_review has task listeners but is a job worker user task (no zeebe:userTask); Camunda 8 allows task listeners on Camunda user tasks only and refuses the file',
        path: ['extensionElements'],
        type: ERROR_TYPES.EXTENSION_ELEMENT_REQUIRED,
      },
    },
    {
      name: 'a task listener with an unknown event type, one without type',
      moddleElement: engineModel(
        'c8',
        USER_TASK(
          `<zeebe:userTask />${TASK('eventType="foo" type="audit"', 'eventType="creating"')}`,
        ),
      ),
      report: {
        id: 'userTask_review',
        message:
          'Task listener 1 (foo) of userTask userTask_review: eventType "foo" is not one of creating, assigning, updating, completing, canceling; Camunda 8 refuses the file',
        path: EXECUTION_TYPE(1),
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
    {
      name: 'a task listener without event type',
      moddleElement: engineModel('c8', USER_TASK(`<zeebe:userTask />${TASK('type="audit"')}`)),
      report: {
        id: 'userTask_review',
        message:
          'Task listener 1 of userTask userTask_review has no eventType; Camunda 8 refuses the file',
        path: EXECUTION_TYPE(1),
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    {
      name: 'an execution listener without type, one with an unknown event type',
      moddleElement: engineModel(
        'c8',
        SERVICE_TASK(EXECUTION('eventType="start"', 'eventType="take" type="audit"')),
        { version: '8.9.0' },
      ),
      report: {
        id: 'serviceTask_charge',
        message:
          'Execution listener 2 (take) of serviceTask serviceTask_charge: eventType "take" is not start or end; Camunda 8 refuses the file',
        path: EXECUTION_TYPE(1, 1),
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
    {
      name: 'an execution listener with an unknown event type on Camunda 8.10',
      moddleElement: engineModel('c8', SERVICE_TASK(EXECUTION('eventType="take" type="audit"'))),
      report: {
        id: 'serviceTask_charge',
        message:
          'Execution listener 1 (take) of serviceTask serviceTask_charge: eventType "take" is not one of start, end, beforeAll, cancel; Camunda 8 refuses the file',
        path: EXECUTION_TYPE(1),
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
    {
      name: 'a beforeAll listener on Camunda 8.9',
      moddleElement: engineModel(
        'c8',
        SERVICE_TASK(EXECUTION('eventType="beforeAll" type="audit"')),
        {
          version: '8.9.0',
        },
      ),
      report: {
        id: 'serviceTask_charge',
        message:
          'Execution listener 1 (beforeAll) of serviceTask serviceTask_charge: eventType "beforeAll" is not start or end; Camunda 8 refuses the file',
        path: EXECUTION_TYPE(1),
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
    {
      name: 'an execution listener with a blank event type',
      moddleElement: engineModel('c8', SERVICE_TASK(EXECUTION('eventType=" " type="audit"'))),
      report: {
        id: 'serviceTask_charge',
        message:
          'Execution listener 1 of serviceTask serviceTask_charge has no eventType; Camunda 8 refuses the file',
        path: EXECUTION_TYPE(1),
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    {
      name: 'start listeners on a start event and a boundary event',
      moddleElement: engineModel(
        'c8',
        `<bpmn:startEvent id="startEvent_received">${ext(EXECUTION('eventType="start" type="audit"'))}</bpmn:startEvent>
        ${SERVICE_TASK()}
        <bpmn:boundaryEvent id="boundaryEvent_timeout" attachedToRef="serviceTask_charge">
          ${ext(EXECUTION('eventType="start" type="audit"'))}
          <bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>
        </bpmn:boundaryEvent>`,
      ),
      report: [
        {
          id: 'startEvent_received',
          message:
            'Execution listener 1 (start) of startEvent startEvent_received: Camunda 8 does not support start listeners on start events and refuses the file',
          path: EXECUTION_TYPE(0),
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
        {
          id: 'boundaryEvent_timeout',
          message:
            'Execution listener 1 (start) of boundaryEvent:timer boundaryEvent_timeout: Camunda 8 does not support start listeners on boundary events and refuses the file',
          path: EXECUTION_TYPE(0),
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      ],
    },
    {
      name: 'an end listener on a gateway',
      moddleElement: engineModel(
        'c8',
        `<bpmn:exclusiveGateway id="gateway_approved">${ext(EXECUTION('eventType="end" type="audit"'))}</bpmn:exclusiveGateway>`,
      ),
      report: {
        id: 'gateway_approved',
        message:
          'Execution listener 1 (end) of exclusiveGateway gateway_approved: Camunda 8 does not support end listeners on gateways and refuses the file',
        path: EXECUTION_TYPE(0),
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
    {
      name: 'execution listeners on a sequence flow',
      moddleElement: engineModel(
        'c8',
        `<bpmn:startEvent id="startEvent_received" />
        <bpmn:sequenceFlow id="flow_received" sourceRef="startEvent_received" targetRef="endEvent_done">
          ${ext(EXECUTION('eventType="start" type="audit"'))}
        </bpmn:sequenceFlow>
        <bpmn:endEvent id="endEvent_done" />`,
      ),
      report: {
        id: 'flow_received',
        message:
          'sequenceFlow flow_received has execution listeners; Camunda 8 supports them on processes, activities, events and gateways, not on sequence flows, and refuses the file',
        path: ['extensionElements', 'values', 0],
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
      },
    },
  ],
});
