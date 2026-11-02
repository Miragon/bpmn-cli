import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7JobPriorityValidRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-job-priority-valid', () => {
  const NOT_A_NUMBER = (attribute: string, value: string, where: string) =>
    `camunda:${attribute}="${value}" on ${where} is not a number or expression; the engines refuse it`;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'priorities as numbers and expressions, a known decision result mapper',
        moddleElement: engineModel(
          'c7',
          `<bpmn:serviceTask id="serviceTask_a" camunda:type="external" camunda:topic="chargeCard" camunda:taskPriority="5" camunda:asyncBefore="true" camunda:jobPriority="\${priority}" />
          <bpmn:businessRuleTask id="businessRuleTask_b" camunda:decisionRef="risk" camunda:mapDecisionResult="collectEntries" />
          <bpmn:userTask id="userTask_c"><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${items}" camunda:elementVariable="item" camunda:jobPriority="-3" /></bpmn:userTask>`,
          {
            processAttributes:
              'isExecutable="true" camunda:jobPriority="10" camunda:taskPriority="#{priority}"',
          },
        ),
      },
      {
        name: 'a mapDecisionResult without decisionRef is not read',
        moddleElement: engineModel(
          'c7',
          '<bpmn:businessRuleTask id="businessRuleTask_b" camunda:class="org.example.Rule" camunda:mapDecisionResult="foo" />',
        ),
      },
      {
        name: 'a taskPriority where the engines do not read it',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_a" camunda:class="org.example.Bean" camunda:taskPriority="high" /><bpmn:userTask id="userTask_c" camunda:taskPriority="high" />',
        ),
      },
      {
        name: 'an ad-hoc sub-process and its content',
        moddleElement: engineModel(
          'c7',
          '<bpmn:adHocSubProcess id="adHocSubProcess_x" camunda:jobPriority="high"><bpmn:userTask id="userTask_c" camunda:jobPriority="high" /></bpmn:adHocSubProcess>',
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_c" camunda:jobPriority="high" />',
          {
            processAttributes: 'isExecutable="false" camunda:jobPriority="high"',
          },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_c" camunda:jobPriority="high" />',
          {
            definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
          },
        ),
      },
    ],
    invalid: [
      {
        name: 'a jobPriority that is not a number',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_a" camunda:class="org.example.Bean" camunda:asyncBefore="true" camunda:jobPriority="high" />',
        ),
        report: {
          id: 'serviceTask_a',
          message: NOT_A_NUMBER('jobPriority', 'high', 'serviceTask serviceTask_a'),
          path: ['jobPriority'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'process priorities that are not numbers',
        moddleElement: engineModel('c7', '', {
          processAttributes:
            'isExecutable="true" camunda:jobPriority="high" camunda:taskPriority="1.5"',
        }),
        report: [
          {
            id: 'process_test',
            message: NOT_A_NUMBER('jobPriority', 'high', 'process process_test'),
            path: ['jobPriority'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
          {
            id: 'process_test',
            message: NOT_A_NUMBER('taskPriority', '1.5', 'process process_test'),
            path: ['taskPriority'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'a jobPriority on the multi-instance loop',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_c"><bpmn:multiInstanceLoopCharacteristics camunda:collection="${items}" camunda:jobPriority=" 5" /></bpmn:userTask>',
        ),
        report: {
          id: 'userTask_c',
          message: NOT_A_NUMBER(
            'jobPriority',
            ' 5',
            'the multiInstanceLoopCharacteristics of userTask userTask_c',
          ),
          path: ['loopCharacteristics', 'jobPriority'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a taskPriority of an external message end event',
        moddleElement: engineModel(
          'c7',
          '<bpmn:endEvent id="endEvent_done"><bpmn:messageEventDefinition camunda:type="external" camunda:topic="notify" camunda:taskPriority="high" /></bpmn:endEvent>',
        ),
        report: {
          id: 'endEvent_done',
          message: NOT_A_NUMBER(
            'taskPriority',
            'high',
            'the messageEventDefinition of endEvent:message endEvent_done',
          ),
          path: ['eventDefinitions', 0, 'taskPriority'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});
