import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7DecisionResultMapperKnownRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-decision-result-mapper-known', () => {
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
        name: 'a mapDecisionResult not one of the four',
        moddleElement: engineModel(
          'c7',
          '<bpmn:businessRuleTask id="businessRuleTask_b" camunda:decisionRef="risk" camunda:mapDecisionResult="foo" />',
        ),
        report: {
          id: 'businessRuleTask_b',
          message:
            'camunda:mapDecisionResult="foo" on businessRuleTask businessRuleTask_b is not one of singleEntry, singleResult, collectEntries, resultList; the engines refuse the file',
          path: ['mapDecisionResult'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});
