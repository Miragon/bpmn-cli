import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7FormRefNoFormKeyRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-form-ref-no-form-key', () => {
  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a form key, or a form reference with a binding',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_a" camunda:formKey="embedded:app:forms/a.html" />
          <bpmn:userTask id="userTask_b" camunda:formRef="form" camunda:formRefBinding="latest" />
          <bpmn:startEvent id="startEvent_c" camunda:formRef="form" camunda:formRefBinding="deployment" />`,
        ),
      },
      {
        name: 'a version binding without version (c7-binding-needs-version)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_b" camunda:formRef="form" camunda:formRefBinding="version" />',
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel('c7', '<bpmn:userTask id="userTask_b" camunda:formRef="form" />', {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:userTask id="userTask_b" camunda:formRef="form" />', {
          definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
        }),
      },
    ],
    invalid: [
      {
        name: 'formKey and formRef together',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_b" camunda:formKey="key" camunda:formRef="form" camunda:formRefBinding="latest" />',
        ),
        report: {
          id: 'userTask_b',
          message:
            'userTask userTask_b has both camunda:formKey and camunda:formRef; the engines refuse the file',
          path: ['formKey'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});
