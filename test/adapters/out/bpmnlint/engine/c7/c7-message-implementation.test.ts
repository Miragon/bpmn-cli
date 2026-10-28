import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-message-implementation.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const throwEvent = (definition: string, attributes = '') =>
  `<bpmn:intermediateThrowEvent id="event_notify" ${attributes}>${definition}</bpmn:intermediateThrowEvent>`;
const REPORT = (id: string, label: string, index = 0) => ({
  id,
  message: `${label} has no implementation: it sends nothing and behaves like a none event at run time`,
  path: ['eventDefinitions', index, 'type'],
  type: ERROR_TYPES.PROPERTY_REQUIRED,
});

verifyEngineRule('c7-message-implementation', rule, {
  valid: [
    {
      name: 'message throw events with an external topic, a delegate and a connector',
      moddleElement: engineModel(
        'c7',
        `<bpmn:intermediateThrowEvent id="event_a"><bpmn:messageEventDefinition camunda:type="external" camunda:topic="notify" /></bpmn:intermediateThrowEvent>
        <bpmn:endEvent id="event_b"><bpmn:messageEventDefinition camunda:delegateExpression="\${notify}" /></bpmn:endEvent>
        <bpmn:endEvent id="event_c"><bpmn:extensionElements><camunda:connector><camunda:connectorId>mail-send</camunda:connectorId></camunda:connector></bpmn:extensionElements><bpmn:messageEventDefinition /></bpmn:endEvent>`,
      ),
    },
    {
      name: 'the implementation sits on the event (c7-misplaced-attribute)',
      moddleElement: engineModel(
        'c7',
        throwEvent('<bpmn:messageEventDefinition />', 'camunda:delegateExpression="${notify}"'),
      ),
    },
    {
      name: 'an unsupported type (c7-implementation)',
      moddleElement: engineModel(
        'c7',
        throwEvent('<bpmn:messageEventDefinition camunda:type="foo" />'),
      ),
    },
    {
      name: 'a message catch event',
      moddleElement: engineModel(
        'c7',
        '<bpmn:intermediateCatchEvent id="event_wait"><bpmn:messageEventDefinition messageRef="message_paid" /></bpmn:intermediateCatchEvent>',
        { roots: '<bpmn:message id="message_paid" name="paid" />' },
      ),
    },
    {
      name: 'a throw event whose signal the engines act on instead of the message',
      moddleElement: engineModel(
        'c7',
        throwEvent(
          '<bpmn:messageEventDefinition /><bpmn:signalEventDefinition signalRef="signal_done" />',
        ),
        { roots: '<bpmn:signal id="signal_done" name="done" />' },
      ),
    },
    {
      name: 'a non-executable process',
      moddleElement: engineModel('c7', throwEvent('<bpmn:messageEventDefinition />'), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', throwEvent('<bpmn:messageEventDefinition />')),
    },
  ],
  invalid: [
    {
      name: 'a message throw event without implementation',
      moddleElement: engineModel('c7', throwEvent('<bpmn:messageEventDefinition />')),
      report: REPORT('event_notify', 'intermediateThrowEvent:message event_notify'),
    },
    {
      name: 'a message end event without implementation',
      moddleElement: engineModel(
        'c7',
        '<bpmn:endEvent id="event_done"><bpmn:messageEventDefinition id="messageEventDefinition_done" /></bpmn:endEvent>',
      ),
      report: REPORT('event_done', 'endEvent:message event_done'),
    },
    {
      name: 'an end event whose message the engines act on before the signal',
      moddleElement: engineModel(
        'c7',
        '<bpmn:endEvent id="event_done"><bpmn:signalEventDefinition signalRef="signal_done" /><bpmn:messageEventDefinition /></bpmn:endEvent>',
        { roots: '<bpmn:signal id="signal_done" name="done" />' },
      ),
      report: REPORT('event_done', 'endEvent:signal event_done', 1),
    },
  ],
});
