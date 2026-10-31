import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7VariableEventsKnownRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-variable-events-known', () => {
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
        name: 'a variable event the engines do not know',
        moddleElement: engineModel('c7', conditional('create, change')),
        report: {
          id: 'event_wait',
          message:
            'camunda:variableEvents="create, change" of intermediateCatchEvent:conditional event_wait lists change; only create, update, delete trigger the condition',
          path: ['eventDefinitions', 0, 'variableEvents'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});
