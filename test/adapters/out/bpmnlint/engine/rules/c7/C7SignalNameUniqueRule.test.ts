import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7SignalNameUniqueRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-signal-name-unique', () => {
  const ROOTS = '<bpmn:signal id="Sig" name="Go" /><bpmn:signal id="SN" />';
  const signal = (ref?: string) =>
    `<bpmn:signalEventDefinition${ref ? ` signalRef="${ref}"` : ''} />`;
  const START = '<bpmn:startEvent id="Start" />';
  const catchEvent = (defs: string) =>
    `${START}<bpmn:intermediateCatchEvent id="X">${defs}</bpmn:intermediateCatchEvent>`;
  const boundary = (id: string, host: string, defs: string) =>
    `<bpmn:boundaryEvent id="${id}" attachedToRef="${host}" cancelActivity="false">${defs}</bpmn:boundaryEvent>`;
  const eventSub = (id: string, defs: string) =>
    `<bpmn:subProcess id="${id}" triggeredByEvent="true"><bpmn:startEvent id="${id}_S" isInterrupting="false">${defs}</bpmn:startEvent></bpmn:subProcess>`;
  const MESSAGE_EXPRESSION = '<bpmn:messageEventDefinition camunda:expression="${true}" />';
  const TWO_NAMED_S = '<bpmn:signal id="Sig1" name="S" /><bpmn:signal id="Sig2" name="S" />';
  const duplicate = (id: string, kind: string, first: string) => ({
    id,
    message: `${kind}:signal ${id} waits for signal "Go" like ${first} in the same scope; the engines refuse two signal subscriptions with one name`,
    path: ['eventDefinitions', 0, 'signalRef'],
    type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
  });

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a catch event with a named signal',
        moddleElement: engineModel('c7', catchEvent(signal('Sig')), { roots: ROOTS }),
      },
      {
        name: 'end event: the message acts, the ignored signal without signalRef is not parsed',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:endEvent id="End">${MESSAGE_EXPRESSION}${signal()}</bpmn:endEvent>`,
        ),
      },
      {
        name: 'separate scopes: start and event sub-process, start and boundary',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="Start">${signal('Sig')}</bpmn:startEvent><bpmn:userTask id="U" />${boundary('B2', 'U', signal('Sig'))}${eventSub('ES', signal('Sig'))}`,
          { roots: ROOTS },
        ),
      },
      {
        name: 'two root signals with one name in a file without an executable process',
        moddleElement: engineModel('c7', START, {
          roots: TWO_NAMED_S,
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a catch event without signal in a non-executable process',
        moddleElement: engineModel('c7', catchEvent(signal()), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a catch event without signal in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${catchEvent(signal())}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', catchEvent(signal('SN')), { roots: ROOTS + TWO_NAMED_S }),
      },
    ],
    invalid: [
      {
        name: 'two root signals with one name',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:intermediateThrowEvent id="X">${signal('Sig1')}</bpmn:intermediateThrowEvent>`,
          { roots: TWO_NAMED_S },
        ),
        report: {
          id: 'Sig2',
          message:
            'Signals Sig1 and Sig2 are both named "S"; the engines refuse duplicate signal names',
          path: ['name'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
    ],
  });
});
