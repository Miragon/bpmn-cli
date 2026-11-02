import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7BindingKnownRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-binding-known', () => {
  const conditional = (variableEvents: string) =>
    `<bpmn:intermediateCatchEvent id="event_wait"><bpmn:conditionalEventDefinition camunda:variableEvents="${variableEvents}"><bpmn:condition xsi:type="bpmn:tFormalExpression">\${ready}</bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>`;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'Camunda Modeler style values',
        moddleElement: engineModel(
          'c7',
          `<bpmn:serviceTask id="serviceTask_a" camunda:type="external" camunda:topic="chargeCard" />
          <bpmn:userTask id="userTask_b" camunda:priority="\${priority}" />
          <bpmn:userTask id="userTask_c" camunda:priority="50" />
          <bpmn:callActivity id="callActivity_d" calledElement="other" camunda:calledElementBinding="versionTag" camunda:calledElementVersionTag="1.0" camunda:caseBinding="deployment" />
          <bpmn:businessRuleTask id="businessRuleTask_e" camunda:decisionRef="risk" camunda:decisionRefBinding="latest" />
          ${conditional('create, update')}`,
        ),
      },
      {
        name: 'a missing version is c7-binding-needs-version, a missing calledElement c7-call-activity-one-called-element',
        moddleElement: engineModel(
          'c7',
          `<bpmn:callActivity id="callActivity_d" calledElement="other" camunda:calledElementBinding="version" />
          <bpmn:callActivity id="callActivity_e" />
          <bpmn:callActivity id="callActivity_f" calledElement="" camunda:caseRef="case" />`,
        ),
      },
      {
        name: 'a decisionRefBinding without decisionRef is not read',
        moddleElement: engineModel(
          'c7',
          '<bpmn:businessRuleTask id="businessRuleTask_e" camunda:class="org.example.Rule" camunda:decisionRefBinding="foo" />',
        ),
      },
      {
        name: 'a variable event on a definition the engines do not act on',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateCatchEvent id="event_wait"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition><bpmn:conditionalEventDefinition camunda:variableEvents="change"><bpmn:condition xsi:type="bpmn:tFormalExpression">\${ready}</bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>`,
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_b" camunda:priority="high" />',
          {
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_b" camunda:priority="high" />',
          {
            definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
          },
        ),
      },
    ],
    invalid: [
      {
        name: 'unknown binding values',
        moddleElement: engineModel(
          'c7',
          `<bpmn:callActivity id="callActivity_d" calledElement="other" camunda:calledElementBinding="foo" />
          <bpmn:businessRuleTask id="businessRuleTask_e" camunda:decisionRef="risk" camunda:decisionRefBinding="foo" />`,
        ),
        report: [
          {
            id: 'callActivity_d',
            message:
              'camunda:calledElementBinding="foo" on callActivity callActivity_d is not one of latest, deployment, version, versionTag; the engines accept the file but cannot resolve the reference as intended',
            path: ['calledElementBinding'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
          {
            id: 'businessRuleTask_e',
            message:
              'camunda:decisionRefBinding="foo" on businessRuleTask businessRuleTask_e is not one of latest, deployment, version, versionTag; the engines accept the file but cannot resolve the reference as intended',
            path: ['decisionRefBinding'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'a caseBinding of versionTag',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_d" camunda:caseRef="case" camunda:caseBinding="versionTag" />',
        ),
        report: {
          id: 'callActivity_d',
          message:
            'camunda:caseBinding="versionTag" on callActivity callActivity_d is not one of latest, deployment, version; the engines accept the file but cannot resolve the reference as intended',
          path: ['caseBinding'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});
