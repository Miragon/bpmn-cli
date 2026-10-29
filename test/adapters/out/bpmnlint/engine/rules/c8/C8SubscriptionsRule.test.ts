import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8SubscriptionsRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-message', () => {
  /** a message with a name and a zeebe:subscription */
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

  verifyEngineRule('c8-message', rule, {
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

describe('c8-signal', () => {
  const SIGNAL_DEFINITION = (id: string, ref = 'Sig') =>
    `<bpmn:signalEventDefinition id="${id}" signalRef="${ref}" />`;

  const toEnd = (start = '') => `
    <bpmn:startEvent id="Start">${start}</bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End" />`;

  const TWO_STARTS = `${toEnd(SIGNAL_DEFINITION('SD'))}
    <bpmn:startEvent id="S2">${SIGNAL_DEFINITION('SD2', 'Sig2')}</bpmn:startEvent>
    <bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />`;

  const TWO_BOUNDARIES = `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:serviceTask id="X" />
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="B0" attachedToRef="X">${SIGNAL_DEFINITION('SD0')}</bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="B1" attachedToRef="X">${SIGNAL_DEFINITION('SD1')}</bpmn:boundaryEvent>`;

  const SIGNALS = (first: string, second = first) =>
    `<bpmn:signal id="Sig" name="${first}" /><bpmn:signal id="Sig2" name="${second}" />`;

  verifyEngineRule('c8-signal', rule, {
    valid: [
      {
        name: 'a signal start event with a static name',
        moddleElement: engineModel('c8', toEnd(SIGNAL_DEFINITION('SD')), { roots: SIGNALS('sig') }),
      },
      {
        name: 'a FEEL signal name on a throw event',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" /><bpmn:endEvent id="End">${SIGNAL_DEFINITION('SD')}</bpmn:endEvent>`,
          { roots: SIGNALS('=sig') },
        ),
      },
      {
        name: 'two signal start events with different names',
        moddleElement: engineModel('c8', TWO_STARTS, { roots: SIGNALS('one', 'two') }),
      },
      {
        name: 'a signal without name (camunda-compat signal-reference)',
        moddleElement: engineModel('c8', toEnd(SIGNAL_DEFINITION('SD')), {
          roots: '<bpmn:signal id="Sig" />',
        }),
      },
      {
        name: 'two signal start events with one name in a process that is not executable',
        moddleElement: engineModel('c8', TWO_STARTS, {
          roots: SIGNALS('sig'),
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'two signal start events of one name in an event sub-process scope',
        moddleElement: engineModel(
          'c8',
          `${toEnd()}<bpmn:subProcess id="ESP" triggeredByEvent="true"><bpmn:startEvent id="ESP_S">${SIGNAL_DEFINITION('SD')}</bpmn:startEvent></bpmn:subProcess><bpmn:subProcess id="ESP2" triggeredByEvent="true"><bpmn:startEvent id="ESP2_S">${SIGNAL_DEFINITION('SD2')}</bpmn:startEvent></bpmn:subProcess>`,
          { roots: SIGNALS('sig') },
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel('c7', TWO_STARTS, { roots: SIGNALS('sig') }),
      },
    ],
    invalid: [
      {
        name: 'a signal start event with a FEEL name',
        moddleElement: engineModel('c8', toEnd(SIGNAL_DEFINITION('SD')), { roots: SIGNALS('=sig') }),
        report: {
          id: 'Start',
          message:
            'Start event Start catches the signal "=sig", a FEEL expression; Camunda 8 needs a static signal name on start events and refuses the file',
          path: ['eventDefinitions', 0, 'signalRef', 'name'],
          type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED,
        },
      },
      {
        name: 'two signal start events with one name',
        moddleElement: engineModel('c8', TWO_STARTS, { roots: SIGNALS('sig') }),
        report: {
          id: 'S2',
          message:
            'startEvent:signal S2 waits for the signal "sig" like startEvent:signal Start in process process_test; Camunda 8 refuses one signal name twice there',
          path: ['eventDefinitions', 0, 'signalRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'two signal boundary events with one name',
        moddleElement: engineModel('c8', TWO_BOUNDARIES, { roots: SIGNALS('sig') }),
        report: {
          id: 'B1',
          message:
            'boundaryEvent:signal B1 waits for the signal "sig" like boundaryEvent:signal B0 on X; Camunda 8 refuses one signal name twice there',
          path: ['eventDefinitions', 0, 'signalRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
    ],
  });
});

describe('c8-error', () => {
  const ERROR_DEFINITION = (id: string, ref?: string) =>
    `<bpmn:errorEventDefinition id="${id}"${ref ? ` errorRef="${ref}"` : ''} />`;
  const ERROR = (code?: string) =>
    `<bpmn:error id="Err" name="E"${code === undefined ? '' : ` errorCode="${code}"`} />`;

  const boundaries = (definitions: string[], attributes = '', end = '') => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:serviceTask id="X" />
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End">${end}</bpmn:endEvent>
    ${definitions.map((definition, index) => `<bpmn:boundaryEvent id="B${index}" attachedToRef="X"${attributes}>${definition}</bpmn:boundaryEvent>`).join('\n')}`;

  const eventSubProcesses = (...definitions: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End" />
    ${definitions.map((definition, index) => `<bpmn:subProcess id="ESP${index}" triggeredByEvent="true"><bpmn:startEvent id="ESP${index}_S">${definition}</bpmn:startEvent></bpmn:subProcess>`).join('\n')}`;

  const TWO_BOUNDARIES = boundaries([ERROR_DEFINITION('ED0', 'Err'), ERROR_DEFINITION('ED1', 'Err')]);

  verifyEngineRule('c8-error', rule, {
    valid: [
      {
        name: 'an error boundary event with a static code',
        moddleElement: engineModel('c8', boundaries([ERROR_DEFINITION('ED0', 'Err')]), {
          roots: ERROR('C'),
        }),
      },
      {
        name: 'a FEEL error code on a throw event',
        moddleElement: engineModel('c8', boundaries([], '', ERROR_DEFINITION('ED', 'Err')), {
          roots: ERROR('=code'),
        }),
      },
      {
        name: 'two error boundary events with different codes on different activities',
        moddleElement: engineModel(
          'c8',
          `${boundaries([ERROR_DEFINITION('ED0', 'Err')])}<bpmn:task id="Y" /><bpmn:boundaryEvent id="BY" attachedToRef="Y">${ERROR_DEFINITION('EDY', 'Err')}</bpmn:boundaryEvent>`,
          { roots: ERROR('C') },
        ),
      },
      {
        name: 'a thrown error without code (camunda-compat error-reference)',
        moddleElement: engineModel('c8', boundaries([], '', ERROR_DEFINITION('ED', 'Err')), {
          roots: ERROR(),
        }),
      },
      {
        name: 'two error boundary events with one code in a process that is not executable',
        moddleElement: engineModel('c8', TWO_BOUNDARIES, {
          roots: ERROR('C'),
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel('c7', TWO_BOUNDARIES, { roots: ERROR('C') }),
      },
    ],
    invalid: [
      {
        name: 'an error boundary event catching a FEEL code',
        moddleElement: engineModel(
          'c8',
          boundaries([ERROR_DEFINITION('ED0', 'Err')], '', ERROR_DEFINITION('ED', 'Err')),
          { roots: ERROR('=code') },
        ),
        report: {
          id: 'B0',
          message:
            'boundaryEvent:error B0 catches the error code "=code", an expression; Camunda 8 needs a static code on catching error events and refuses the file',
          path: ['eventDefinitions', 0, 'errorRef', 'errorCode'],
          type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED,
        },
      },
      {
        name: 'a non-interrupting error boundary event',
        moddleElement: engineModel(
          'c8',
          boundaries([ERROR_DEFINITION('ED0')], ' cancelActivity="false"'),
        ),
        report: {
          id: 'B0',
          message:
            'boundaryEvent:error B0 is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)',
          path: ['cancelActivity'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a non-interrupting error start event of an event sub-process',
        moddleElement: engineModel(
          'c8',
          eventSubProcesses(ERROR_DEFINITION('ED0')).replace(
            '<bpmn:startEvent id="ESP0_S">',
            '<bpmn:startEvent id="ESP0_S" isInterrupting="false">',
          ),
        ),
        report: {
          id: 'ESP0_S',
          message:
            'startEvent:error ESP0_S is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)',
          path: ['isInterrupting'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'two error boundary events with one code',
        moddleElement: engineModel('c8', TWO_BOUNDARIES, { roots: ERROR('C') }),
        report: {
          id: 'B1',
          message:
            'boundaryEvent:error B1 catches the error code "C" like boundaryEvent:error B0 (the boundary events of X); Camunda 8 refuses one code twice in a scope',
          path: ['eventDefinitions', 0, 'errorRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'two catch-all error boundary events',
        moddleElement: engineModel(
          'c8',
          boundaries([ERROR_DEFINITION('ED0'), ERROR_DEFINITION('ED1')]),
        ),
        report: {
          id: 'B1',
          message:
            'boundaryEvent:error B1 and boundaryEvent:error B0 both catch every error (no error code) (the boundary events of X); Camunda 8 allows one catch-all per scope',
          path: ['eventDefinitions', 0, 'errorRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'two error event sub-processes with one code',
        moddleElement: engineModel(
          'c8',
          eventSubProcesses(ERROR_DEFINITION('ED0', 'Err'), ERROR_DEFINITION('ED1', 'Err')),
          { roots: ERROR('C') },
        ),
        report: {
          id: 'ESP1_S',
          message:
            'startEvent:error ESP1_S catches the error code "C" like startEvent:error ESP0_S (the event sub-processes of process_test); Camunda 8 refuses one code twice in a scope',
          path: ['eventDefinitions', 0, 'errorRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
    ],
  });
});

describe('c8-implementation', () => {
  const JOB =
    '<bpmn:extensionElements><zeebe:taskDefinition type="notify" /></bpmn:extensionElements>';
  const message = (name: string | null) =>
    `<bpmn:message id="M1"${name === null ? '' : ` name="${name}"`} />`;

  const sendTask = `<bpmn:sendTask id="X" messageRef="M1">${JOB}</bpmn:sendTask>`;
  const throwEvent = (kind: string) =>
    `<bpmn:${kind} id="X">${JOB}<bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:${kind}>`;

  verifyEngineRule('c8-implementation', rule, {
    valid: [
      {
        name: 'a send task with a named message',
        moddleElement: engineModel('c8', sendTask, { roots: message('Notified') }),
      },
      {
        name: 'a message with a white-space name (Camunda 8 deploys it)',
        moddleElement: engineModel('c8', sendTask, { roots: message('   ') }),
      },
      {
        name: 'a send task without message (left to camunda-compat)',
        moddleElement: engineModel('c8', `<bpmn:sendTask id="X">${JOB}</bpmn:sendTask>`),
      },
      {
        name: 'a receive task with a nameless message (camunda-compat message-reference)',
        moddleElement: engineModel('c8', '<bpmn:receiveTask id="X" messageRef="M1" />', {
          roots: message(null),
        }),
      },
      {
        name: 'a throw event with two definitions (refused for that)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:intermediateThrowEvent id="X"><bpmn:messageEventDefinition id="MD" messageRef="M1" /><bpmn:signalEventDefinition id="SD" /></bpmn:intermediateThrowEvent>`,
          { roots: message(null) },
        ),
      },
      {
        name: 'a process that is not executable',
        moddleElement: engineModel('c8', sendTask, {
          roots: message(null),
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel('c7', '<bpmn:sendTask id="X" messageRef="M1" />', {
          roots: message(null),
        }),
      },
    ],
    invalid: [
      {
        name: 'a send task whose message has no name',
        moddleElement: engineModel('c8', sendTask, { roots: message(null) }),
        report: {
          id: 'X',
          message: 'Message M1 of sendTask X has no name; Camunda 8 refuses the file',
          path: ['messageRef', 'name'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'a send task whose message has an empty name',
        moddleElement: engineModel('c8', sendTask, { roots: message('') }),
        report: {
          id: 'X',
          message: 'Message M1 of sendTask X has no name; Camunda 8 refuses the file',
          path: ['messageRef', 'name'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      ...['intermediateThrowEvent', 'endEvent'].map((kind) => ({
        name: `a message ${kind} whose message has no name`,
        moddleElement: engineModel('c8', throwEvent(kind), { roots: message(null) }),
        report: {
          id: 'X',
          message: `Message M1 of ${kind}:message X has no name; Camunda 8 refuses the file`,
          path: ['eventDefinitions', 0, 'messageRef', 'name'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      })),
    ],
  });
});
