import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-implementation.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ext = (content: string) => `<bpmn:extensionElements>${content}</bpmn:extensionElements>`;
const COMMAND =
  '<camunda:field name="command"><camunda:string>echo</camunda:string></camunda:field>';
const shell = (fields: string, tag = 'serviceTask', type = 'shell') =>
  `<bpmn:${tag} id="serviceTask_runScript" camunda:type="${type}">${ext(fields)}</bpmn:${tag}>`;
const MISSING = (label: string, decision = '') =>
  `${label} has no implementation (camunda:class, delegateExpression, expression, type=external${decision} or a connector); the engines refuse the file`;

verifyEngineRule('c7-implementation', rule, {
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
      name: 'a shell field without a value (left to c7-extension)',
      moddleElement: engineModel('c7', shell(`${COMMAND}<camunda:field name="wait" />`)),
    },
    {
      name: 'a message throw event without implementation (c7-message-implementation)',
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
    {
      name: 'a shell task without a command field',
      moddleElement: engineModel('c7', shell('')),
      report: {
        id: 'serviceTask_runScript',
        message:
          'serviceTask serviceTask_runScript is a shell task without a camunda:field named command; the engines refuse the file',
        path: ['extensionElements'],
        type: ERROR_TYPES.EXTENSION_ELEMENT_REQUIRED,
      },
    },
    {
      name: 'a shell task with an expression field',
      moddleElement: engineModel(
        'c7',
        shell('<camunda:field name="command" expression="${cmd}" />'),
      ),
      report: {
        id: 'serviceTask_runScript',
        message:
          'camunda:field "command" of shell task serviceTask serviceTask_runScript is an expression; the shell task takes fixed values only and the engines refuse the file',
        path: ['extensionElements', 'values', 0, 'expression'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
    {
      name: 'a shell task with wait=maybe',
      moddleElement: engineModel(
        'c7',
        shell(
          `${COMMAND}<camunda:field name="wait"><camunda:string>maybe</camunda:string></camunda:field>`,
        ),
      ),
      report: {
        id: 'serviceTask_runScript',
        message:
          'camunda:field "wait" of shell task serviceTask serviceTask_runScript is "maybe", not true or false; the engines refuse the file',
        path: ['extensionElements', 'values', 1, 'string'],
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
    {
      name: 'a shell task with cleanEnv="no" as attribute',
      moddleElement: engineModel(
        'c7',
        shell(`${COMMAND}<camunda:field name="cleanEnv" stringValue="no" />`),
      ),
      report: {
        id: 'serviceTask_runScript',
        message:
          'camunda:field "cleanEnv" of shell task serviceTask serviceTask_runScript is "no", not true or false; the engines refuse the file',
        path: ['extensionElements', 'values', 1, 'stringValue'],
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
  ],
});
