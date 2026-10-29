import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7MessageNeedsNameRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-message-needs-name', () => {
  const ROOTS =
    '<bpmn:message id="M" name="Pay" /><bpmn:message id="M2" name="Pay2" /><bpmn:message id="M3" name="Pay" /><bpmn:message id="MN" />';
  const TIMER =
    '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const message = (ref?: string) =>
    `<bpmn:messageEventDefinition${ref ? ` messageRef="${ref}"` : ''} />`;
  const START = '<bpmn:startEvent id="Start" />';
  const catchEvent = (defs: string) =>
    `${START}<bpmn:intermediateCatchEvent id="X">${defs}</bpmn:intermediateCatchEvent>`;
  const boundary = (id: string, host: string, defs: string) =>
    `<bpmn:boundaryEvent id="${id}" attachedToRef="${host}" cancelActivity="false">${defs}</bpmn:boundaryEvent>`;
  const eventSub = (id: string, defs: string) =>
    `<bpmn:subProcess id="${id}" triggeredByEvent="true"><bpmn:startEvent id="${id}_S" isInterrupting="false">${defs}</bpmn:startEvent></bpmn:subProcess>`;
  const subProcess = (inner: string) =>
    `<bpmn:subProcess id="Sub"><bpmn:startEvent id="Sub_S" />${inner}</bpmn:subProcess>`;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a catch event with a named message',
        moddleElement: engineModel('c7', catchEvent(message('M')), { roots: ROOTS }),
      },
      {
        name: 'a receive task without message',
        moddleElement: engineModel('c7', `${START}<bpmn:receiveTask id="X" />`),
      },
      {
        name: 'a message throw event without message (an implementation question)',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:intermediateThrowEvent id="X"><bpmn:messageEventDefinition camunda:expression="\${true}" /></bpmn:intermediateThrowEvent>`,
        ),
      },
      {
        name: 'timer + a message without messageRef: the ignored message is not parsed',
        moddleElement: engineModel('c7', catchEvent(TIMER + message())),
      },
      {
        name: 'separate scopes: start and event sub-process, start and boundary, multi-instance receive task and its boundary',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="Start">${message('M')}</bpmn:startEvent>
          <bpmn:receiveTask id="T" messageRef="M"><bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>2</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics></bpmn:receiveTask>
          ${boundary('B1', 'T', message('M'))}
          <bpmn:userTask id="U" />${boundary('B2', 'U', message('M3'))}
          ${eventSub('ES', message('M'))}`,
          { roots: ROOTS },
        ),
      },
      {
        name: 'a catch event without message in a non-executable process',
        moddleElement: engineModel('c7', catchEvent(message()), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a catch event without message in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${catchEvent(message())}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', catchEvent(message('MN')), { roots: ROOTS }),
      },
    ],
    invalid: [
      {
        name: 'message without name',
        moddleElement: engineModel('c7', catchEvent(message('MN')), { roots: ROOTS }),
        report: {
          id: 'X',
          message: 'Message MN of intermediateCatchEvent:message X has no name; the engines refuse the file',
          path: ['eventDefinitions', 0, 'messageRef', 'name'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'receive task whose message has no name',
        moddleElement: engineModel('c7', `${START}<bpmn:receiveTask id="X" messageRef="MN" />`, {
          roots: ROOTS,
        }),
        report: {
          id: 'X',
          message: 'Message MN of receive task X has no name; the engines refuse the file',
          path: ['messageRef', 'name'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});
