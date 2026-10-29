import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7EventsRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-message', () => {
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

  const duplicate = (id: string, first: string, path: (string | number)[]) => ({
    id,
    message: `${id.startsWith('B') ? 'boundaryEvent' : 'startEvent'}:message ${id} waits for message "Pay" like ${first} in the same scope; the engines refuse two message subscriptions with one name`,
    path,
    type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
  });

  verifyEngineRule('c7-message', rule, {
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
        name: 'message catch event without message',
        moddleElement: engineModel('c7', catchEvent(message())),
        report: {
          id: 'X',
          message: 'intermediateCatchEvent:message X has no message; the engines refuse the file',
          path: ['eventDefinitions', 0, 'messageRef'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
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
      {
        name: 'event sub-process start: a message without messageRef acts',
        moddleElement: engineModel('c7', `${START}${eventSub('ES', TIMER + message())}`),
        report: {
          id: 'ES_S',
          message: 'startEvent:timer ES_S has no message; the engines refuse the file',
          path: ['eventDefinitions', 1, 'messageRef'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'two message start events with one message name',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="S1">${message('M')}</bpmn:startEvent><bpmn:startEvent id="S2">${message('M3')}</bpmn:startEvent>`,
          { roots: ROOTS },
        ),
        report: duplicate('S2', 'S1', ['eventDefinitions', 0, 'messageRef']),
      },
      {
        name: 'boundary event on a sub-process and an event sub-process in it, one message',
        moddleElement: engineModel(
          'c7',
          `${START}${subProcess(eventSub('ES', message('M')))}${boundary('B1', 'Sub', message('M'))}`,
          { roots: ROOTS },
        ),
        report: duplicate('B1', 'ES_S', ['eventDefinitions', 0, 'messageRef']),
      },
      {
        name: 'receive task and a boundary event on it, one message name',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:receiveTask id="T" messageRef="M" />${boundary('B1', 'T', message('M3'))}`,
          { roots: ROOTS },
        ),
        report: duplicate('B1', 'T', ['eventDefinitions', 0, 'messageRef']),
      },
    ],
  });
});

describe('c7-signal', () => {
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

  verifyEngineRule('c7-signal', rule, {
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
        name: 'signal catch event without signal',
        moddleElement: engineModel('c7', catchEvent(signal())),
        report: {
          id: 'X',
          message: 'intermediateCatchEvent:signal X has no signal; the engines refuse the file',
          path: ['eventDefinitions', 0, 'signalRef'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'signal without name',
        moddleElement: engineModel('c7', catchEvent(signal('SN')), { roots: ROOTS }),
        report: {
          id: 'X',
          message: 'Signal SN of intermediateCatchEvent:signal X has no name; the engines refuse the file',
          path: ['eventDefinitions', 0, 'signalRef', 'name'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'intermediate throw event: the acting signal without signalRef is refused',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:intermediateThrowEvent id="T">${signal()}${MESSAGE_EXPRESSION}</bpmn:intermediateThrowEvent>`,
        ),
        report: {
          id: 'T',
          message: 'intermediateThrowEvent:signal T has no signal; the engines refuse the file',
          path: ['eventDefinitions', 0, 'signalRef'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
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
      {
        name: 'two signal start events on one signal',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="Start">${signal('Sig')}</bpmn:startEvent><bpmn:startEvent id="S2">${signal('Sig')}</bpmn:startEvent>`,
          { roots: ROOTS },
        ),
        report: duplicate('S2', 'startEvent', 'Start'),
      },
      {
        name: 'two signal boundary events on one host',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:userTask id="T" />${boundary('B1', 'T', signal('Sig'))}${boundary('B2', 'T', signal('Sig'))}`,
          { roots: ROOTS },
        ),
        report: duplicate('B2', 'boundaryEvent', 'B1'),
      },
      {
        name: 'two event sub-processes on one signal',
        moddleElement: engineModel(
          'c7',
          `${START}${eventSub('ES1', signal('Sig'))}${eventSub('ES2', signal('Sig'))}`,
          { roots: ROOTS },
        ),
        report: duplicate('ES2_S', 'startEvent', 'ES1_S'),
      },
      {
        name: 'boundary event on a sub-process and an event sub-process in it, one signal',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="Sub"><bpmn:startEvent id="Sub_S" />${eventSub('ES', signal('Sig'))}</bpmn:subProcess>${boundary('B1', 'Sub', signal('Sig'))}`,
          { roots: ROOTS },
        ),
        report: duplicate('B1', 'boundaryEvent', 'ES_S'),
      },
    ],
  });
});

