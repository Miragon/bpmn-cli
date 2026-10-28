import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-duplicate-extension.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const TASK_DEFINITION = (type = 'charge') => `<zeebe:taskDefinition type="${type}" />`;
const SERVICE_TASK = (inner: string) =>
  `<bpmn:serviceTask id="serviceTask_charge">${ext(inner)}</bpmn:serviceTask>`;
const MESSAGE = (subscriptions: string) =>
  `<bpmn:message id="message_paid" name="paid">${ext(subscriptions)}</bpmn:message>`;
const SUBSCRIPTION = (key: string) => `<zeebe:subscription correlationKey="=${key}" />`;
const DUPLICATE = (id: string, message: string, index: number) => ({
  id,
  message,
  path: ['extensionElements', 'values', index],
  type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
});

verifyEngineRule('c8-duplicate-extension', rule, {
  valid: [
    {
      name: 'one of each zeebe element',
      moddleElement: engineModel(
        'c8',
        `${ext('<zeebe:versionTag value="v1" />')}
        ${SERVICE_TASK(`${TASK_DEFINITION()}<zeebe:ioMapping><zeebe:input source="=a" target="a" /></zeebe:ioMapping><zeebe:taskHeaders><zeebe:header key="k" value="v" /></zeebe:taskHeaders>`)}
        <bpmn:receiveTask id="receiveTask_paid" messageRef="message_paid" />`,
        { roots: MESSAGE(SUBSCRIPTION('orderId')) },
      ),
    },
    {
      name: 'two zeebe elements on a host that does not read them (c8-misplaced-extension reports them)',
      moddleElement: engineModel(
        'c8',
        SERVICE_TASK(`${TASK_DEFINITION()}<zeebe:userTask /><zeebe:userTask />`),
      ),
    },
    {
      name: 'two subscriptions on a message no executable process uses',
      moddleElement: engineModel('c8', '<bpmn:startEvent id="startEvent_received" />', {
        roots: MESSAGE(SUBSCRIPTION('orderId') + SUBSCRIPTION('invoiceId')),
      }),
    },
    {
      name: 'two task definitions in a non-executable process',
      moddleElement: engineModel('c8', SERVICE_TASK(TASK_DEFINITION('a') + TASK_DEFINITION('b')), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel(
        'c7',
        `<bpmn:serviceTask id="serviceTask_charge" camunda:type="external" camunda:topic="charge">${ext(
          '<camunda:inputOutput /><camunda:inputOutput />',
        )}</bpmn:serviceTask>`,
      ),
    },
  ],
  invalid: [
    {
      name: 'two zeebe:taskDefinition',
      moddleElement: engineModel('c8', SERVICE_TASK(TASK_DEFINITION('a') + TASK_DEFINITION('b'))),
      report: DUPLICATE(
        'serviceTask_charge',
        'serviceTask serviceTask_charge has 2 zeebe:taskDefinition elements; Camunda 8 reads one and refuses the file',
        1,
      ),
    },
    {
      name: 'two zeebe:calledElement',
      moddleElement: engineModel(
        'c8',
        `<bpmn:callActivity id="callActivity_ship">${ext('<zeebe:calledElement processId="a" /><zeebe:calledElement processId="b" />')}</bpmn:callActivity>`,
      ),
      report: DUPLICATE(
        'callActivity_ship',
        'callActivity callActivity_ship has 2 zeebe:calledElement elements; Camunda 8 reads one and refuses the file',
        1,
      ),
    },
    {
      name: 'two zeebe:ioMapping',
      moddleElement: engineModel(
        'c8',
        SERVICE_TASK(
          `${TASK_DEFINITION()}<zeebe:ioMapping><zeebe:input source="=a" target="a" /></zeebe:ioMapping><zeebe:ioMapping><zeebe:input source="=b" target="b" /></zeebe:ioMapping>`,
        ),
      ),
      report: DUPLICATE(
        'serviceTask_charge',
        'serviceTask serviceTask_charge has 2 zeebe:ioMapping elements; Camunda 8 reads one and refuses the file',
        2,
      ),
    },
    {
      name: 'two zeebe:userTask, zeebe:assignmentDefinition, zeebe:taskSchedule',
      moddleElement: engineModel(
        'c8',
        `<bpmn:userTask id="userTask_review">${ext(
          '<zeebe:userTask /><zeebe:userTask /><zeebe:assignmentDefinition assignee="a" /><zeebe:assignmentDefinition candidateGroups="g" /><zeebe:taskSchedule dueDate="=a" /><zeebe:taskSchedule followUpDate="=b" />',
        )}</bpmn:userTask>`,
      ),
      report: [
        DUPLICATE(
          'userTask_review',
          'userTask userTask_review has 2 zeebe:userTask elements; Camunda 8 reads one and refuses the file',
          1,
        ),
        DUPLICATE(
          'userTask_review',
          'userTask userTask_review has 2 zeebe:assignmentDefinition elements; Camunda 8 reads one and refuses the file',
          3,
        ),
        DUPLICATE(
          'userTask_review',
          'userTask userTask_review has 2 zeebe:taskSchedule elements; Camunda 8 reads one and refuses the file',
          5,
        ),
      ],
    },
    {
      name: 'two zeebe:properties, two zeebe:versionTag',
      moddleElement: engineModel(
        'c8',
        `${ext('<zeebe:versionTag value="v1" /><zeebe:versionTag value="v2" />')}
        ${SERVICE_TASK(
          `${TASK_DEFINITION()}<zeebe:properties><zeebe:property name="a" value="1" /></zeebe:properties><zeebe:properties><zeebe:property name="b" value="2" /></zeebe:properties>`,
        )}`,
      ),
      report: [
        DUPLICATE(
          'process_test',
          'process process_test has 2 zeebe:versionTag elements; Camunda 8 reads one and refuses the file',
          1,
        ),
        DUPLICATE(
          'serviceTask_charge',
          'serviceTask serviceTask_charge has 2 zeebe:properties elements; Camunda 8 reads one and refuses the file',
          2,
        ),
      ],
    },
    {
      name: 'two zeebe:subscription on one message',
      moddleElement: engineModel(
        'c8',
        '<bpmn:receiveTask id="receiveTask_paid" messageRef="message_paid" />',
        { roots: MESSAGE(SUBSCRIPTION('orderId') + SUBSCRIPTION('invoiceId')) },
      ),
      report: DUPLICATE(
        'message_paid',
        'message message_paid has 2 zeebe:subscription elements; Camunda 8 reads one and refuses the file',
        1,
      ),
    },
    {
      name: 'three zeebe:loopCharacteristics on a multi-instance loop',
      moddleElement: engineModel(
        'c8',
        `<bpmn:serviceTask id="serviceTask_charge">${ext(TASK_DEFINITION())}
          <bpmn:multiInstanceLoopCharacteristics>${ext(
            '<zeebe:loopCharacteristics inputCollection="=a" /><zeebe:loopCharacteristics inputCollection="=b" /><zeebe:loopCharacteristics inputCollection="=c" />',
          )}</bpmn:multiInstanceLoopCharacteristics>
        </bpmn:serviceTask>`,
      ),
      report: {
        id: 'serviceTask_charge',
        message:
          'the multiInstanceLoopCharacteristics of serviceTask serviceTask_charge has 3 zeebe:loopCharacteristics elements; Camunda 8 reads one and refuses the file',
        path: ['loopCharacteristics', 'extensionElements', 'values', 1],
        type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
      },
    },
  ],
});
