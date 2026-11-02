import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7ExternalTaskNeedsTopicRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-external-task-needs-topic', () => {
  verifyEngineRule(rule, {
    valid: [
      {
        name: 'external tasks and message events with a topic',
        moddleElement: engineModel(
          'c7',
          `<bpmn:serviceTask id="serviceTask_charge" camunda:type="external" camunda:topic="chargeCard" />
          <bpmn:endEvent id="endEvent_done"><bpmn:messageEventDefinition camunda:type="External" camunda:topic="notify" /></bpmn:endEvent>`,
        ),
      },
      {
        name: 'an empty topic (c7-bad-value)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_charge" camunda:type="external" camunda:topic="" />',
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_charge" camunda:type="external" />',
          {
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:serviceTask id="serviceTask_charge" camunda:type="external" />',
          {
            definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
          },
        ),
      },
    ],
    invalid: [
      {
        name: 'an external task without topic',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_charge" camunda:type="external" />',
        ),
        report: {
          id: 'serviceTask_charge',
          message:
            'serviceTask serviceTask_charge is an external task without camunda:topic; the engines refuse the file',
          path: ['topic'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'an external message end event without topic',
        moddleElement: engineModel(
          'c7',
          '<bpmn:endEvent id="endEvent_done"><bpmn:messageEventDefinition camunda:type="external" /></bpmn:endEvent>',
        ),
        report: {
          id: 'endEvent_done',
          message:
            'endEvent:message endEvent_done is an external task without camunda:topic; the engines refuse the file',
          path: ['eventDefinitions', 0, 'topic'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});
