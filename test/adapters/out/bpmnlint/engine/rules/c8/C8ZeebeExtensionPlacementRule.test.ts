import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8ZeebeExtensionPlacementRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-zeebe-extension-placement', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const TASK_DEFINITION = '<zeebe:taskDefinition type="charge" />';
  const SERVICE_TASK = (inner: string, loop = '') =>
    `<bpmn:serviceTask id="serviceTask_charge">${ext(inner)}${loop}</bpmn:serviceTask>`;
  const IO_MAPPING = (mappings: string) => `<zeebe:ioMapping>${mappings}</zeebe:ioMapping>`;
  const NOT_READ = (id: string, message: string, path: (string | number)[]) => ({
    id,
    message,
    path,
    type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
  });

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'zeebe content where Camunda 8 reads it',
        moddleElement: engineModel(
          'c8',
          `${SERVICE_TASK(
            TASK_DEFINITION + IO_MAPPING('<zeebe:input source="=a" target="a" />'),
            `<bpmn:multiInstanceLoopCharacteristics>${ext('<zeebe:loopCharacteristics inputCollection="=items" inputElement="item" />')}</bpmn:multiInstanceLoopCharacteristics>`,
          )}
          <bpmn:userTask id="userTask_review">${ext('<zeebe:userTask /><zeebe:assignmentDefinition assignee="demo" /><zeebe:properties><zeebe:property name="a" value="1" /></zeebe:properties>')}</bpmn:userTask>
          <bpmn:receiveTask id="receiveTask_paid" messageRef="message_paid" />`,
          {
            roots: `<bpmn:message id="message_paid" name="paid">${ext('<zeebe:subscription correlationKey="=orderId" />')}</bpmn:message>`,
          },
        ),
      },
      {
        name: 'output mappings on a start event, input mappings on a message throw event',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_received">${ext(IO_MAPPING('<zeebe:output source="=1" target="b" />'))}</bpmn:startEvent>
          <bpmn:intermediateThrowEvent id="event_notified">${ext(IO_MAPPING('<zeebe:input source="=1" target="a" />'))}
            <bpmn:messageEventDefinition id="messageEventDefinition_notified" />
          </bpmn:intermediateThrowEvent>`,
        ),
      },
      {
        name: 'execution listeners on a sequence flow (c8-sequence-flow-no-execution-listeners reports them)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_received" />
          <bpmn:sequenceFlow id="flow_received" sourceRef="startEvent_received" targetRef="endEvent_done">
            ${ext('<zeebe:executionListeners><zeebe:executionListener eventType="start" type="audit" /></zeebe:executionListeners>')}
          </bpmn:sequenceFlow>
          <bpmn:endEvent id="endEvent_done" />`,
        ),
      },
      {
        name: 'misplaced zeebe content in a non-executable process',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_received">${ext(IO_MAPPING('<zeebe:input source="=1" target="a" />'))}</bpmn:startEvent>`,
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="startEvent_received">${ext('<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>')}</bpmn:startEvent>`,
        ),
      },
    ],
    invalid: [
      {
        name: 'zeebe content on hosts that do not read it',
        moddleElement: engineModel(
          'c8',
          `<bpmn:userTask id="userTask_review">${ext(`<zeebe:userTask />${TASK_DEFINITION}`)}</bpmn:userTask>
          ${SERVICE_TASK(`${TASK_DEFINITION}<zeebe:userTask /><zeebe:calledDecision decisionId="d" resultVariable="r" />`)}`,
        ),
        report: [
          NOT_READ(
            'userTask_review',
            'zeebe:taskDefinition on userTask userTask_review has no effect: Camunda 8 reads it on serviceTask, businessRuleTask, scriptTask, sendTask, endEvent, ... only',
            ['extensionElements', 'values', 1],
          ),
          NOT_READ(
            'serviceTask_charge',
            'zeebe:userTask on serviceTask serviceTask_charge has no effect: Camunda 8 reads it on userTask only',
            ['extensionElements', 'values', 1],
          ),
          NOT_READ(
            'serviceTask_charge',
            'zeebe:calledDecision on serviceTask serviceTask_charge has no effect: Camunda 8 reads it on businessRuleTask only',
            ['extensionElements', 'values', 2],
          ),
        ],
      },
      {
        name: 'zeebe:loopCharacteristics on the activity instead of its loop',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            `${TASK_DEFINITION}<zeebe:loopCharacteristics inputCollection="=items" inputElement="item" />`,
            '<bpmn:multiInstanceLoopCharacteristics />',
          ),
        ),
        report: NOT_READ(
          'serviceTask_charge',
          'zeebe:loopCharacteristics on serviceTask serviceTask_charge has no effect: Camunda 8 reads it on multiInstanceLoopCharacteristics only',
          ['extensionElements', 'values', 1],
        ),
      },
      {
        name: 'io mapping on a gateway',
        moddleElement: engineModel(
          'c8',
          `<bpmn:exclusiveGateway id="gateway_approved">${ext(IO_MAPPING('<zeebe:output source="=1" target="a" />'))}</bpmn:exclusiveGateway>`,
        ),
        report: NOT_READ(
          'gateway_approved',
          'zeebe:ioMapping on exclusiveGateway gateway_approved has no effect: Camunda 8 reads it on callActivity, event, receiveTask, serviceTask, businessRuleTask, ... only',
          ['extensionElements', 'values', 0],
        ),
      },
      {
        name: 'a loose zeebe:header outside zeebe:taskHeaders',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(`${TASK_DEFINITION}<zeebe:header key="k" value="v" />`),
        ),
        report: NOT_READ(
          'serviceTask_charge',
          'zeebe:header sits directly in the extension elements of serviceTask serviceTask_charge, but belongs inside zeebe:taskHeaders; Camunda 8 ignores it',
          ['extensionElements', 'values', 1],
        ),
      },
    ],
  });
});
