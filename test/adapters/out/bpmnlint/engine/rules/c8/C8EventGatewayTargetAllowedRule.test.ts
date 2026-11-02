import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8EventGatewayTargetAllowedRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-event-gateway-target-allowed', () => {
  const TIMER_CATCH =
    '<bpmn:intermediateCatchEvent id="{id}">{in}<bpmn:timerEventDefinition id="timer_{id}"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>';
  const MESSAGE_CATCH =
    '<bpmn:intermediateCatchEvent id="{id}">{in}<bpmn:messageEventDefinition id="message_{id}" messageRef="M1" /></bpmn:intermediateCatchEvent>';
  const MESSAGE = '<bpmn:message id="M1" name="M1" />';
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

  verifyEngineRule(rule, {
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
