import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8TaskListenerEventTypeValidRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-task-listener-event-type-valid', () => {
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

  verifyEngineRule(rule, {
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
        name: 'task listeners on a service task (c8-zeebe-extension-placement reports them)',
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
    ],
  });
});
