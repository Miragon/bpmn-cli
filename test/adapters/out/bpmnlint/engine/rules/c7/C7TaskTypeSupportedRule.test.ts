import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7TaskTypeSupportedRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-task-type-supported', () => {
  const ext = (content: string) => `<bpmn:extensionElements>${content}</bpmn:extensionElements>`;
  const COMMAND =
    '<camunda:field name="command"><camunda:string>echo</camunda:string></camunda:field>';
  const shell = (fields: string, tag = 'serviceTask', type = 'shell') =>
    `<bpmn:${tag} id="serviceTask_runScript" camunda:type="${type}">${ext(fields)}</bpmn:${tag}>`;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'tasks implemented by a delegate, an expression, an external topic, a connector or a decision',
        moddleElement: engineModel(
          'c7',
          `<bpmn:serviceTask id="serviceTask_a" camunda:class="org.example.Charge" />
          <bpmn:serviceTask id="serviceTask_b" camunda:delegateExpression="\${charge}" />
          <bpmn:serviceTask id="serviceTask_c" camunda:expression="\${charge.run()}" />
          <bpmn:serviceTask id="serviceTask_d" camunda:type="external" camunda:topic="chargeCard" />
          <bpmn:serviceTask id="serviceTask_e">${ext('<camunda:connector><camunda:connectorId>http-connector</camunda:connectorId></camunda:connector>')}</bpmn:serviceTask>
          <bpmn:businessRuleTask id="businessRuleTask_f" camunda:decisionRef="risk" camunda:mapDecisionResult="singleEntry" />
          <bpmn:sendTask id="sendTask_g" camunda:type="External" camunda:topic="notify" />`,
        ),
      },
      { name: 'a shell task with a command field', moddleElement: engineModel('c7', shell(COMMAND)) },
      {
        name: 'SHELL on a send task with a stringValue command and wait=TRUE',
        moddleElement: engineModel(
          'c7',
          shell(
            '<camunda:field name="command" stringValue="echo" /><camunda:field name="wait" stringValue="TRUE" />',
            'sendTask',
            'SHELL',
          ),
        ),
      },
      {
        name: 'a shell message end event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:endEvent id="endEvent_done"><bpmn:messageEventDefinition camunda:type="shell">${ext(COMMAND)}</bpmn:messageEventDefinition></bpmn:endEvent>`,
        ),
      },
      {
        name: 'a shell field without a value (left to c7-field-needs-one-value)',
        moddleElement: engineModel('c7', shell(`${COMMAND}<camunda:field name="wait" />`)),
      },
      {
        name: 'a message throw event without implementation (c7-message-throw-needs-implementation)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:intermediateThrowEvent id="event_notify"><bpmn:messageEventDefinition /></bpmn:intermediateThrowEvent>',
        ),
      },
      {
        name: 'a service task without implementation in a non-executable process',
        moddleElement: engineModel('c7', '<bpmn:serviceTask id="serviceTask_x" />', {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a service task without implementation in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:adHocSubProcess id="adHocSubProcess_x"><bpmn:serviceTask id="serviceTask_x" /></bpmn:adHocSubProcess>',
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:serviceTask id="serviceTask_x" camunda:type="foo" />',
          {
            definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
          },
        ),
      },
    ],
    invalid: [
      {
        name: 'a camunda:type other than external or shell',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_x" camunda:type="foo" camunda:topic="t" />',
        ),
        report: {
          id: 'serviceTask_x',
          message:
            'camunda:type="foo" on serviceTask serviceTask_x is not supported (only "external" and "shell"); the engines refuse the file',
          path: ['type'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a mail task',
        moddleElement: engineModel(
          'c7',
          shell(
            '<camunda:field name="to" stringValue="a@b.c" /><camunda:field name="text" stringValue="x" />',
            'serviceTask',
            'mail',
          ),
        ),
        report: {
          id: 'serviceTask_runScript',
          message:
            'camunda:type="mail" on serviceTask serviceTask_runScript is not supported (only "external" and "shell") (the standard engine distributions cannot load the mail task); the engines refuse the file',
          path: ['type'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a message end event with an unsupported type',
        moddleElement: engineModel(
          'c7',
          '<bpmn:endEvent id="endEvent_done"><bpmn:messageEventDefinition camunda:type="foo" /></bpmn:endEvent>',
        ),
        report: {
          id: 'endEvent_done',
          message:
            'camunda:type="foo" on endEvent:message endEvent_done is not supported (only "external" and "shell"); the engines refuse the file',
          path: ['eventDefinitions', 0, 'type'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});
