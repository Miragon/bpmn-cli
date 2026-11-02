import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7TaskNeedsImplementationRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-task-needs-implementation', () => {
  const ext = (content: string) => `<bpmn:extensionElements>${content}</bpmn:extensionElements>`;
  const COMMAND =
    '<camunda:field name="command"><camunda:string>echo</camunda:string></camunda:field>';
  const shell = (fields: string, tag = 'serviceTask', type = 'shell') =>
    `<bpmn:${tag} id="serviceTask_runScript" camunda:type="${type}">${ext(fields)}</bpmn:${tag}>`;
  const MISSING = (label: string, decision = '') =>
    `${label} has no implementation (camunda:class, delegateExpression, expression, type=external${decision} or a connector); the engines refuse the file`;

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
      ...['serviceTask', 'sendTask'].map((tag) => ({
        name: `a ${tag} without implementation`,
        moddleElement: engineModel('c7', `<bpmn:${tag} id="task_x" />`),
        report: {
          id: 'task_x',
          message: MISSING(`${tag} task_x`),
          path: ['type'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      })),
      {
        name: 'a business rule task without decisionRef or implementation',
        moddleElement: engineModel('c7', '<bpmn:businessRuleTask id="businessRuleTask_x" />'),
        report: {
          id: 'businessRuleTask_x',
          message: MISSING('businessRuleTask businessRuleTask_x', ', decisionRef'),
          path: ['type'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'a topic without type=external',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_x" camunda:topic="chargeCard" />',
        ),
        report: {
          id: 'serviceTask_x',
          message: MISSING('serviceTask serviceTask_x'),
          path: ['type'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'an empty expression counts as none',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_x" camunda:expression="" />',
        ),
        report: {
          id: 'serviceTask_x',
          message: MISSING('serviceTask serviceTask_x'),
          path: ['type'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});
