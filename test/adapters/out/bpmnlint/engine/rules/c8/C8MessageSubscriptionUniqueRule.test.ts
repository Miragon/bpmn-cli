import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8MessageSubscriptionUniqueRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-message-subscription-unique', () => {
  const MSG = (id = 'M1', name = 'M1') =>
    `<bpmn:message id="${id}" name="${name}"><bpmn:extensionElements><zeebe:subscription correlationKey="=orderId" /></bpmn:extensionElements></bpmn:message>`;
  const MESSAGE_DEFINITION = (id: string, ref = 'M1') =>
    `<bpmn:messageEventDefinition id="${id}" messageRef="${ref}" />`;
  const toEnd = (start = '') => `
    <bpmn:startEvent id="Start">${start}</bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End" />`;
  const boundaries = (host: string, ...definitions: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${host}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />
    ${definitions.map((definition, index) => `<bpmn:boundaryEvent id="B${index}" attachedToRef="X">${definition}</bpmn:boundaryEvent>`).join('\n')}`;
  const eventSubProcess = (id: string, start: string) => `
    <bpmn:subProcess id="${id}" triggeredByEvent="true">
      <bpmn:startEvent id="${id}_S">${start}</bpmn:startEvent>
      <bpmn:sequenceFlow id="${id}_F" sourceRef="${id}_S" targetRef="${id}_E" />
      <bpmn:endEvent id="${id}_E" />
    </bpmn:subProcess>`;
  const gatewayTo = (...refs: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:eventBasedGateway id="G" />
    ${refs
      .map(
        (ref, index) => `
    <bpmn:sequenceFlow id="G${index}" sourceRef="G" targetRef="T${index}" />
    <bpmn:intermediateCatchEvent id="T${index}">${MESSAGE_DEFINITION(`MD${index}`, ref)}</bpmn:intermediateCatchEvent>`,
      )
      .join('')}`;
  const FEEL_START = toEnd(MESSAGE_DEFINITION('MD'));
  const TWO_BOUNDARIES = boundaries(
    '<bpmn:serviceTask id="X" />',
    MESSAGE_DEFINITION('MD0'),
    MESSAGE_DEFINITION('MD1'),
  );

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a process start event with a static message name',
        moddleElement: engineModel('c8', FEEL_START, { roots: MSG() }),
      },
      {
        name: 'a FEEL message name on an event sub-process start',
        moddleElement: engineModel('c8', toEnd() + eventSubProcess('ESP', MESSAGE_DEFINITION('MD')), {
          roots: MSG('M1', '=name'),
        }),
      },
      {
        name: 'two boundary events with different messages',
        moddleElement: engineModel(
          'c8',
          boundaries(
            '<bpmn:serviceTask id="X" />',
            MESSAGE_DEFINITION('MD0'),
            MESSAGE_DEFINITION('MD1', 'M2'),
          ),
          { roots: MSG() + MSG('M2', 'M2') },
        ),
      },
      {
        name: 'two boundary events with one FEEL message name',
        moddleElement: engineModel('c8', TWO_BOUNDARIES, { roots: MSG('M1', '=name') }),
      },
      {
        name: 'a message without name (camunda-compat message-reference)',
        moddleElement: engineModel('c8', boundaries('<bpmn:receiveTask id="X" messageRef="M1" />'), {
          roots: '<bpmn:message id="M1" />',
        }),
      },
      {
        name: 'two boundary events with one message in a process that is not executable',
        moddleElement: engineModel('c8', TWO_BOUNDARIES, {
          roots: MSG(),
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel('c7', TWO_BOUNDARIES, {
          roots: '<bpmn:message id="M1" name="M1" />',
        }),
      },
    ],
    invalid: [
      {
        name: 'two message boundary events with one name',
        moddleElement: engineModel('c8', TWO_BOUNDARIES, { roots: MSG() }),
        report: {
          id: 'B1',
          path: ['eventDefinitions', 0, 'messageRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
          message:
            'boundaryEvent:message B1 waits for the message "M1" like boundaryEvent:message B0 on X; Camunda 8 refuses one message name twice there',
        },
      },
      {
        name: 'a receive task and its boundary event with one message',
        moddleElement: engineModel(
          'c8',
          boundaries('<bpmn:receiveTask id="X" messageRef="M1" />', MESSAGE_DEFINITION('MD0')),
          { roots: MSG() },
        ),
        report: {
          id: 'B0',
          path: ['eventDefinitions', 0, 'messageRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
          message:
            'boundaryEvent:message B0 waits for the message "M1" like receiveTask X on X; Camunda 8 refuses one message name twice there',
        },
      },
      {
        name: 'two start events with one message name',
        moddleElement: engineModel(
          'c8',
          `${toEnd(MESSAGE_DEFINITION('MD'))}<bpmn:startEvent id="S2">${MESSAGE_DEFINITION('MD2', 'M2')}</bpmn:startEvent><bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />`,
          { roots: MSG('M1', 'same') + MSG('M2', 'same') },
        ),
        report: {
          id: 'S2',
          message:
            'startEvent:message S2 waits for the message "same" like startEvent:message Start in process process_test; Camunda 8 refuses one message name twice there',
          path: ['eventDefinitions', 0, 'messageRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'two event sub-processes with one message',
        moddleElement: engineModel(
          'c8',
          toEnd() +
            eventSubProcess('ESP', MESSAGE_DEFINITION('MD')) +
            eventSubProcess('ESP2', MESSAGE_DEFINITION('MD2')),
          { roots: MSG() },
        ),
        report: {
          id: 'ESP2_S',
          message:
            'startEvent:message ESP2_S waits for the message "M1" like startEvent:message ESP_S in the event sub-processes of process_test; Camunda 8 refuses one message name twice there',
          path: ['eventDefinitions', 0, 'messageRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'an event-based gateway with one message on two branches',
        moddleElement: engineModel('c8', gatewayTo('M1', 'M1'), { roots: MSG() }),
        report: {
          id: 'T1',
          message:
            'intermediateCatchEvent:message T1 waits for the message "M1" like intermediateCatchEvent:message T0 after event-based gateway G; Camunda 8 refuses one message name twice there',
          path: ['eventDefinitions', 0, 'messageRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'two message boundary events with one name inside a sub-process',
        moddleElement: engineModel(
          'c8',
          `<bpmn:subProcess id="Sub">${TWO_BOUNDARIES}</bpmn:subProcess>`,
          { roots: MSG() },
        ),
        report: {
          id: 'B1',
          message:
            'boundaryEvent:message B1 waits for the message "M1" like boundaryEvent:message B0 on X; Camunda 8 refuses one message name twice there',
          path: ['eventDefinitions', 0, 'messageRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
    ],
  });
});
