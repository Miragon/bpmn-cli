import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8InputMappingPlacementRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-input-mapping-placement', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const TASK_DEFINITION = '<zeebe:taskDefinition type="charge" />';
  const SERVICE_TASK = (inner: string, loop = '') =>
    `<bpmn:serviceTask id="serviceTask_charge">${ext(inner)}${loop}</bpmn:serviceTask>`;
  const IO_MAPPING = (mappings: string) => `<zeebe:ioMapping>${mappings}</zeebe:ioMapping>`;
  const TIMER =
    '<bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
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
        name: 'input mappings on a start, a boundary, a none throw and a none end event',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_received">${ext(IO_MAPPING('<zeebe:input source="=1" target="a" /><zeebe:output source="=2" target="b" />'))}</bpmn:startEvent>
          ${SERVICE_TASK(TASK_DEFINITION)}
          <bpmn:boundaryEvent id="boundaryEvent_timeout" attachedToRef="serviceTask_charge">${ext(IO_MAPPING('<zeebe:input source="=1" target="c" />'))}${TIMER}</bpmn:boundaryEvent>
          <bpmn:intermediateThrowEvent id="event_charged">${ext(IO_MAPPING('<zeebe:input source="=1" target="d" />'))}</bpmn:intermediateThrowEvent>
          <bpmn:endEvent id="endEvent_done">${ext(IO_MAPPING('<zeebe:input source="=1" />'))}</bpmn:endEvent>`,
        ),
        report: [
          NOT_READ(
            'startEvent_received',
            'The input mapping to a on startEvent startEvent_received has no effect: Camunda 8 ignores input mappings on start events (output mappings work there)',
            ['extensionElements', 'values', 0, 'inputParameters', 0],
          ),
          NOT_READ(
            'boundaryEvent_timeout',
            'The input mapping to c on boundaryEvent:timer boundaryEvent_timeout has no effect: Camunda 8 ignores input mappings on boundary events (output mappings work there)',
            ['extensionElements', 'values', 0, 'inputParameters', 0],
          ),
          NOT_READ(
            'event_charged',
            'The input mapping to d on intermediateThrowEvent event_charged has no effect: Camunda 8 ignores input mappings on none intermediate throw events (output mappings work there)',
            ['extensionElements', 'values', 0, 'inputParameters', 0],
          ),
          NOT_READ(
            'endEvent_done',
            'The input mapping on endEvent endEvent_done has no effect: Camunda 8 ignores input mappings on none end events (output mappings work there)',
            ['extensionElements', 'values', 0, 'inputParameters', 0],
          ),
        ],
      },
    ],
  });
});
