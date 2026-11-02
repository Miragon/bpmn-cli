import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8SequenceFlowNoExecutionListenersRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-sequence-flow-no-execution-listeners', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const EXECUTION = (...listeners: string[]) =>
    `<zeebe:executionListeners>${listeners.map((listener) => `<zeebe:executionListener ${listener} />`).join('')}</zeebe:executionListeners>`;
  const TASK = (...listeners: string[]) =>
    `<zeebe:taskListeners>${listeners.map((listener) => `<zeebe:taskListener ${listener} />`).join('')}</zeebe:taskListeners>`;
  const SERVICE_TASK = (extra = '') =>
    `<bpmn:serviceTask id="serviceTask_charge">${ext(`<zeebe:taskDefinition type="charge" />${extra}`)}</bpmn:serviceTask>`;
  const USER_TASK = (inner: string) =>
    `<bpmn:userTask id="userTask_review">${ext(inner)}</bpmn:userTask>`;

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
});
