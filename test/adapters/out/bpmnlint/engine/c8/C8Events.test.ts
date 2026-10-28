import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8Events.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

describe('c8-event-definition', () => {
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

  const CONDITION_MISSING = chain(
    '<bpmn:intermediateCatchEvent id="X"><bpmn:conditionalEventDefinition id="CD1" /></bpmn:intermediateCatchEvent>',
  );

  const conditionMissingReport = {
    id: 'X',
    message:
      'The conditional event definition of intermediateCatchEvent:conditional X has no condition element, which the BPMN schema requires; Camunda 8 refuses the file',
    path: ['eventDefinitions', 0, 'condition'],
    type: ERROR_TYPES.PROPERTY_REQUIRED,
  };

  verifyEngineRule('c8-event-definition', rule, {
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
        name: 'an event with two event definitions',
        moddleElement: engineModel('c8', TWO_DEFINITIONS, { roots: MESSAGE }),
        report: {
          id: 'X',
          message:
            'intermediateCatchEvent:timer X has 2 event definitions (timer, message); Camunda 8 allows one and refuses the file',
          path: ['eventDefinitions'],
          type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
        },
      },
      {
        name: 'an event sub-process with a none start event',
        moddleElement: engineModel('c8', eventSubProcess('<bpmn:startEvent id="ESP_S" />')),
        report: {
          id: 'ESP_S',
          message:
            'Start event ESP_S of event sub-process ESP has no trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file',
          path: ['eventDefinitions'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'a conditional event definition without id',
        moddleElement: engineModel(
          'c8',
          chain(
            `<bpmn:intermediateCatchEvent id="X"><bpmn:conditionalEventDefinition>${CONDITION}</bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>`,
          ),
        ),
        report: {
          id: 'X',
          message:
            'The conditional event definition of intermediateCatchEvent:conditional X has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")',
          path: ['eventDefinitions', 0, 'id'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'compensation definitions without id',
        moddleElement: engineModel(
          'c8',
          COMPENSATION('<bpmn:compensateEventDefinition />', '<bpmn:compensateEventDefinition />'),
        ),
        report: [
          {
            id: 'B',
            message:
              'The compensate event definition of boundaryEvent:compensate B has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")',
            path: ['eventDefinitions', 0, 'id'],
            type: ERROR_TYPES.PROPERTY_REQUIRED,
          },
          {
            id: 'T',
            message:
              'The compensate event definition of intermediateThrowEvent:compensate T has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")',
            path: ['eventDefinitions', 0, 'id'],
            type: ERROR_TYPES.PROPERTY_REQUIRED,
          },
        ],
      },
      {
        name: 'a link catch definition without id',
        moddleElement: engineModel(
          'c8',
          LINKS('<bpmn:linkEventDefinition name="L" />', '<bpmn:linkEventDefinition name="L" />'),
        ),
        report: {
          id: 'C',
          message:
            'The link event definition of intermediateCatchEvent:link C has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")',
          path: ['eventDefinitions', 0, 'id'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'a compensation boundary event without handler',
        moddleElement: engineModel('c8', COMPENSATION(undefined, undefined, false)),
        report: {
          id: 'B',
          message:
            'Compensation boundary event B has no association to a compensation handler; Camunda 8 refuses the file',
          type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
        },
      },
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
      {
        name: 'a compensation throw event naming an activity of another scope',
        moddleElement: engineModel(
          'c8',
          COMPENSATION(
            undefined,
            '<bpmn:compensateEventDefinition id="CT" activityRef="Inner" />',
            true,
            '<bpmn:subProcess id="Sub"><bpmn:task id="Inner" /></bpmn:subProcess>',
          ),
        ),
        report: {
          id: 'T',
          message:
            'Compensation event T names Inner, which is not in its own scope process_test; Camunda 8 refuses the file',
          path: ['eventDefinitions', 0, 'activityRef'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a conditional event definition without condition',
        moddleElement: engineModel('c8', CONDITION_MISSING),
        report: conditionMissingReport,
      },
      {
        name: 'a conditional event definition without condition in a process that is not executable',
        moddleElement: engineModel('c8', CONDITION_MISSING, {
          processAttributes: 'isExecutable="false"',
        }),
        report: conditionMissingReport,
      },
    ],
  });
});

describe('c8-start-event', () => {
  const TIMER =
    '<bpmn:timerEventDefinition id="timer_YS"><bpmn:timeCycle xsi:type="bpmn:tFormalExpression">R/PT1H</bpmn:timeCycle></bpmn:timerEventDefinition>';

  const chain = (...middle: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${middle.join('\n')}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />`;

  const inner = (prefix: string, start = '') =>
    `<bpmn:startEvent id="${prefix}S">${start}</bpmn:startEvent><bpmn:sequenceFlow id="${prefix}F" sourceRef="${prefix}S" targetRef="${prefix}E" /><bpmn:endEvent id="${prefix}E" />`;

  const TIMER_START = chain(`<bpmn:subProcess id="X">${inner('Y', TIMER)}</bpmn:subProcess>`);
  const TWO_STARTS = chain(
    `<bpmn:subProcess id="X">${inner('Z')}<bpmn:startEvent id="ZS2" /><bpmn:sequenceFlow id="ZF2" sourceRef="ZS2" targetRef="ZE" /></bpmn:subProcess>`,
  );

  verifyEngineRule('c8-start-event', rule, {
    valid: [
      {
        name: 'a sub-process with one none start event',
        moddleElement: engineModel(
          'c8',
          chain(`<bpmn:subProcess id="X">${inner('I')}</bpmn:subProcess>`),
        ),
      },
      {
        name: 'an event sub-process with a timer start event',
        moddleElement: engineModel(
          'c8',
          chain(
            '<bpmn:task id="X" />',
            `<bpmn:subProcess id="ESP" triggeredByEvent="true">${inner('Y', TIMER)}</bpmn:subProcess>`,
          ),
        ),
      },
      {
        name: 'a sub-process without start event (bpmnlint start-event-required)',
        moddleElement: engineModel(
          'c8',
          chain('<bpmn:subProcess id="X"><bpmn:task id="A1" /></bpmn:subProcess>'),
        ),
      },
      {
        name: 'two none start events in a process (camunda-compat no-multiple-none-start-events)',
        moddleElement: engineModel(
          'c8',
          `${chain('<bpmn:task id="X" />')}<bpmn:startEvent id="S2" /><bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />`,
        ),
      },
      {
        name: 'start events in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c8',
          chain(
            `<bpmn:adHocSubProcess id="X"><bpmn:startEvent id="AS">${TIMER}</bpmn:startEvent><bpmn:startEvent id="AS2" /></bpmn:adHocSubProcess>`,
          ),
        ),
      },
      {
        name: 'a timer start in a sub-process of a process that is not executable',
        moddleElement: engineModel('c8', TIMER_START, { processAttributes: 'isExecutable="false"' }),
      },
      { name: 'a Camunda 7 diagram', moddleElement: engineModel('c7', TIMER_START) },
    ],
    invalid: [
      {
        name: 'a sub-process with a timer start event',
        moddleElement: engineModel('c8', TIMER_START),
        report: {
          id: 'YS',
          message:
            'Start event YS of sub-process X has a timer trigger; Camunda 8 allows only a none start event in an embedded sub-process and refuses the file',
          path: ['eventDefinitions', 0],
          type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
        },
      },
      {
        name: 'a sub-process with two start events',
        moddleElement: engineModel('c8', TWO_STARTS),
        report: {
          id: 'X',
          message:
            'Sub-process X has 2 start events; Camunda 8 needs exactly one and refuses the file',
          path: ['flowElements'],
          type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
        },
      },
      {
        name: 'an event sub-process with two start events',
        moddleElement: engineModel(
          'c8',
          chain(
            '<bpmn:task id="X" />',
            `<bpmn:subProcess id="ESP" triggeredByEvent="true">${inner('Y', TIMER)}<bpmn:startEvent id="YS2">${TIMER.replace('timer_YS', 'timer_YS2')}</bpmn:startEvent></bpmn:subProcess>`,
          ),
        ),
        report: {
          id: 'ESP',
          message:
            'Event sub-process ESP has 2 start events; Camunda 8 needs exactly one and refuses the file',
          path: ['flowElements'],
          type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c8-ad-hoc-sub-process', () => {
  const chain = (...middle: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${middle.join('\n')}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />`;

  const WITH_START = chain(
    '<bpmn:adHocSubProcess id="X"><bpmn:task id="A1" /><bpmn:startEvent id="AS" /></bpmn:adHocSubProcess>',
  );

  verifyEngineRule('c8-ad-hoc-sub-process', rule, {
    valid: [
      {
        name: 'an ad-hoc sub-process with activities only',
        moddleElement: engineModel(
          'c8',
          chain(
            '<bpmn:adHocSubProcess id="X"><bpmn:task id="A1" /><bpmn:serviceTask id="A2" /></bpmn:adHocSubProcess>',
          ),
        ),
      },
      {
        name: 'an ad-hoc sub-process without activity (camunda-compat ad-hoc-sub-process)',
        moddleElement: engineModel('c8', chain('<bpmn:adHocSubProcess id="X" />')),
      },
      {
        name: 'a start event in an ad-hoc sub-process of a process that is not executable',
        moddleElement: engineModel('c8', WITH_START, { processAttributes: 'isExecutable="false"' }),
      },
      { name: 'a Camunda 7 diagram', moddleElement: engineModel('c7', WITH_START) },
    ],
    invalid: [
      {
        name: 'an ad-hoc sub-process with a start event',
        moddleElement: engineModel('c8', WITH_START),
        report: {
          id: 'X',
          message:
            'Ad-hoc sub-process X contains the start event AS; Camunda 8 refuses start and end events in ad-hoc sub-processes',
          path: ['flowElements', 1],
          type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
        },
      },
      {
        name: 'an ad-hoc sub-process with a start and an end event',
        moddleElement: engineModel(
          'c8',
          chain(
            '<bpmn:adHocSubProcess id="X"><bpmn:startEvent id="AS" /><bpmn:task id="A1" /><bpmn:endEvent id="AE" /></bpmn:adHocSubProcess>',
          ),
        ),
        report: [
          {
            id: 'X',
            message:
              'Ad-hoc sub-process X contains the start event AS; Camunda 8 refuses start and end events in ad-hoc sub-processes',
            path: ['flowElements', 0],
            type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
          },
          {
            id: 'X',
            message:
              'Ad-hoc sub-process X contains the end event AE; Camunda 8 refuses start and end events in ad-hoc sub-processes',
            path: ['flowElements', 2],
            type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
          },
        ],
      },
    ],
  });
});

describe('c8-boundary-host', () => {
  const COMPENSATION = (handlerAttributes: string) => `
    <bpmn:serviceTask id="serviceTask_chargeCard">
      <bpmn:extensionElements><zeebe:taskDefinition type="charge-card" /></bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:boundaryEvent id="boundaryEvent_compensate" attachedToRef="serviceTask_chargeCard">
      <bpmn:compensateEventDefinition id="compensateEventDefinition_compensate" />
    </bpmn:boundaryEvent>
    <bpmn:serviceTask id="serviceTask_refundCard" ${handlerAttributes}>
      <bpmn:extensionElements><zeebe:taskDefinition type="refund-card" /></bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:boundaryEvent id="boundaryEvent_refundTimeout" attachedToRef="serviceTask_refundCard">
      <bpmn:timerEventDefinition id="timerEventDefinition_refundTimeout">
        <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:association id="association_compensate" associationDirection="One"
        sourceRef="boundaryEvent_compensate" targetRef="serviceTask_refundCard" />`;

  verifyEngineRule('c8-boundary-host', rule, {
    valid: [
      {
        name: 'a boundary event on a normal activity',
        moddleElement: engineModel('c8', COMPENSATION('')),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          COMPENSATION('isForCompensation="true"').replace(
            /<bpmn:extensionElements>.*?<\/bpmn:extensionElements>/g,
            '',
          ),
        ),
      },
    ],
    invalid: [
      {
        name: 'a boundary event on a compensation handler',
        moddleElement: engineModel('c8', COMPENSATION('isForCompensation="true"')),
        report: {
          id: 'boundaryEvent_refundTimeout',
          message:
            'Boundary event boundaryEvent_refundTimeout is attached to the compensation handler serviceTask_refundCard; Camunda 8 refuses boundary events on compensation handlers',
          path: ['attachedToRef'],
          type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c8-event-gateway', () => {
  const TIMER_CATCH =
    '<bpmn:intermediateCatchEvent id="{id}">{in}<bpmn:timerEventDefinition id="timer_{id}"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>';
  const MESSAGE_CATCH =
    '<bpmn:intermediateCatchEvent id="{id}">{in}<bpmn:messageEventDefinition id="message_{id}" messageRef="M1" /></bpmn:intermediateCatchEvent>';
  const MESSAGE = '<bpmn:message id="M1" name="M1" />';

  /** start, event-based gateway G (listing `listed` of its outgoing flows), one branch per target */
  function eventGateway(targets: string[], listed = targets.length): string {
    const outgoing = targets
      .slice(0, listed)
      .map((_target, index) => `<bpmn:outgoing>G${index}</bpmn:outgoing>`)
      .join('');
    return `
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:eventBasedGateway id="G"><bpmn:incoming>F1</bpmn:incoming>${outgoing}</bpmn:eventBasedGateway>
    ${targets
      .map(
        (target, index) => `
    <bpmn:sequenceFlow id="G${index}" sourceRef="G" targetRef="T${index}" />
    ${target.replaceAll('{id}', `T${index}`).replace('{in}', `<bpmn:incoming>G${index}</bpmn:incoming>`)}
    <bpmn:sequenceFlow id="E${index}" sourceRef="T${index}" targetRef="End${index}" />
    <bpmn:endEvent id="End${index}" />`,
      )
      .join('')}`;
  }

  const ONE_BRANCH = eventGateway([TIMER_CATCH]);

  verifyEngineRule('c8-event-gateway', rule, {
    valid: [
      {
        name: 'an event-based gateway with a timer and a message branch',
        moddleElement: engineModel('c8', eventGateway([TIMER_CATCH, MESSAGE_CATCH]), {
          roots: MESSAGE,
        }),
      },
      {
        name: 'a receive task after the gateway (camunda-compat event-based-gateway-target)',
        moddleElement: engineModel(
          'c8',
          eventGateway([
            TIMER_CATCH,
            '<bpmn:receiveTask id="{id}" messageRef="M1">{in}</bpmn:receiveTask>',
          ]),
          { roots: MESSAGE },
        ),
      },
      {
        name: 'an event-based gateway with one branch in a process that is not executable',
        moddleElement: engineModel('c8', ONE_BRANCH, { processAttributes: 'isExecutable="false"' }),
      },
      { name: 'a Camunda 7 diagram', moddleElement: engineModel('c7', ONE_BRANCH) },
    ],
    invalid: [
      {
        name: 'an event-based gateway with one branch',
        moddleElement: engineModel('c8', ONE_BRANCH),
        report: {
          id: 'G',
          message:
            'Event-based gateway G has 1 outgoing flow; Camunda 8 needs at least two and refuses the file',
          path: ['outgoing'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'an event-based gateway that lists one of its two outgoing flows',
        moddleElement: engineModel('c8', eventGateway([TIMER_CATCH, MESSAGE_CATCH], 1), {
          roots: MESSAGE,
        }),
        report: {
          id: 'G',
          message:
            'Event-based gateway G has 2 outgoing flows, but the file lists 1 of them as its <bpmn:outgoing> entries; Camunda 8 counts the listed ones and refuses the file',
          path: ['outgoing'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'an event-based gateway leading to a task and to a catch event with two definitions',
        moddleElement: engineModel(
          'c8',
          eventGateway([
            TIMER_CATCH,
            '<bpmn:task id="{id}">{in}</bpmn:task>',
            TIMER_CATCH.replace(
              '</bpmn:intermediateCatchEvent>',
              '<bpmn:messageEventDefinition id="second_{id}" messageRef="M1" /></bpmn:intermediateCatchEvent>',
            ),
          ]),
          { roots: MESSAGE },
        ),
        report: [
          {
            id: 'G',
            message:
              'Event-based gateway G leads to task T1; Camunda 8 allows only message, timer, signal and conditional intermediate catch events after it and refuses the file',
            type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED,
          },
          {
            id: 'G',
            message:
              'Event-based gateway G leads to intermediateCatchEvent:timer T2; Camunda 8 allows only message, timer, signal and conditional intermediate catch events after it and refuses the file',
            type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED,
          },
        ],
      },
    ],
  });
});

describe('c8-link-event', () => {
  const LINKS = (throwDefinition: string, catchDefinitions: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:intermediateThrowEvent id="X">${throwDefinition}</bpmn:intermediateThrowEvent>
    ${catchDefinitions
      .map(
        (definition, index) =>
          `<bpmn:intermediateCatchEvent id="C${index}">${definition}</bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="FC${index}" sourceRef="C${index}" targetRef="End" />`,
      )
      .join('\n')}
    <bpmn:endEvent id="End" />`;

  const PAIR = (name: string) =>
    LINKS(`<bpmn:linkEventDefinition id="L1" name="${name}" />`, [
      `<bpmn:linkEventDefinition id="L2" name="${name}" />`,
    ]);

  const UNMATCHED = LINKS('<bpmn:linkEventDefinition id="L1" name="A" />', [
    '<bpmn:linkEventDefinition id="L2" name="B" />',
  ]);

  const TIMER =
    '<bpmn:timerEventDefinition id="timer_X"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';

  verifyEngineRule('c8-link-event', rule, {
    valid: [
      { name: 'a link pair', moddleElement: engineModel('c8', PAIR('L')) },
      { name: 'link names of white space', moddleElement: engineModel('c8', PAIR('   ')) },
      {
        name: 'empty link names on intermediate events (camunda-compat link-event)',
        moddleElement: engineModel('c8', PAIR('')),
      },
      {
        name: 'a link definition without name (camunda-compat link-event)',
        moddleElement: engineModel(
          'c8',
          LINKS('<bpmn:linkEventDefinition id="L1" />', [
            '<bpmn:linkEventDefinition id="L2" name="L" />',
          ]),
        ),
      },
      {
        name: 'two link catch events of one name (camunda-compat link-event)',
        moddleElement: engineModel(
          'c8',
          LINKS('<bpmn:linkEventDefinition id="L1" name="B" />', [
            '<bpmn:linkEventDefinition id="L2" name="B" />',
            '<bpmn:linkEventDefinition id="L3" name="B" />',
          ]),
        ),
      },
      {
        name: 'a throw without catch in a process that is not executable',
        moddleElement: engineModel('c8', UNMATCHED, { processAttributes: 'isExecutable="false"' }),
      },
      {
        name: 'a throw and its catch in one sub-process',
        moddleElement: engineModel('c8', `<bpmn:subProcess id="Sub">${PAIR('L')}</bpmn:subProcess>`),
      },
      { name: 'a Camunda 7 diagram', moddleElement: engineModel('c7', UNMATCHED) },
    ],
    invalid: [
      {
        name: 'a link throw without catch',
        moddleElement: engineModel('c8', UNMATCHED),
        report: {
          id: 'X',
          message:
            'Link throw event X goes to "A", but process_test has no link catch event of that name; Camunda 8 refuses the file',
          path: ['eventDefinitions', 0, 'name'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a link throw whose catch is in another sub-process',
        moddleElement: engineModel(
          'c8',
          `<bpmn:subProcess id="Sub"><bpmn:intermediateThrowEvent id="X"><bpmn:linkEventDefinition id="L1" name="L" /></bpmn:intermediateThrowEvent></bpmn:subProcess>
           <bpmn:intermediateCatchEvent id="C"><bpmn:linkEventDefinition id="L2" name="L" /></bpmn:intermediateCatchEvent>`,
        ),
        report: {
          id: 'X',
          message:
            'Link throw event X goes to "L", but Sub has no link catch event of that name; Camunda 8 refuses the file',
          path: ['eventDefinitions', 0, 'name'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'link definitions without name in a process that is not executable',
        moddleElement: engineModel(
          'c8',
          LINKS('<bpmn:linkEventDefinition id="L1" />', [
            '<bpmn:linkEventDefinition id="L2" name="" />',
          ]),
          { processAttributes: 'isExecutable="false"' },
        ),
        report: [
          {
            id: 'X',
            message:
              'The link event definition of intermediateThrowEvent:link X has no name, which the BPMN schema requires; Camunda 8 refuses the file',
            path: ['eventDefinitions', 0, 'name'],
            type: ERROR_TYPES.PROPERTY_REQUIRED,
          },
          {
            id: 'C0',
            message:
              'The link event definition of intermediateCatchEvent:link C0 has an empty name; Camunda 8 refuses the file',
            path: ['eventDefinitions', 0, 'name'],
            type: ERROR_TYPES.PROPERTY_REQUIRED,
          },
        ],
      },
      {
        name: 'a link definition without name behind another definition',
        moddleElement: engineModel(
          'c8',
          LINKS(`${TIMER}<bpmn:linkEventDefinition id="L1" />`, [
            '<bpmn:linkEventDefinition id="L2" name="L" />',
          ]),
        ),
        report: {
          id: 'X',
          message:
            'The link event definition of intermediateThrowEvent:timer X has no name, which the BPMN schema requires; Camunda 8 refuses the file',
          path: ['eventDefinitions', 1, 'name'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});
