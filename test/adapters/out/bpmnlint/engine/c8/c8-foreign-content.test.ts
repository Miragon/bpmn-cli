import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-foreign-content.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const USER_TASK = (attributes: string, inner = '') =>
  `<bpmn:userTask id="userTask_review" ${attributes}>${ext(`<zeebe:userTask />${inner}`)}</bpmn:userTask>`;
const INPUT_OUTPUT = (prefix: string) =>
  `<${prefix}:inputOutput><${prefix}:inputParameter name="a">1</${prefix}:inputParameter></${prefix}:inputOutput>`;

verifyEngineRule('c8-foreign-content', rule, {
  valid: [
    {
      name: 'zeebe content only',
      moddleElement: engineModel(
        'c8',
        USER_TASK('', '<zeebe:assignmentDefinition assignee="demo" />'),
        { definitionsAttributes: CAMUNDA },
      ),
    },
    {
      name: 'Camunda 7 content in a non-executable process',
      moddleElement: engineModel(
        'c8',
        USER_TASK('camunda:assignee="demo"', INPUT_OUTPUT('camunda')),
        {
          definitionsAttributes: CAMUNDA,
          processAttributes: 'isExecutable="false"',
        },
      ),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel(
        'c7',
        '<bpmn:userTask id="userTask_review" camunda:assignee="demo" />',
      ),
    },
  ],
  invalid: [
    {
      name: 'a Camunda 7 attribute and extension element',
      moddleElement: engineModel(
        'c8',
        USER_TASK('camunda:assignee="demo"', INPUT_OUTPUT('camunda')),
        {
          definitionsAttributes: CAMUNDA,
        },
      ),
      report: [
        {
          id: 'userTask_review',
          message:
            'userTask userTask_review carries the Camunda 7 attribute camunda:assignee, which Camunda 8 ignores',
          path: ['camunda:assignee'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
        {
          id: 'userTask_review',
          message:
            'userTask userTask_review contains the Camunda 7 extension camunda:inputOutput, which Camunda 8 ignores',
          path: ['extensionElements', 'values', 1],
          type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
        },
      ],
    },
    {
      name: 'Operaton content under another prefix',
      moddleElement: engineModel(
        'c8',
        `<bpmn:serviceTask id="serviceTask_charge" op:asyncBefore="true">${ext(
          `<zeebe:taskDefinition type="charge" />${INPUT_OUTPUT('op')}`,
        )}</bpmn:serviceTask>`,
        { definitionsAttributes: 'xmlns:op="http://operaton.org/schema/1.0/bpmn"' },
      ),
      report: [
        {
          id: 'serviceTask_charge',
          message:
            'serviceTask serviceTask_charge carries the Camunda 7 attribute op:asyncBefore, which Camunda 8 ignores',
          path: ['op:asyncBefore'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
        {
          id: 'serviceTask_charge',
          message:
            'serviceTask serviceTask_charge contains the Camunda 7 extension op:inputOutput, which Camunda 8 ignores',
          path: ['extensionElements', 'values', 1],
          type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
        },
      ],
    },
    {
      name: 'a Camunda 7 attribute on an event definition',
      moddleElement: engineModel(
        'c8',
        `<bpmn:endEvent id="endEvent_notified">
          <bpmn:messageEventDefinition id="messageEventDefinition_notified" camunda:topic="notify" />
        </bpmn:endEvent>`,
        { definitionsAttributes: CAMUNDA },
      ),
      report: {
        id: 'endEvent_notified',
        message:
          'messageEventDefinition messageEventDefinition_notified carries the Camunda 7 attribute camunda:topic, which Camunda 8 ignores',
        path: ['eventDefinitions', 0, 'camunda:topic'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
  ],
});
