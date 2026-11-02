import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7EventGatewayBranchesUniqueRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-event-gateway-branches-unique', () => {
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

  verifyEngineRule(rule, {
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