describe('c7-error', () => {
  const ERRORS =
    '<bpmn:error id="Err" name="Err" /><bpmn:error id="ErrBlank" name="Blank" errorCode=" " /><bpmn:error id="ErrCoded" name="Coded" errorCode="E1" />';
  const START = '<bpmn:startEvent id="Start" />';
  const errorEnd = (definition: string) =>
    `${START}<bpmn:endEvent id="End">${definition}</bpmn:endEvent>`;
  const error = (ref?: string) => `<bpmn:errorEventDefinition${ref ? ` errorRef="${ref}"` : ''} />`;

  verifyEngineRule('c7-error', rule, {
    valid: [
      {
        name: 'an error end event whose error has an errorCode',
        moddleElement: engineModel('c7', errorEnd(error('ErrCoded')), { roots: ERRORS }),
      },
      {
        name: 'an error boundary event without errorCode catches everything',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:userTask id="X" /><bpmn:boundaryEvent id="B" attachedToRef="X">${error('Err')}</bpmn:boundaryEvent>`,
          { roots: ERRORS },
        ),
      },
      {
        name: 'an error end event without errorCode in a non-executable process',
        moddleElement: engineModel('c7', errorEnd(error('Err')), {
          roots: ERRORS,
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'an error end event without errorRef in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${errorEnd(error())}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', errorEnd(error()), { roots: ERRORS }),
      },
    ],
    invalid: [
      {
        name: 'an error end event whose error has no errorCode',
        moddleElement: engineModel('c7', errorEnd(error('Err')), { roots: ERRORS }),
        report: {
          id: 'End',
          message: 'Error Err thrown by endEvent:error End has no errorCode; the engines refuse the file',
          path: ['eventDefinitions', 0, 'errorRef', 'errorCode'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'an error end event whose errorCode is blank',
        moddleElement: engineModel('c7', errorEnd(error('ErrBlank')), { roots: ERRORS }),
        report: {
          id: 'End',
          message:
            'Error ErrBlank thrown by endEvent:error End has no errorCode; the engines refuse the file',
          path: ['eventDefinitions', 0, 'errorRef', 'errorCode'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'an error end event without errorRef',
        moddleElement: engineModel('c7', errorEnd(error())),
        report: {
          id: 'End',
          message: 'endEvent:error End throws no error (no errorRef); the engines refuse the file',
          path: ['eventDefinitions', 0, 'errorRef'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});

describe('c7-escalation', () => {
  const ESCALATIONS =
    '<bpmn:escalation id="Esc" name="Esc" /><bpmn:escalation id="EscCoded" name="Coded" escalationCode="E" />';
  const START = '<bpmn:startEvent id="Start" />';
  const escalation = (ref?: string) =>
    `<bpmn:escalationEventDefinition${ref ? ` escalationRef="${ref}"` : ''} />`;
  const escalationEnd = (definition: string) =>
    `${START}<bpmn:endEvent id="End">${definition}</bpmn:endEvent>`;
  const onHost = (host: string) =>
    `${START}${host}<bpmn:boundaryEvent id="B" attachedToRef="X">${escalation('EscCoded')}</bpmn:boundaryEvent>`;
  const SERVICE_TASK = '<bpmn:serviceTask id="X" camunda:expression="${true}" />';

  verifyEngineRule('c7-escalation', rule, {
    valid: [
      {
        name: 'an escalation end event whose escalation has an escalationCode',
        moddleElement: engineModel('c7', escalationEnd(escalation('EscCoded')), {
          roots: ESCALATIONS,
        }),
      },
      {
        name: 'an escalation boundary event on a sub-process',
        moddleElement: engineModel('c7', onHost('<bpmn:subProcess id="X" />'), {
          roots: ESCALATIONS,
        }),
      },
      {
        name: 'an escalation boundary event on a call activity',
        moddleElement: engineModel(
          'c7',
          onHost('<bpmn:callActivity id="X" calledElement="other" />'),
          {
            roots: ESCALATIONS,
          },
        ),
      },
      {
        name: 'an escalation boundary event on a user task',
        moddleElement: engineModel('c7', onHost('<bpmn:userTask id="X" />'), { roots: ESCALATIONS }),
      },
      {
        name: 'an escalation boundary event on a service task in a non-executable process',
        moddleElement: engineModel('c7', onHost(SERVICE_TASK), {
          roots: ESCALATIONS,
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'an escalation end event without escalationRef in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${escalationEnd(escalation())}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', escalationEnd(escalation('Esc')), { roots: ESCALATIONS }),
      },
    ],
    invalid: [
      {
        name: 'an escalation end event without escalationCode',
        moddleElement: engineModel('c7', escalationEnd(escalation('Esc')), { roots: ESCALATIONS }),
        report: {
          id: 'End',
          message:
            'Escalation Esc thrown by endEvent:escalation End has no escalationCode; the engines refuse the file',
          path: ['eventDefinitions', 0, 'escalationRef', 'escalationCode'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'an escalation throw event without escalationRef',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:intermediateThrowEvent id="T">${escalation()}</bpmn:intermediateThrowEvent>`,
        ),
        report: {
          id: 'T',
          message:
            'intermediateThrowEvent:escalation T throws no escalation (no escalationRef); the engines refuse the file',
          path: ['eventDefinitions', 0, 'escalationRef'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'an escalation boundary event on a service task',
        moddleElement: engineModel('c7', onHost(SERVICE_TASK), { roots: ESCALATIONS }),
        report: {
          id: 'B',
          message:
            'Escalation boundary event B is attached to serviceTask X; the engines allow it only on sub-processes, call activities and user tasks and refuse the file',
          path: ['attachedToRef'],
          type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c7-event-definition', () => {
  const ROOTS = '<bpmn:message id="M" name="Pay" />';
  const TIMER =
    '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const EMPTY_TIMER = '<bpmn:timerEventDefinition id="TDef" />';
  const TWO_TIMES =
    '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDate xsi:type="bpmn:tFormalExpression">2030-01-01T00:00:00Z</bpmn:timeDate><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const COND_NONE = '<bpmn:conditionalEventDefinition id="CDef" />';
  const MSG = '<bpmn:messageEventDefinition id="MDef" messageRef="M" />';
  const START = '<bpmn:startEvent id="Start" />';
  const catchWith = (defs: string) =>
    `${START}<bpmn:intermediateCatchEvent id="W">${defs}</bpmn:intermediateCatchEvent>`;
  const eventSubStart = (defs: string) =>
    `${START}<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="W" isInterrupting="false">${defs}</bpmn:startEvent></bpmn:subProcess>`;
  const flow = (id: string, source: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;

  /** a compensation throw event Th with activityRef `ref`; Host at process level, Inner inside sub-process Sub */
  const compensation = (ref: string, where: 'process' | 'sub' | 'end' | 'eventSub' = 'process') => {
    const thr = `<bpmn:intermediateThrowEvent id="Th"><bpmn:compensateEventDefinition activityRef="${ref}" /></bpmn:intermediateThrowEvent>`;
    const sub = `<bpmn:subProcess id="Sub"><bpmn:startEvent id="SS" /><bpmn:userTask id="Inner" />${where === 'sub' ? thr : ''}</bpmn:subProcess>`;
    const end =
      where === 'end'
        ? `<bpmn:endEvent id="End"><bpmn:compensateEventDefinition activityRef="${ref}" /></bpmn:endEvent>`
        : '<bpmn:endEvent id="End" />';
    const eventSub =
      where === 'eventSub'
        ? `<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ESS" isInterrupting="false">${MSG}</bpmn:startEvent>${thr}</bpmn:subProcess>`
        : '';
    return engineModel(
      'c7',
      `${START}<bpmn:userTask id="Host" />${sub}${where === 'process' ? thr : ''}${end}${eventSub}${flow('F0', 'Start', 'Host')}`,
      { roots: ROOTS },
    );
  };

  const schemaCondition = (id: string, subject: string, index: number) => ({
    id,
    message: `${subject} has no condition element, which the BPMN schema requires; the engines refuse the file`,
    path: ['eventDefinitions', index, 'condition'],
    type: ERROR_TYPES.PROPERTY_REQUIRED,
  });
  const compensationReport = (id: string, named: string) => ({
    id,
    message: `Compensation event ${id} names activityRef ${named}; the engines compensate only activities of the throw event's own (sub-)process and refuse the file`,
    path: ['eventDefinitions', 0, 'activityRef'],
    type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
  });

  verifyEngineRule('c7-event-definition', rule, {
    valid: [
      {
        name: 'a timer with a duration and a conditional event with a condition',
        moddleElement: engineModel(
          'c7',
          catchWith(TIMER) +
            '<bpmn:intermediateCatchEvent id="C"><bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression">${ready}</bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>',
        ),
      },
      {
        name: 'event sub-process start: the message acts, an empty timer is ignored',
        moddleElement: engineModel('c7', eventSubStart(MSG + EMPTY_TIMER), { roots: ROOTS }),
      },
      {
        name: 'a timer without value in a non-executable process',
        moddleElement: engineModel('c7', catchWith(EMPTY_TIMER), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a timer without value in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${catchWith(EMPTY_TIMER)}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'compensation of the sub-process from its own scope',
        moddleElement: compensation('Sub'),
      },
      {
        name: 'compensation of an activity of the own scope',
        moddleElement: compensation('Host'),
      },
      {
        name: 'compensation from an event sub-process of an activity of its parent scope',
        moddleElement: compensation('Host', 'eventSub'),
      },
      {
        name: 'compensation inside a sub-process of its own activity',
        moddleElement: compensation('Inner', 'sub'),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          catchWith(COND_NONE) +
            `<bpmn:intermediateCatchEvent id="T">${TWO_TIMES}</bpmn:intermediateCatchEvent>`,
        ),
      },
    ],
    invalid: [
      {
        name: 'timer without value',
        moddleElement: engineModel('c7', catchWith(EMPTY_TIMER)),
        report: {
          id: 'W',
          message:
            'Timer of intermediateCatchEvent:timer W has no date, cycle or duration; the engines refuse the file',
          path: ['eventDefinitions', 0],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'message + an empty timer: the acting timer is parsed',
        moddleElement: engineModel('c7', catchWith(MSG + EMPTY_TIMER), { roots: ROOTS }),
        report: {
          id: 'W',
          message:
            'Timer of intermediateCatchEvent:message W has no date, cycle or duration; the engines refuse the file',
          path: ['eventDefinitions', 1],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'conditional event without a condition element',
        moddleElement: engineModel('c7', catchWith(COND_NONE)),
        report: schemaCondition('W', 'Conditional event W', 0),
      },
      {
        name: 'timer + conditional without condition (intermediate catch)',
        moddleElement: engineModel('c7', catchWith(TIMER + COND_NONE)),
        report: schemaCondition('W', 'The conditional definition of intermediateCatchEvent:timer W', 1),
      },
      {
        name: 'conditional without condition + timer (intermediate catch, the timer acts)',
        moddleElement: engineModel('c7', catchWith(COND_NONE + TIMER)),
        report: schemaCondition('W', 'The conditional definition of intermediateCatchEvent:conditional W', 0),
      },
      {
        name: 'timer + conditional without condition (boundary event)',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:userTask id="U" /><bpmn:boundaryEvent id="W" attachedToRef="U">${TIMER}${COND_NONE}</bpmn:boundaryEvent>`,
        ),
        report: schemaCondition('W', 'The conditional definition of boundaryEvent:timer W', 1),
      },
      {
        name: 'timer + conditional without condition (process start event)',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="W">${TIMER}${COND_NONE}</bpmn:startEvent>`,
        ),
        report: schemaCondition('W', 'The conditional definition of startEvent:timer W', 1),
      },
      {
        name: 'conditional without condition in a non-executable process',
        moddleElement: engineModel('c7', catchWith(COND_NONE).replace('id="W"', 'id="O_W"'), {
          processAttributes: 'isExecutable="false"',
        }),
        report: schemaCondition('O_W', 'Conditional event O_W', 0),
      },
      {
        name: 'timer with timeDate and timeDuration',
        moddleElement: engineModel('c7', catchWith(TWO_TIMES)),
        report: {
          id: 'W',
          message:
            'Timer event W has timeDate and timeDuration; the BPMN schema allows only one of timeDate, timeCycle and timeDuration, and the engines refuse the file',
          path: ['eventDefinitions', 0],
          type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
        },
      },
      {
        name: 'event sub-process start: message acts, an ignored timer with two time elements',
        moddleElement: engineModel('c7', eventSubStart(MSG + TWO_TIMES), { roots: ROOTS }),
        report: {
          id: 'W',
          message:
            'The timer definition of startEvent:message W has timeDate and timeDuration; the BPMN schema allows only one of timeDate, timeCycle and timeDuration, and the engines refuse the file',
          path: ['eventDefinitions', 1],
          type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
        },
      },
      {
        name: 'compensation of an activity inside a sub-process from the process',
        moddleElement: compensation('Inner'),
        report: compensationReport('Th', 'userTask Inner, which is not in process_test'),
      },
      {
        name: 'compensation end event naming an activity inside a sub-process',
        moddleElement: compensation('Inner', 'end'),
        report: compensationReport('End', 'userTask Inner, which is not in process_test'),
      },
      {
        name: 'compensation of a process activity from inside a sub-process',
        moddleElement: compensation('Host', 'sub'),
        report: compensationReport('Th', 'userTask Host, which is not in Sub'),
      },
      {
        name: 'compensation naming a sequence flow',
        moddleElement: compensation('F0'),
        report: compensationReport('Th', 'F0, which is not a flow node'),
      },
    ],
  });
});

describe('c7-link-event', () => {
  const TIMER =
    '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const link = (name?: string) =>
    `<bpmn:linkEventDefinition${name === undefined ? '' : ` name="${name}"`} />`;
  const linkThrow = (id: string, name?: string) =>
    `<bpmn:intermediateThrowEvent id="${id}">${link(name)}</bpmn:intermediateThrowEvent>`;
  const linkCatch = (id: string, name?: string) =>
    `<bpmn:intermediateCatchEvent id="${id}">${link(name)}</bpmn:intermediateCatchEvent>`;
  const flow = (id: string, source: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;
  const START = '<bpmn:startEvent id="Start" />';
  const reachedThrow = (id: string, name: string) =>
    `${START}${flow(`F_${id}`, 'Start', id)}${linkThrow(id, name)}`;
  const subProcess = (id: string, inner: string) =>
    `<bpmn:subProcess id="${id}"><bpmn:startEvent id="${id}_S" />${inner}</bpmn:subProcess>`;

  const target = (id: string, missing: string, scope = 'process_test') => ({
    id,
    message: `Link throw event ${id} jumps to "L1", but ${missing}; the engines resolve links within one (sub-)process (${scope}) and refuse the file`,
    path: ['eventDefinitions', 0, 'name'],
    type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
  });
  const duplicateCatch = (first: string, id: string) => ({
    id,
    message: `Link catch events ${first} and ${id} are both named "L1"; the engines refuse two link catch events with one name in a process (sub-processes included)`,
    path: ['eventDefinitions', 0, 'name'],
    type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
  });
  const noName = (id: string, subject: string, index = 0) => ({
    id,
    message: `${subject} has no link name, which the BPMN schema requires; the engines refuse the file`,
    path: ['eventDefinitions', index, 'name'],
    type: ERROR_TYPES.PROPERTY_REQUIRED,
  });

  verifyEngineRule('c7-link-event', rule, {
    valid: [
      {
        name: 'a link pair, an unconnected throw event, a catch event without throw, an empty name',
        moddleElement: engineModel(
          'c7',
          `${reachedThrow('L', 'L1')}${linkCatch('C1', 'L1')}${linkThrow('Lonely', 'Nowhere')}${linkCatch('C2', 'L2')}${linkCatch('C3', '')}`,
        ),
      },
      {
        name: 'duplicate catch names and an unmatched throw in a non-executable process',
        moddleElement: engineModel(
          'c7',
          `${reachedThrow('L', 'Nowhere')}${linkCatch('C1', 'L1')}${linkCatch('C2', 'L1')}`,
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'duplicate catch names and an unmatched throw in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `${linkCatch('C1', 'L1')}<bpmn:adHocSubProcess id="AH">${reachedThrow('L', 'Nowhere')}${linkCatch('C2', 'L1')}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', `${reachedThrow('L', 'Nowhere')}${linkCatch('C1')}`),
      },
    ],
    invalid: [
      {
        name: 'a link throw event without a catch event',
        moddleElement: engineModel('c7', reachedThrow('L', 'L1')),
        report: target('L', 'no link catch event has that name'),
      },
      {
        name: 'a link throw event in the process, its catch event in a sub-process',
        moddleElement: engineModel(
          'c7',
          `${reachedThrow('L', 'L1')}${subProcess('Sub', linkCatch('C1', 'L1'))}`,
        ),
        report: target('L', 'the catch event of that name (C1) is in another scope'),
      },
      {
        name: 'a link throw event in a sub-process, its catch event in the process',
        moddleElement: engineModel(
          'c7',
          `${START}${linkCatch('C1', 'L1')}${subProcess('Sub', `${flow('F_L', 'Sub_S', 'L')}${linkThrow('L', 'L1')}`)}`,
        ),
        report: target('L', 'the catch event of that name (C1) is in another scope', 'Sub'),
      },
      {
        name: 'two link catch events with one name',
        moddleElement: engineModel(
          'c7',
          `${reachedThrow('L', 'L1')}${linkCatch('C1', 'L1')}${linkCatch('C2', 'L1')}`,
        ),
        report: duplicateCatch('C1', 'C2'),
      },
      {
        name: 'link catch events with one name in two sub-processes',
        moddleElement: engineModel(
          'c7',
          `${START}${subProcess('Sub1', linkCatch('C1', 'L1'))}${subProcess('Sub2', linkCatch('C2', 'L1'))}`,
        ),
        report: duplicateCatch('C1', 'C2'),
      },
      {
        name: 'a link catch event without a name',
        moddleElement: engineModel('c7', `${START}${linkCatch('C1')}`),
        report: noName('C1', 'Link event C1'),
      },
      {
        name: 'timer + link without name (intermediate catch)',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:intermediateCatchEvent id="W">${TIMER}<bpmn:linkEventDefinition id="LDef" /></bpmn:intermediateCatchEvent>`,
        ),
        report: noName('W', 'The link definition of intermediateCatchEvent:timer W', 1),
      },
      {
        name: 'a link without name in a non-executable process',
        moddleElement: engineModel('c7', `${START}${linkThrow('O_W')}`, {
          processAttributes: 'isExecutable="false"',
        }),
        report: noName('O_W', 'Link event O_W'),
      },
    ],
  });
});
