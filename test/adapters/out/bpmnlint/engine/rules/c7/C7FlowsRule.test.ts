import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7FlowsRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-exclusive-gateway', () => {
  /** Start -> G, and one flow S<n> per entry (its condition, or none) to an end event */
  const exclusive = (conditions: Array<string | null>, defaultFlow?: string) => {
    const branches = conditions.map((condition, index) => {
      const expression = condition
        ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${condition}</bpmn:conditionExpression>`
        : '';
      return `<bpmn:sequenceFlow id="S${index}" sourceRef="G" targetRef="End${index}">${expression}</bpmn:sequenceFlow><bpmn:endEvent id="End${index}" />`;
    });
    return `<bpmn:startEvent id="Start" />
      <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
      <bpmn:exclusiveGateway id="G"${defaultFlow ? ` default="${defaultFlow}"` : ''} />
      ${branches.join('\n')}`;
  };

  const REFUSED = 'the engines refuse the file';
  const unconditioned = (flowId: string, count = '') => ({
    id: 'G',
    message: `Flow ${flowId} of exclusive gateway G has no condition and is not the default flow${count}; ${REFUSED}`,
    type: ERROR_TYPES.PROPERTY_REQUIRED,
  });
  const conditionedDefault = (flowId: string) => ({
    id: 'G',
    message: `Default flow ${flowId} of exclusive gateway G has a condition; ${REFUSED}`,
    type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
  });

  verifyEngineRule('c7-exclusive-gateway', rule, {
    valid: [
      {
        name: 'conditions plus a default flow',
        moddleElement: engineModel('c7', exclusive(['${a}', null], 'S1')),
      },
      {
        name: 'one flow without condition and no default (c7-implicit-default-flow reports it)',
        moddleElement: engineModel('c7', exclusive(['${a}', null])),
      },
      {
        name: 'a single outgoing flow without condition',
        moddleElement: engineModel('c7', exclusive([null])),
      },
      {
        name: 'a single default flow without condition',
        moddleElement: engineModel('c7', exclusive([null], 'S0')),
      },
      {
        name: 'two flows without condition in a non-executable process',
        moddleElement: engineModel('c7', exclusive(['${a}', null, null]), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'two flows without condition in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${exclusive(['${a}', null, null])}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', exclusive(['${a}', null, null])),
      },
    ],
    invalid: [
      {
        name: 'a flow without condition next to the default flow',
        moddleElement: engineModel('c7', exclusive(['${a}', null, null], 'S2')),
        report: unconditioned('S1'),
      },
      {
        name: 'two flows without condition',
        moddleElement: engineModel('c7', exclusive(['${a}', null, null])),
        report: [unconditioned('S1', ' (2 such flows)'), unconditioned('S2', ' (2 such flows)')],
      },
      {
        name: 'a single outgoing flow with a condition',
        moddleElement: engineModel('c7', exclusive(['${a}'])),
        report: {
          id: 'G',
          message: `Exclusive gateway G has a single outgoing flow S0 with a condition; ${REFUSED}`,
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'a single default flow with a condition',
        moddleElement: engineModel('c7', exclusive(['${a}'], 'S0')),
        report: conditionedDefault('S0'),
      },
      {
        name: 'a conditional default flow',
        moddleElement: engineModel('c7', exclusive(['${a}', '${b}'], 'S1')),
        report: conditionedDefault('S1'),
      },
      {
        name: 'no outgoing flow',
        moddleElement: engineModel(
          'c7',
          '<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" /><bpmn:exclusiveGateway id="G" />',
        ),
        report: {
          id: 'G',
          message: `Exclusive gateway G has no outgoing flow; ${REFUSED}`,
          path: ['outgoing'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});

describe('c7-implicit-default-flow', () => {
  /** Start -> G, and one flow S<n> per entry (its condition, or none) to an end event */
  const exclusive = (conditions: Array<string | null>, defaultFlow?: string) => {
    const branches = conditions.map((condition, index) => {
      const expression = condition
        ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${condition}</bpmn:conditionExpression>`
        : '';
      return `<bpmn:sequenceFlow id="S${index}" sourceRef="G" targetRef="End${index}">${expression}</bpmn:sequenceFlow><bpmn:endEvent id="End${index}" />`;
    });
    return `<bpmn:startEvent id="Start" />
      <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
      <bpmn:exclusiveGateway id="G"${defaultFlow ? ` default="${defaultFlow}"` : ''} />
      ${branches.join('\n')}`;
  };

  verifyEngineRule('c7-implicit-default-flow', rule, {
    valid: [
      {
        name: 'conditions plus a default flow',
        moddleElement: engineModel('c7', exclusive(['${a}', null], 'S1')),
      },
      {
        name: 'every flow has a condition',
        moddleElement: engineModel('c7', exclusive(['${a}', '${b}'])),
      },
      {
        name: 'a single outgoing flow without condition',
        moddleElement: engineModel('c7', exclusive([null])),
      },
      {
        name: 'two flows without condition (c7-exclusive-gateway reports it)',
        moddleElement: engineModel('c7', exclusive(['${a}', null, null])),
      },
      {
        name: 'one flow without condition and no default in a non-executable process',
        moddleElement: engineModel('c7', exclusive(['${a}', null]), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'one flow without condition and no default in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${exclusive(['${a}', null])}</bpmn:adHocSubProcess>`,
        ),
      },
      { name: 'a Camunda 8 diagram', moddleElement: engineModel('c8', exclusive(['${a}', null])) },
    ],
    invalid: [
      {
        name: 'one flow without condition and no default',
        moddleElement: engineModel('c7', exclusive(['${a}', null])),
        report: {
          id: 'G',
          message:
            'Flow S1 of exclusive gateway G has no condition and is not the default flow; the engines take it as the default and log a warning',
          path: ['default'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});

describe('c7-event-gateway', () => {
  const MESSAGES =
    '<bpmn:message id="M1" name="M1" /><bpmn:message id="M1b" name="M1" /><bpmn:message id="M2" name="M2" /><bpmn:signal id="S1" name="Go" /><bpmn:signal id="S1b" name="Go" />';
  const TIMER =
    '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const catchEvent = (definitions: string) =>
    `<bpmn:intermediateCatchEvent id="{id}">${definitions}</bpmn:intermediateCatchEvent>`;
  const TIMER_CATCH = catchEvent(TIMER);
  const msgCatch = (ref: string) => catchEvent(`<bpmn:messageEventDefinition messageRef="${ref}" />`);
  const signalCatch = (ref: string) =>
    catchEvent(`<bpmn:signalEventDefinition signalRef="${ref}" />`);
  const LINK = '<bpmn:linkEventDefinition name="L" />';
  const COND =
    '<bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression">${ready}</bpmn:condition></bpmn:conditionalEventDefinition>';

  /** Start -> G, and per target a flow G<n> into it (id T<n>) and on to an end event */
  const eventGateway = (targets: string[], extra = '') => {
    const branches = targets.map(
      (target, index) => `<bpmn:sequenceFlow id="G${index}" sourceRef="G" targetRef="T${index}" />
      ${target.replace('{id}', `T${index}`)}
      <bpmn:sequenceFlow id="E${index}" sourceRef="T${index}" targetRef="End${index}" />
      <bpmn:endEvent id="End${index}" />`,
    );
    return `<bpmn:startEvent id="Start" />
      <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
      <bpmn:eventBasedGateway id="G" />
      ${branches.join('\n')}${extra}`;
  };
  const model = (xml: string, options = {}) =>
    engineModel('c7', xml, { roots: MESSAGES, ...options });

  const notCatchEvent = (target: string) => ({
    id: 'G',
    message: `Event-based gateway G leads to ${target}; the engines accept only intermediate catch events (message, timer, signal, conditional) there and refuse the file`,
    type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED,
  });
  const wrongTrigger = (target: string) => ({
    id: 'G',
    message: `Event-based gateway G leads to ${target}; after an event-based gateway the engines accept only message, timer, signal and conditional catch events and refuse the file`,
    type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED,
  });

  verifyEngineRule('c7-event-gateway', rule, {
    valid: [
      {
        name: 'timer and message branches',
        moddleElement: model(eventGateway([TIMER_CATCH, msgCatch('M1')])),
      },
      {
        name: 'signal and conditional branches',
        moddleElement: model(eventGateway([signalCatch('S1'), catchEvent(COND)])),
      },
      {
        name: 'a message + timer catch event (the timer acts)',
        moddleElement: model(
          eventGateway([
            TIMER_CATCH,
            catchEvent(`<bpmn:messageEventDefinition messageRef="M1" />${TIMER}`),
          ]),
        ),
      },
      {
        name: 'a link + timer catch event (the timer acts)',
        moddleElement: model(eventGateway([msgCatch('M1'), catchEvent(LINK + TIMER)])),
      },
      {
        name: 'two branches wait for different message names',
        moddleElement: model(eventGateway([msgCatch('M1'), msgCatch('M2')])),
      },
      {
        name: 'a message branch and a signal branch with the same name',
        moddleElement: engineModel('c7', eventGateway([msgCatch('M1'), signalCatch('S1')]), {
          roots: '<bpmn:message id="M1" name="Go" /><bpmn:signal id="S1" name="Go" />',
        }),
      },
      {
        name: 'a user task after an event-based gateway in a non-executable process',
        moddleElement: model(eventGateway([TIMER_CATCH, '<bpmn:userTask id="{id}" />']), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a user task after an event-based gateway in an ad-hoc sub-process',
        moddleElement: model(
          `<bpmn:adHocSubProcess id="AH">${eventGateway([TIMER_CATCH, '<bpmn:userTask id="{id}" />'])}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', eventGateway([TIMER_CATCH, '<bpmn:userTask id="{id}" />'])),
      },
    ],
    invalid: [
      {
        name: 'a receive task after an event-based gateway',
        moddleElement: model(
          eventGateway([TIMER_CATCH, '<bpmn:receiveTask id="{id}" messageRef="M1" />']),
        ),
        report: notCatchEvent('receiveTask T1'),
      },
      {
        name: 'a user task after an event-based gateway',
        moddleElement: model(eventGateway([TIMER_CATCH, '<bpmn:userTask id="{id}" />'])),
        report: notCatchEvent('userTask T1'),
      },
      {
        name: 'a link catch event after an event-based gateway',
        moddleElement: model(eventGateway([TIMER_CATCH, catchEvent(LINK)])),
        report: wrongTrigger('intermediateCatchEvent:link T1'),
      },
      {
        name: 'a link + conditional catch event (the link acts)',
        moddleElement: model(eventGateway([TIMER_CATCH, catchEvent(LINK + COND)])),
        report: wrongTrigger('intermediateCatchEvent:link T1'),
      },
      {
        name: 'a catch event without event definition',
        moddleElement: model(eventGateway([TIMER_CATCH, catchEvent('')])),
        report: wrongTrigger('intermediateCatchEvent T1'),
      },
      {
        name: 'a catch event after the gateway with another incoming flow',
        moddleElement: model(
          eventGateway(
            [TIMER_CATCH, msgCatch('M1')],
            '<bpmn:sequenceFlow id="F2" sourceRef="Start" targetRef="T1" />',
          ),
        ),
        report: {
          id: 'G',
          message:
            'intermediateCatchEvent:message T1 after event-based gateway G has other incoming flows; the engines refuse the file',
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'two gateway branches wait for the same message name',
        moddleElement: model(eventGateway([msgCatch('M1'), msgCatch('M1b')])),
        report: {
          id: 'G',
          message:
            'Branches T0 and T1 of event-based gateway G wait for the same message "M1"; the engines refuse the file',
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'two gateway branches wait for the same signal name',
        moddleElement: model(eventGateway([signalCatch('S1'), signalCatch('S1b')])),
        report: {
          id: 'G',
          message:
            'Branches T0 and T1 of event-based gateway G wait for the same signal "Go"; the engines refuse the file',
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
    ],
  });
});

describe('c7-complex-gateway', () => {
  const flow = (id: string, from: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${target}" />`;
  /** Start -> `node` (id SP) -> End */
  const around = (node: string) =>
    `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'SP')}${node}${flow('F2', 'SP', 'End')}<bpmn:endEvent id="End" />`;
  /** Start -> U -> End, plus `extra` that nothing connects */
  const beside = (extra: string) =>
    `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'U')}<bpmn:userTask id="U" />${flow('F2', 'U', 'End')}<bpmn:endEvent id="End" />${extra}`;
  const COMPLEX = '<bpmn:complexGateway id="SP" />';

  const report = (end: string, flowId: string) => ({
    id: 'SP',
    message: `Complex gateway SP is connected; the engines do not run complex gateways and refuse the file (invalid ${end} 'SP' of sequence flow ${flowId})`,
    type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
  });

  verifyEngineRule('c7-complex-gateway', rule, {
    valid: [
      {
        name: 'a complex gateway that nothing connects',
        moddleElement: engineModel('c7', beside(COMPLEX)),
      },
      {
        name: 'a connected complex gateway in a non-executable process',
        moddleElement: engineModel('c7', around(COMPLEX), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a connected complex gateway in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${around(COMPLEX)}</bpmn:adHocSubProcess>`,
        ),
      },
      { name: 'a Camunda 8 diagram', moddleElement: engineModel('c8', around(COMPLEX)) },
    ],
    invalid: [
      {
        name: 'a complex gateway with sequence flows',
        moddleElement: engineModel('c7', around(COMPLEX)),
        report: report('destination', 'F1'),
      },
      {
        name: 'a complex gateway with an outgoing flow only',
        moddleElement: engineModel('c7', beside(`${COMPLEX}${flow('F3', 'SP', 'End')}`)),
        report: report('source', 'F3'),
      },
    ],
  });
});

describe('c7-ad-hoc-sub-process', () => {
  const flow = (id: string, from: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${target}" />`;
  const userTask = (id: string) => `<bpmn:userTask id="${id}" />`;
  /** Start -> `node` (id SP) -> End */
  const around = (node: string) =>
    `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'SP')}${node}${flow('F2', 'SP', 'End')}<bpmn:endEvent id="End" />`;
  /** Start -> U -> End, plus `extra` that nothing connects */
  const beside = (extra: string) =>
    `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'U')}${userTask('U')}${flow('F2', 'U', 'End')}<bpmn:endEvent id="End" />${extra}`;
  const TIMER =
    '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const LOOP =
    '<bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>2</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>';

  const REFUSED = 'the engines do not run ad-hoc sub-processes and refuse the file';
  const connected = (parts: string, refusal: string) => ({
    id: 'SP',
    message: `Ad-hoc sub-process SP is connected (${parts}); ${REFUSED} (${refusal})`,
    type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
  });
  const LOOP_REPORT = {
    id: 'SP',
    message:
      'Ad-hoc sub-process SP has a multi-instance loop; the engines do not run ad-hoc sub-processes, and Camunda 7 and CIB seven refuse the file (ENGINE-01009, "activity" is null)',
    path: ['loopCharacteristics'],
    type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
  };

  verifyEngineRule('c7-ad-hoc-sub-process', rule, {
    valid: [
      {
        name: 'an ad-hoc sub-process that nothing connects: its content is skipped',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="SP"><bpmn:serviceTask id="X" /><bpmn:scriptTask id="Y" /><bpmn:subProcess id="Z">${userTask('Z1')}</bpmn:subProcess><bpmn:startEvent id="A1" /><bpmn:startEvent id="A2" />${flow('a1', 'A1', 'X')}${flow('a2', 'A2', 'X')}</bpmn:adHocSubProcess>`,
          ),
        ),
      },
      {
        name: 'an ad-hoc sub-process that nothing connects: broken settings on it are skipped too',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="SP" camunda:asyncBefore="true" camunda:jobPriority="abc"><bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R1/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R2/PT1M</camunda:failedJobRetryTimeCycle><camunda:executionListener event="start" /></bpmn:extensionElements>${userTask('T')}</bpmn:adHocSubProcess>`,
          ),
        ),
      },
      {
        name: 'a connected ad-hoc sub-process inside an ad-hoc sub-process (skipped with its parent)',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="AH">${around(`<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess>`)}</bpmn:adHocSubProcess>`,
          ),
        ),
      },
      {
        name: 'a connected ad-hoc sub-process in a non-executable process',
        moddleElement: engineModel(
          'c7',
          around(`<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess>`),
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'a connected embedded sub-process',
        moddleElement: engineModel(
          'c7',
          around(`<bpmn:subProcess id="SP">${userTask('T')}</bpmn:subProcess>`),
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          around(`<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess>`),
        ),
      },
    ],
    invalid: [
      {
        name: 'an ad-hoc sub-process with sequence flows',
        moddleElement: engineModel(
          'c7',
          around(`<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess>`),
        ),
        report: connected('sequence flows F1, F2', "invalid destination 'SP' of sequence flow F1"),
      },
      {
        name: 'an empty ad-hoc sub-process with an incoming flow only',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'SP')}<bpmn:adHocSubProcess id="SP" />`,
        ),
        report: connected('sequence flow F1', "invalid destination 'SP' of sequence flow F1"),
      },
      {
        name: 'an ad-hoc sub-process with an outgoing flow only',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess>${flow('F3', 'SP', 'End')}`,
          ),
        ),
        report: connected('sequence flow F3', "invalid source 'SP' of sequence flow F3"),
      },
      {
        name: 'an ad-hoc sub-process with a boundary event',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess><bpmn:boundaryEvent id="B" attachedToRef="SP">${TIMER}</bpmn:boundaryEvent>`,
          ),
        ),
        report: connected('boundary event B', 'invalid reference in boundary event'),
      },
      {
        name: 'an ad-hoc sub-process with a valid multi-instance loop',
        moddleElement: engineModel(
          'c7',
          beside(`<bpmn:adHocSubProcess id="SP">${LOOP}${userTask('T')}</bpmn:adHocSubProcess>`),
        ),
        report: LOOP_REPORT,
      },
      {
        name: 'an ad-hoc sub-process with a multi-instance loop without cardinality',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="SP"><bpmn:multiInstanceLoopCharacteristics />${userTask('T')}</bpmn:adHocSubProcess>`,
          ),
        ),
        report: LOOP_REPORT,
      },
    ],
  });
});

describe('c7-start-event', () => {
  const ROOTS =
    '<bpmn:signal id="Sig" name="Go" /><bpmn:message id="M" name="Pay" /><bpmn:message id="M2" name="Pay2" />';
  const CYCLE =
    '<bpmn:timerEventDefinition><bpmn:timeCycle xsi:type="bpmn:tFormalExpression">R/PT1H</bpmn:timeCycle></bpmn:timerEventDefinition>';
  const MESSAGE = '<bpmn:messageEventDefinition messageRef="M" />';
  const flow = (id: string, source: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;
  const BODY = `<bpmn:userTask id="T" /><bpmn:endEvent id="End" />${flow('F1', 'T', 'End')}`;
  const twoStarts = (prefix: string) =>
    `<bpmn:startEvent id="${prefix}_S0" /><bpmn:startEvent id="${prefix}_S1" /><bpmn:endEvent id="${prefix}_E" />${flow(`${prefix}_f0`, `${prefix}_S0`, `${prefix}_E`)}${flow(`${prefix}_f1`, `${prefix}_S1`, `${prefix}_E`)}`;
  const START = '<bpmn:startEvent id="Start" />';

  const missing = (id: string, message: string) => ({
    id,
    message,
    path: ['flowElements'],
    type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
  });
  const extra = (id: string, message: string) => ({
    id,
    message,
    type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
  });
  const secondOfProcess = (id: string) =>
    extra(
      id,
      `Start event ${id} is a second none or timer start event of process process_test (with Start); the engines allow only one and refuse the file`,
    );

  verifyEngineRule('c7-start-event', rule, {
    valid: [
      {
        name: 'none, message and signal start events',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:startEvent id="S2">${MESSAGE}</bpmn:startEvent><bpmn:startEvent id="S3"><bpmn:signalEventDefinition signalRef="Sig" /></bpmn:startEvent>${BODY}`,
          { roots: ROOTS },
        ),
      },
      {
        name: 'a transaction without start event (c7-transaction-start)',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:transaction id="SP"><bpmn:userTask id="U" /></bpmn:transaction>`,
        ),
      },
      {
        name: 'an event sub-process without start event',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="ES" triggeredByEvent="true" />`,
        ),
      },
      {
        name: 'an ad-hoc sub-process: its content is skipped',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:adHocSubProcess id="SP"><bpmn:serviceTask id="X" /><bpmn:subProcess id="Z"><bpmn:userTask id="Z1" /></bpmn:subProcess><bpmn:startEvent id="A1" /><bpmn:startEvent id="A2" /></bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a non-executable process without start event',
        moddleElement: engineModel('c7', BODY, { processAttributes: 'isExecutable="false"' }),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', `${START}<bpmn:startEvent id="S2" />${BODY}`),
      },
    ],
    invalid: [
      {
        name: 'two none start events',
        moddleElement: engineModel('c7', `${START}<bpmn:startEvent id="S2" />${BODY}`),
        report: secondOfProcess('S2'),
      },
      {
        name: 'none and timer start event',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:startEvent id="S2">${CYCLE}</bpmn:startEvent>${BODY}`,
        ),
        report: secondOfProcess('S2'),
      },
      {
        name: 'two timer start events',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="Start">${CYCLE}</bpmn:startEvent><bpmn:startEvent id="S2">${CYCLE}</bpmn:startEvent>${BODY}`,
        ),
        report: secondOfProcess('S2'),
      },
      {
        name: 'a message + timer start event is a second timer start event',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:startEvent id="S2">${MESSAGE}${CYCLE}</bpmn:startEvent>${BODY}`,
          { roots: ROOTS },
        ),
        report: secondOfProcess('S2'),
      },
      {
        name: 'sub-process with two start events',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="Sub">${twoStarts('Sub')}</bpmn:subProcess>`,
        ),
        report: extra(
          'Sub_S1',
          'Sub-process Sub has 2 start events (Sub_S0, Sub_S1); the engines allow only one in a sub-process and refuse the file',
        ),
      },
      {
        name: 'transaction with two start events',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:transaction id="Sub">${twoStarts('Sub')}</bpmn:transaction>`,
        ),
        report: extra(
          'Sub_S1',
          'Transaction Sub has 2 start events (Sub_S0, Sub_S1); the engines allow only one in a sub-process and refuse the file',
        ),
      },
      {
        name: 'event sub-process with two message start events',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ES1">${MESSAGE}</bpmn:startEvent><bpmn:startEvent id="ES2"><bpmn:messageEventDefinition messageRef="M2" /></bpmn:startEvent></bpmn:subProcess>`,
          { roots: ROOTS },
        ),
        report: extra(
          'ES2',
          'Event sub-process ES has 2 start events (ES1, ES2); the engines allow only one in a sub-process and refuse the file',
        ),
      },
      {
        name: 'process with nodes but no start event',
        moddleElement: engineModel('c7', BODY),
        report: missing(
          'process_test',
          'Process process_test has no start event; the engines refuse the file (process must define a startEvent element)',
        ),
      },
      {
        name: 'process with only an event sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ES_S">${MESSAGE}</bpmn:startEvent></bpmn:subProcess>`,
          { roots: ROOTS },
        ),
        report: missing(
          'process_test',
          'Process process_test has no start event; the engines refuse the file (process must define a startEvent element)',
        ),
      },
      {
        name: 'empty process',
        moddleElement: engineModel('c7', ''),
        report: missing(
          'process_test',
          'Process process_test is empty, without a start event; the engines refuse the file (process must define a startEvent element)',
        ),
      },
      {
        name: 'sub-process with a task but no start event',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="Sub"><bpmn:userTask id="ST" /></bpmn:subProcess>`,
        ),
        report: missing(
          'Sub',
          'Sub-process Sub has no start event; the engines refuse the file (subProcess must define a startEvent element)',
        ),
      },
      {
        name: 'empty sub-process',
        moddleElement: engineModel('c7', `${START}<bpmn:subProcess id="SP" />`),
        report: missing(
          'SP',
          'Sub-process SP is empty, without a start event; the engines refuse the file (subProcess must define a startEvent element)',
        ),
      },
    ],
  });
});

describe('c7-transaction-start', () => {
  const MESSAGES = '<bpmn:message id="M1" name="Verify1" />';
  const START = '<bpmn:startEvent id="Start" />';
  const transaction = (inner: string) =>
    `${START}<bpmn:transaction id="SP">${inner}</bpmn:transaction>`;
  const WITH_START =
    '<bpmn:startEvent id="SS" /><bpmn:userTask id="T" /><bpmn:endEvent id="SE" /><bpmn:sequenceFlow id="s1" sourceRef="SS" targetRef="T" /><bpmn:sequenceFlow id="s2" sourceRef="T" targetRef="SE" />';

  const report = (what: string) => ({
    id: 'SP',
    message: `Transaction SP ${what}: it deploys, but every instance that reaches it fails ("No initial activity found for subprocess SP")`,
    path: ['flowElements'],
    type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
  });

  verifyEngineRule('c7-transaction-start', rule, {
    valid: [
      {
        name: 'a transaction with a start event',
        moddleElement: engineModel('c7', transaction(WITH_START)),
      },
      {
        name: 'an embedded sub-process without start event (c7-start-event)',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="SP"><bpmn:userTask id="T" /></bpmn:subProcess>`,
        ),
      },
      {
        name: 'a transaction without start event in a non-executable process',
        moddleElement: engineModel('c7', transaction('<bpmn:userTask id="T" />'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a transaction without start event in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${transaction('<bpmn:userTask id="T" />')}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', transaction('<bpmn:userTask id="T" />')),
      },
    ],
    invalid: [
      {
        name: 'a transaction with a task but no start event',
        moddleElement: engineModel('c7', transaction('<bpmn:userTask id="T" />')),
        report: report('has no start event'),
      },
      {
        name: 'an empty transaction',
        moddleElement: engineModel('c7', `${START}<bpmn:transaction id="SP" />`),
        report: report('is empty, without a start event'),
      },
      {
        name: 'a transaction with only an event sub-process',
        moddleElement: engineModel(
          'c7',
          transaction(
            '<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ESS" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M1" /></bpmn:startEvent><bpmn:endEvent id="ESE" /><bpmn:sequenceFlow id="e1" sourceRef="ESS" targetRef="ESE" /></bpmn:subProcess>',
          ),
          { roots: MESSAGES },
        ),
        report: report('has no start event'),
      },
    ],
  });
});
