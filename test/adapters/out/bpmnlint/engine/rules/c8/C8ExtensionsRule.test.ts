import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8ExtensionsRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-extension', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const SERVICE_TASK = (extra = '') =>
    `<bpmn:serviceTask id="serviceTask_charge">${ext(`<zeebe:taskDefinition type="charge" />${extra}`)}</bpmn:serviceTask>`;
  const HEADERS = (...keys: string[]) =>
    `<zeebe:taskHeaders>${keys.map((key, index) => `<zeebe:header key="${key}" value="v${index}" />`).join('')}</zeebe:taskHeaders>`;
  const CONDITIONAL = (filter: string) => `
    <bpmn:intermediateCatchEvent id="event_stockChanged">
      <bpmn:conditionalEventDefinition id="conditionalEventDefinition_stockChanged">
        ${ext(filter)}
        <bpmn:condition xsi:type="bpmn:tFormalExpression">= stock &gt; 0</bpmn:condition>
      </bpmn:conditionalEventDefinition>
    </bpmn:intermediateCatchEvent>`;

  verifyEngineRule('c8-extension', rule, {
    valid: [
      {
        name: 'every binding type, a version tag where it binds by version tag',
        moddleElement: engineModel(
          'c8',
          `<bpmn:callActivity id="callActivity_ship">${ext('<zeebe:calledElement processId="ship" bindingType="deployment" />')}</bpmn:callActivity>
          <bpmn:businessRuleTask id="businessRuleTask_rate">${ext('<zeebe:calledDecision decisionId="rate" resultVariable="rate" bindingType="latest" />')}</bpmn:businessRuleTask>
          <bpmn:userTask id="userTask_review">${ext('<zeebe:userTask /><zeebe:formDefinition formId="review" bindingType="versionTag" versionTag="v1" />')}</bpmn:userTask>`,
        ),
      },
      {
        name: 'a version tag binding without version tag on a business rule task (camunda-compat reports it)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:businessRuleTask id="businessRuleTask_rate">${ext('<zeebe:calledDecision decisionId="rate" resultVariable="rate" bindingType="versionTag" />')}</bpmn:businessRuleTask>`,
        ),
      },
      {
        name: 'a complete linked resource, variable events create and update',
        moddleElement: engineModel(
          'c8',
          `${SERVICE_TASK('<zeebe:linkedResources><zeebe:linkedResource resourceId="r" resourceType="RPA" linkName="robot" bindingType="versionTag" versionTag="v1" /></zeebe:linkedResources>')}
          ${CONDITIONAL('<zeebe:conditionalFilter variableNames="stock" variableEvents="create, update" />')}`,
        ),
      },
      {
        name: 'a task header key twice in the first header list (camunda-compat reports it)',
        moddleElement: engineModel('c8', SERVICE_TASK(HEADERS('region', 'region'))),
      },
      {
        name: 'mappings without target or source (camunda-compat reports them)',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            '<zeebe:ioMapping><zeebe:input source="=a" /><zeebe:input source="=a" target=" " /><zeebe:output source="=a" target="1x" /><zeebe:output target="a" /></zeebe:ioMapping>',
          ),
        ),
      },
      {
        name: 'an unknown binding type in a non-executable process',
        moddleElement: engineModel(
          'c8',
          `<bpmn:callActivity id="callActivity_ship">${ext('<zeebe:calledElement processId="ship" bindingType="foo" />')}</bpmn:callActivity>`,
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'a linked resource on a user task (c8-misplaced-extension reports it)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:userTask id="userTask_review">${ext('<zeebe:userTask /><zeebe:linkedResources><zeebe:linkedResource resourceId="r" /></zeebe:linkedResources>')}</bpmn:userTask>`,
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_ship" calledElement="ship" camunda:calledElementBinding="foo" />',
        ),
      },
    ],
    invalid: [
      {
        name: 'an unknown binding type',
        moddleElement: engineModel(
          'c8',
          `<bpmn:callActivity id="callActivity_ship">${ext('<zeebe:calledElement processId="ship" bindingType="foo" />')}</bpmn:callActivity>`,
        ),
        report: {
          id: 'callActivity_ship',
          message:
            'zeebe:calledElement of callActivity callActivity_ship has bindingType="foo"; Camunda 8 accepts deployment, latest, versionTag only and refuses the file',
          path: ['extensionElements', 'values', 0, 'bindingType'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a version tag binding without version tag on a start event form',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_requested">${ext('<zeebe:formDefinition formId="request" bindingType="versionTag" />')}</bpmn:startEvent>`,
        ),
        report: {
          id: 'startEvent_requested',
          message:
            'zeebe:formDefinition of startEvent startEvent_requested has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file',
          path: ['extensionElements', 'values', 0, 'versionTag'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'a blank version tag on a call activity',
        moddleElement: engineModel(
          'c8',
          `<bpmn:callActivity id="callActivity_ship">${ext('<zeebe:calledElement processId="ship" bindingType="versionTag" versionTag=" " />')}</bpmn:callActivity>`,
        ),
        report: {
          id: 'callActivity_ship',
          message:
            'zeebe:calledElement of callActivity callActivity_ship has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file',
          path: ['extensionElements', 'values', 0, 'versionTag'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'a linked resource without resource type',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            '<zeebe:linkedResources><zeebe:linkedResource resourceId="r" linkName="l" /></zeebe:linkedResources>',
          ),
        ),
        report: {
          id: 'serviceTask_charge',
          message:
            'Linked resource l of serviceTask serviceTask_charge has no resourceType; Camunda 8 refuses the file',
          path: ['extensionElements', 'values', 1, 'values', 0, 'resourceType'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'linked resources with an unknown binding type and without version tag',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            '<zeebe:linkedResources><zeebe:linkedResource resourceId="r" resourceType="RPA" bindingType="foo" /><zeebe:linkedResource resourceId="s" resourceType="RPA" bindingType="versionTag" /></zeebe:linkedResources>',
          ),
        ),
        report: [
          {
            id: 'serviceTask_charge',
            message:
              'Linked resource 1 of serviceTask serviceTask_charge has bindingType="foo"; Camunda 8 accepts deployment, latest, versionTag only and refuses the file',
            path: ['extensionElements', 'values', 1, 'values', 0, 'bindingType'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
          {
            id: 'serviceTask_charge',
            message:
              'Linked resource 2 of serviceTask serviceTask_charge has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file',
            path: ['extensionElements', 'values', 1, 'values', 1, 'versionTag'],
            type: ERROR_TYPES.PROPERTY_REQUIRED,
          },
        ],
      },
      {
        name: 'an unknown variable event',
        moddleElement: engineModel(
          'c8',
          CONDITIONAL(
            '<zeebe:conditionalFilter variableNames="stock" variableEvents="create, foo" />',
          ),
        ),
        report: {
          id: 'event_stockChanged',
          message:
            'zeebe:conditionalFilter of conditionalEventDefinition conditionalEventDefinition_stockChanged lists the variable events foo; Camunda 8 knows create and update only and refuses the file',
          path: ['eventDefinitions', 0, 'extensionElements', 'values', 0, 'variableEvents'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c8-duplicate-extension', () => {
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
});

describe('c8-listener', () => {
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
});

describe('c8-bad-value', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const job = (retries: string) => `<zeebe:taskDefinition type="work" retries="${retries}" />`;
  const serviceTask = (inner: string) => `<bpmn:serviceTask id="X">${ext(inner)}</bpmn:serviceTask>`;

  const retriesReport = (retries: string, label = 'serviceTask X') => ({
    id: 'X',
    message: `The zeebe:taskDefinition of ${label} has retries="${retries}", which is no number; it deploys, but every instance gets an incident when it reaches X`,
    path: ['extensionElements', 'values', 0, 'retries'],
    type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
  });

  const headerReport = (
    header: string,
    where: string,
    missing: string,
    path: (string | number)[],
  ) => ({
    id: 'X',
    message: `Task header ${header} of ${where} has no ${missing}; Camunda 8 drops it, the job does not carry it`,
    path,
    type: ERROR_TYPES.PROPERTY_REQUIRED,
  });

  verifyEngineRule('c8-bad-value', rule, {
    valid: [
      ...['3', ' -1 ', '=retries'].map((retries) => ({
        name: `retries="${retries}"`,
        moddleElement: engineModel('c8', serviceTask(job(retries))),
      })),
      {
        name: 'headers with key and value',
        moddleElement: engineModel(
          'c8',
          serviceTask(
            '<zeebe:taskDefinition type="work" /><zeebe:taskHeaders><zeebe:header key="k" value="v" /></zeebe:taskHeaders>',
          ),
        ),
      },
      {
        name: 'task headers where Camunda 8 does not read them (a manual task)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:manualTask id="X">${ext('<zeebe:taskHeaders><zeebe:header value="v" /></zeebe:taskHeaders>')}</bpmn:manualTask>`,
        ),
      },
      {
        name: 'retries on a task Camunda 8 runs no job for (a user task)',
        moddleElement: engineModel('c8', `<bpmn:userTask id="X">${ext(job('abc'))}</bpmn:userTask>`),
      },
      {
        name: 'a process that is not executable',
        moddleElement: engineModel('c8', serviceTask(job('abc')), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'inside a transaction (refused as a whole)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:transaction id="T">${serviceTask(job('abc'))}</bpmn:transaction>`,
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="X" camunda:type="external" camunda:topic="work" />',
        ),
      },
    ],
    invalid: [
      {
        name: 'retries that are no number',
        moddleElement: engineModel('c8', serviceTask(job('abc'))),
        report: retriesReport('abc'),
      },
      {
        name: 'retries that are no number on a message end event',
        moddleElement: engineModel(
          'c8',
          `<bpmn:endEvent id="X">${ext(job('1.5'))}<bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:endEvent>`,
          { roots: '<bpmn:message id="M1" name="Done" />' },
        ),
        report: retriesReport('1.5', 'endEvent:message X'),
      },
      {
        name: 'task headers without key or value (the duplicate is camunda-compat duplicate-task-headers)',
        moddleElement: engineModel(
          'c8',
          serviceTask(
            '<zeebe:taskDefinition type="work" /><zeebe:taskHeaders><zeebe:header key="k" value="v" /><zeebe:header key="k" value="w" /><zeebe:header value="x" /><zeebe:header key="e" /><zeebe:header key="s" value="  " /></zeebe:taskHeaders>',
          ),
        ),
        report: [
          headerReport('3', 'serviceTask X', 'key', [
            'extensionElements',
            'values',
            1,
            'values',
            2,
            'key',
          ]),
          headerReport('"e"', 'serviceTask X', 'value', [
            'extensionElements',
            'values',
            1,
            'values',
            3,
            'value',
          ]),
          headerReport('"s"', 'serviceTask X', 'value', [
            'extensionElements',
            'values',
            1,
            'values',
            4,
            'value',
          ]),
        ],
      },
      {
        name: 'a header without value in an execution listener',
        moddleElement: engineModel(
          'c8',
          serviceTask(
            '<zeebe:taskDefinition type="work" /><zeebe:executionListeners><zeebe:executionListener eventType="start" type="audit"><zeebe:taskHeaders><zeebe:header key="k" /></zeebe:taskHeaders></zeebe:executionListener></zeebe:executionListeners>',
          ),
        ),
        report: headerReport('"k"', 'execution listener 1 of serviceTask X', 'value', [
          'extensionElements',
          'values',
          1,
          'listeners',
          0,
          'headers',
          'values',
          0,
          'value',
        ]),
      },
    ],
  });
});

describe('c8-feel-completion-condition', () => {
  const ZEEBE_LOOP =
    '<bpmn:extensionElements><zeebe:loopCharacteristics inputCollection="=items" inputElement="item" /></bpmn:extensionElements>';

  const multiInstance = (condition: string | null, task = 'serviceTask') => `
    <bpmn:${task} id="X">
      <bpmn:extensionElements><zeebe:taskDefinition type="work" /></bpmn:extensionElements>
      <bpmn:multiInstanceLoopCharacteristics>${ZEEBE_LOOP}${
        condition === null
          ? ''
          : `<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${condition}</bpmn:completionCondition>`
      }</bpmn:multiInstanceLoopCharacteristics>
    </bpmn:${task}>`;

  const report = (body: string, label = 'serviceTask X') => ({
    id: 'X',
    message: `The completion condition "${body}" of multi-instance ${label} is no FEEL expression (=...); it deploys, but every completed instance gets an incident (expected a boolean, got a string)`,
    path: ['loopCharacteristics', 'completionCondition'],
    type: ERROR_TYPES.EXPRESSION_REQUIRED,
  });

  verifyEngineRule('c8-feel-completion-condition', rule, {
    valid: [
      {
        name: 'a FEEL completion condition',
        moddleElement: engineModel('c8', multiInstance('= done')),
      },
      {
        name: 'a multi-instance without completion condition',
        moddleElement: engineModel('c8', multiInstance(null)),
      },
      {
        name: 'a FEEL completion condition with leading white space',
        moddleElement: engineModel('c8', multiInstance('  =done')),
      },
      {
        name: 'a standard loop',
        moddleElement: engineModel(
          'c8',
          '<bpmn:serviceTask id="X"><bpmn:standardLoopCharacteristics /></bpmn:serviceTask>',
        ),
      },
      {
        name: 'a process that is not executable',
        moddleElement: engineModel('c8', multiInstance('${done}'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'inside a transaction (refused as a whole)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:transaction id="T">${multiInstance('${done}')}</bpmn:transaction>`,
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="X" camunda:type="external" camunda:topic="work"><bpmn:multiInstanceLoopCharacteristics camunda:collection="items"><bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${done}</bpmn:completionCondition></bpmn:multiInstanceLoopCharacteristics></bpmn:serviceTask>',
        ),
      },
    ],
    invalid: [
      {
        name: 'a JUEL completion condition',
        moddleElement: engineModel('c8', multiInstance('${done}')),
        report: report('${done}'),
      },
      {
        name: 'a static completion condition of a sub-process',
        moddleElement: engineModel('c8', multiInstance('true', 'subProcess')),
        report: report('true', 'subProcess X'),
      },
      {
        name: 'an empty completion condition',
        moddleElement: engineModel('c8', multiInstance('')),
        report: report(''),
      },
    ],
  });
});
