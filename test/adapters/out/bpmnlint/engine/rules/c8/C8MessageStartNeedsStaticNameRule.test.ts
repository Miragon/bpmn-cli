import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8MessageStartNeedsStaticNameRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-message-start-needs-static-name', () => {
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
        name: 'a message start event with a FEEL name',
        moddleElement: engineModel('c8', FEEL_START, { roots: MSG('M1', '=n') }),
        report: {
          id: 'Start',
          message:
            'Start event Start catches the message "=n", a FEEL expression; Camunda 8 needs a static message name on process start events and refuses the file',
          path: ['eventDefinitions', 0, 'messageRef', 'name'],
          type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED,
        },
      },
    ],
  });
});
