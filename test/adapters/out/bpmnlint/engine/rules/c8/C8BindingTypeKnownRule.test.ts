import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8BindingTypeKnownRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-binding-type-known', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const SERVICE_TASK = (extra = '') =>
    `<bpmn:serviceTask id="serviceTask_charge">${ext(`<zeebe:taskDefinition type="charge" />${extra}`)}</bpmn:serviceTask>`;
  const HEADERS = (...keys: string[]) =>
    `<zeebe:taskHeaders>${keys.map((key, index) => `<zeebe:header key="${key}" value="v${index}" />`).join('')}</zeebe:taskHeaders>`;
  const CONDITIONAL = (filter: string) => `
    <bpmn:intermediateCatchEvent id="event_stockChanged">
      <bpmn:conditionalEventDefinition id="conditionalEventDefinition_stockChanged">
        ${ext(filter)}
        <bpmn:condition xsi:type="bpmn:tFormalExpression">= stock &gt; 0</bpmn:condition>
      </bpmn:conditionalEventDefinition>
    </bpmn:intermediateCatchEvent>`;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'every binding type, a version tag where it binds by version tag',
        moddleElement: engineModel(
          'c8',
          `<bpmn:callActivity id="callActivity_ship">${ext('<zeebe:calledElement processId="ship" bindingType="deployment" />')}</bpmn:callActivity>
          <bpmn:businessRuleTask id="businessRuleTask_rate">${ext('<zeebe:calledDecision decisionId="rate" resultVariable="rate" bindingType="latest" />')}</bpmn:businessRuleTask>
          <bpmn:userTask id="userTask_review">${ext('<zeebe:userTask /><zeebe:formDefinition formId="review" bindingType="versionTag" versionTag="v1" />')}</bpmn:userTask>`,
        ),
      },
      {
        name: 'a version tag binding without version tag on a business rule task (camunda-compat reports it)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:businessRuleTask id="businessRuleTask_rate">${ext('<zeebe:calledDecision decisionId="rate" resultVariable="rate" bindingType="versionTag" />')}</bpmn:businessRuleTask>`,
        ),
      },
      {
        name: 'a complete linked resource, variable events create and update',
        moddleElement: engineModel(
          'c8',
          `${SERVICE_TASK('<zeebe:linkedResources><zeebe:linkedResource resourceId="r" resourceType="RPA" linkName="robot" bindingType="versionTag" versionTag="v1" /></zeebe:linkedResources>')}
          ${CONDITIONAL('<zeebe:conditionalFilter variableNames="stock" variableEvents="create, update" />')}`,
        ),
      },
      {
        name: 'a task header key twice in the first header list (camunda-compat reports it)',
        moddleElement: engineModel('c8', SERVICE_TASK(HEADERS('region', 'region'))),
      },
      {
        name: 'mappings without target or source (camunda-compat reports them)',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            '<zeebe:ioMapping><zeebe:input source="=a" /><zeebe:input source="=a" target=" " /><zeebe:output source="=a" target="1x" /><zeebe:output target="a" /></zeebe:ioMapping>',
          ),
        ),
      },
      {
        name: 'an unknown binding type in a non-executable process',
        moddleElement: engineModel(
          'c8',
          `<bpmn:callActivity id="callActivity_ship">${ext('<zeebe:calledElement processId="ship" bindingType="foo" />')}</bpmn:callActivity>`,
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'a linked resource on a user task (c8-zeebe-extension-placement reports it)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:userTask id="userTask_review">${ext('<zeebe:userTask /><zeebe:linkedResources><zeebe:linkedResource resourceId="r" /></zeebe:linkedResources>')}</bpmn:userTask>`,
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_ship" calledElement="ship" camunda:calledElementBinding="foo" />',
        ),
      },
    ],
    invalid: [
      {
        name: 'an unknown binding type',
        moddleElement: engineModel(
          'c8',
          `<bpmn:callActivity id="callActivity_ship">${ext('<zeebe:calledElement processId="ship" bindingType="foo" />')}</bpmn:callActivity>`,
        ),
        report: {
          id: 'callActivity_ship',
          message:
            'zeebe:calledElement of callActivity callActivity_ship has bindingType="foo"; Camunda 8 accepts deployment, latest, versionTag only and refuses the file',
          path: ['extensionElements', 'values', 0, 'bindingType'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'linked resources with an unknown binding type and without version tag',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            '<zeebe:linkedResources><zeebe:linkedResource resourceId="r" resourceType="RPA" bindingType="foo" /><zeebe:linkedResource resourceId="s" resourceType="RPA" bindingType="versionTag" /></zeebe:linkedResources>',
          ),
        ),
        report: {
            id: 'serviceTask_charge',
            message:
              'Linked resource 1 of serviceTask serviceTask_charge has bindingType="foo"; Camunda 8 accepts deployment, latest, versionTag only and refuses the file',
            path: ['extensionElements', 'values', 1, 'values', 0, 'bindingType'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
      },
    ],
  });
});
