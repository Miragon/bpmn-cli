import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7BindingNeedsVersionRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-binding-needs-version', () => {
  const MISSING = (where: string, binding: string, value: string, missing: string) =>
    `${where} has camunda:${binding}="${value}" but no camunda:${missing}; the engines refuse the file`;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'bindings with the version or tag they bind to',
        moddleElement: engineModel(
          'c7',
          `<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="version" camunda:calledElementVersion="3" />
          <bpmn:callActivity id="callActivity_b" calledElement="other" camunda:calledElementBinding="versionTag" camunda:calledElementVersionTag="1.0" />
          <bpmn:businessRuleTask id="businessRuleTask_c" camunda:decisionRef="risk" camunda:decisionRefBinding="versionTag" camunda:decisionRefVersionTag="1.0" />
          <bpmn:userTask id="userTask_d" camunda:formRef="form" camunda:formRefBinding="version" camunda:formRefVersion="2" />
          <bpmn:callActivity id="callActivity_e" calledElement="other" camunda:calledElementBinding="latest" />`,
        ),
      },
      {
        name: 'a caseBinding of versionTag (c7-binding-known)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" camunda:caseRef="case" camunda:caseBinding="versionTag" />',
        ),
      },
      {
        name: 'a decisionRefBinding without decisionRef, a formRefBinding without formRef',
        moddleElement: engineModel(
          'c7',
          `<bpmn:businessRuleTask id="businessRuleTask_c" camunda:class="org.example.Rule" camunda:decisionRefBinding="version" />
          <bpmn:userTask id="userTask_d" camunda:formRefBinding="version" />`,
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="version" />',
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="version" />',
          { definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"' },
        ),
      },
    ],
    invalid: [
      {
        name: 'calledElementBinding=version without version',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="version" />',
        ),
        report: {
          id: 'callActivity_a',
          message: MISSING(
            'callActivity callActivity_a',
            'calledElementBinding',
            'version',
            'calledElementVersion',
          ),
          path: ['calledElementVersion'],
          type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
        },
      },
      {
        name: 'calledElementBinding=versionTag and caseBinding=version without them',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="versionTag" camunda:caseBinding="version" />',
        ),
        report: [
          {
            id: 'callActivity_a',
            message: MISSING(
              'callActivity callActivity_a',
              'calledElementBinding',
              'versionTag',
              'calledElementVersionTag',
            ),
            path: ['calledElementVersionTag'],
            type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
          },
          {
            id: 'callActivity_a',
            message: MISSING('callActivity callActivity_a', 'caseBinding', 'version', 'caseVersion'),
            path: ['caseVersion'],
            type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
          },
        ],
      },
      {
        name: 'decisionRefBinding=versionTag without tag',
        moddleElement: engineModel(
          'c7',
          '<bpmn:businessRuleTask id="businessRuleTask_c" camunda:decisionRef="risk" camunda:decisionRefBinding="versionTag" />',
        ),
        report: {
          id: 'businessRuleTask_c',
          message: MISSING(
            'businessRuleTask businessRuleTask_c',
            'decisionRefBinding',
            'versionTag',
            'decisionRefVersionTag',
          ),
          path: ['decisionRefVersionTag'],
          type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
        },
      },
      {
        name: 'formRefBinding=version without formRefVersion on a start event',
        moddleElement: engineModel(
          'c7',
          '<bpmn:startEvent id="startEvent_a" camunda:formRef="form" camunda:formRefBinding="version" />',
        ),
        report: {
          id: 'startEvent_a',
          message: MISSING('startEvent startEvent_a', 'formRefBinding', 'version', 'formRefVersion'),
          path: ['formRefVersion'],
          type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
        },
      },
    ],
  });
});
