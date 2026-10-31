import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8CompensationBoundaryNoOutgoingFlowRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-compensation-boundary-no-outgoing-flow', () => {
  const TIMER =
    '<bpmn:timerEventDefinition id="timer_X"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const MESSAGE = '<bpmn:message id="M1" name="M1" />';
  const CONDITION = '<bpmn:condition xsi:type="bpmn:tFormalExpression">= x &gt; 1</bpmn:condition>';
  const chain = (middle: string, extra = '') => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${middle}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />
    ${extra}`;
  const eventSubProcess = (start: string) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:subProcess id="ESP" triggeredByEvent="true">
      ${start}
      <bpmn:sequenceFlow id="ESP_F" sourceRef="ESP_S" targetRef="ESP_E" />
      <bpmn:endEvent id="ESP_E" />
    </bpmn:subProcess>`;
  const COMPENSATION = (
    boundaryDefinition = '<bpmn:compensateEventDefinition id="CB" />',
    throwDefinition = '<bpmn:compensateEventDefinition id="CT" />',
    association = true,
    boundaryFlow = '',
  ) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:serviceTask id="X" />
    <bpmn:boundaryEvent id="B" attachedToRef="X">${boundaryDefinition}</bpmn:boundaryEvent>
    <bpmn:serviceTask id="H" isForCompensation="true" />
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="T" />
    <bpmn:intermediateThrowEvent id="T">${throwDefinition}</bpmn:intermediateThrowEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="T" targetRef="End" />
    <bpmn:endEvent id="End" />
    ${boundaryFlow}
    ${association ? '<bpmn:association id="A" associationDirection="One" sourceRef="B" targetRef="H" />' : ''}`;
  const LINKS = (throwDefinition: string, catchDefinition: string) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:intermediateThrowEvent id="X">${throwDefinition}</bpmn:intermediateThrowEvent>
    <bpmn:intermediateCatchEvent id="C">${catchDefinition}</bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="FC" sourceRef="C" targetRef="End" />
    <bpmn:endEvent id="End" />`;
  const TWO_DEFINITIONS = chain(
    `<bpmn:intermediateCatchEvent id="X">${TIMER}<bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:intermediateCatchEvent>`,
  );

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'an event sub-process with a message start event',
        moddleElement: engineModel(
          'c8',
          eventSubProcess(
            '<bpmn:startEvent id="ESP_S"><bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:startEvent>',
          ),
          { roots: MESSAGE },
        ),
      },
      {
        name: 'conditional events with definition ids',
        moddleElement: engineModel(
          'c8',
          chain(
            `<bpmn:intermediateCatchEvent id="X"><bpmn:conditionalEventDefinition id="CD1">${CONDITION}</bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>`,
          ),
        ),
      },
      { name: 'compensation with definition ids', moddleElement: engineModel('c8', COMPENSATION()) },
      {
        name: 'a link pair with definition ids',
        moddleElement: engineModel(
          'c8',
          LINKS(
            '<bpmn:linkEventDefinition id="L1" name="L" />',
            '<bpmn:linkEventDefinition id="L2" name="L" />',
          ),
        ),
      },
      {
        name: 'a link throw definition without id',
        moddleElement: engineModel(
          'c8',
          LINKS(
            '<bpmn:linkEventDefinition name="L" />',
            '<bpmn:linkEventDefinition id="L2" name="L" />',
          ),
        ),
      },
      {
        name: 'catch and boundary events without definition (camunda-compat element-type)',
        moddleElement: engineModel(
          'c8',
          chain(
            '<bpmn:intermediateCatchEvent id="X" />',
            '<bpmn:task id="Y" /><bpmn:boundaryEvent id="B" attachedToRef="Y" />',
          ),
        ),
      },
      {
        name: 'an event sub-process start with a compensation trigger (camunda-compat element-type)',
        moddleElement: engineModel(
          'c8',
          eventSubProcess(
            '<bpmn:startEvent id="ESP_S"><bpmn:compensateEventDefinition /></bpmn:startEvent>',
          ),
        ),
      },
      {
        name: 'two definitions in a process that is not executable',
        moddleElement: engineModel('c8', TWO_DEFINITIONS, {
          roots: MESSAGE,
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'two definitions inside a transaction',
        moddleElement: engineModel(
          'c8',
          `<bpmn:transaction id="TX"><bpmn:intermediateCatchEvent id="X">${TIMER}<bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:intermediateCatchEvent></bpmn:transaction>`,
          { roots: MESSAGE },
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel('c7', TWO_DEFINITIONS, { roots: MESSAGE }),
      },
    ],
    invalid: [
      {
        name: 'a compensation boundary event with an outgoing sequence flow',
        moddleElement: engineModel(
          'c8',
          COMPENSATION(
            undefined,
            undefined,
            true,
            '<bpmn:sequenceFlow id="F4" sourceRef="B" targetRef="End" />',
          ),
        ),
        report: {
          id: 'B',
          message:
            'Compensation boundary event B has an outgoing sequence flow; Camunda 8 refuses the file',
          path: ['outgoing'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});
