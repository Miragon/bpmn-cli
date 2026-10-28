import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-unknown-attribute.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const SERVICE_TASK = (attributes: string, inner = '<zeebe:taskDefinition type="charge" />') =>
  `<bpmn:serviceTask id="serviceTask_charge" ${attributes}>${ext(inner)}</bpmn:serviceTask>`;

verifyEngineRule('c8-unknown-attribute', rule, {
  valid: [
    {
      name: 'known zeebe attributes on BPMN and zeebe elements',
      moddleElement: engineModel(
        'c8',
        SERVICE_TASK(
          'zeebe:modelerTemplate="io.example.charge" zeebe:retryCounter="3"',
          '<zeebe:taskDefinition type="charge" retries="3" /><zeebe:ioMapping><zeebe:input source="=a" target="a" /></zeebe:ioMapping>',
        ),
      ),
    },
    {
      name: 'a zeebe attribute on the wrong BPMN element (c8-misplaced-attribute reports it)',
      moddleElement: engineModel(
        'c8',
        '<bpmn:userTask id="userTask_review" zeebe:retryCounter="3"><bpmn:extensionElements><zeebe:userTask /></bpmn:extensionElements></bpmn:userTask>',
      ),
    },
    {
      name: 'an unknown attribute of a zeebe element on a host that does not read it',
      moddleElement: engineModel(
        'c8',
        '<bpmn:userTask id="userTask_review"><bpmn:extensionElements><zeebe:userTask /><zeebe:taskDefinition type="w" typo="x" /></bpmn:extensionElements></bpmn:userTask>',
      ),
    },
    {
      name: 'unknown zeebe attributes in a non-executable process',
      moddleElement: engineModel('c8', SERVICE_TASK('zeebe:foo="x"'), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel('c7', '<bpmn:userTask id="userTask_review" camunda:typo="x" />'),
    },
  ],
  invalid: [
    {
      name: 'an unknown zeebe attribute on a BPMN element and on a zeebe element',
      moddleElement: engineModel(
        'c8',
        SERVICE_TASK(
          'zeebe:foo="x"',
          '<zeebe:taskDefinition type="w" typo="x" /><zeebe:taskDefinitions />',
        ),
      ),
      report: [
        {
          id: 'serviceTask_charge',
          message:
            'serviceTask serviceTask_charge has the unknown attribute zeebe:foo; Camunda 8 ignores it (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)',
          path: ['zeebe:foo'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
        {
          id: 'serviceTask_charge',
          message:
            'zeebe:taskDefinition of serviceTask serviceTask_charge has the unknown attribute typo (did you mean type?); Camunda 8 ignores it',
          path: ['extensionElements', 'values', 0, 'typo'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      ],
    },
    {
      name: 'an attribute of a zeebe extension element on the user task itself',
      moddleElement: engineModel(
        'c8',
        '<bpmn:userTask id="userTask_review" zeebe:assignee="demo"><bpmn:extensionElements><zeebe:userTask /></bpmn:extensionElements></bpmn:userTask>',
      ),
      report: {
        id: 'userTask_review',
        message:
          'userTask userTask_review has the unknown attribute zeebe:assignee; Camunda 8 ignores it (it reads assignee on the zeebe:assignmentDefinition extension element)',
        path: ['zeebe:assignee'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
    {
      name: 'a typo of a zeebe attribute, under another prefix',
      moddleElement: engineModel(
        'c8',
        '<bpmn:serviceTask id="serviceTask_charge" z:modelerTemplat="x"><bpmn:extensionElements><z:taskDefinition type="charge" /></bpmn:extensionElements></bpmn:serviceTask>',
        { definitionsAttributes: 'xmlns:z="http://camunda.org/schema/zeebe/1.0"' },
      ),
      report: {
        id: 'serviceTask_charge',
        message:
          'serviceTask serviceTask_charge has the unknown attribute zeebe:modelerTemplat (did you mean zeebe:modelerTemplate?); Camunda 8 ignores it (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)',
        path: ['zeebe:modelerTemplat'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
    {
      name: 'unknown attributes of nested zeebe elements',
      moddleElement: engineModel(
        'c8',
        SERVICE_TASK(
          '',
          `<zeebe:taskDefinition type="charge" />
          <zeebe:ioMapping><zeebe:input source="=a" target="a" sorce="b" /></zeebe:ioMapping>
          <zeebe:executionListeners><zeebe:executionListener eventType="end" type="audit"><zeebe:taskHeaders><zeebe:header key="k" value="v" kind="x" /></zeebe:taskHeaders></zeebe:executionListener></zeebe:executionListeners>`,
        ),
      ),
      report: [
        {
          id: 'serviceTask_charge',
          message:
            'zeebe:input (in zeebe:ioMapping) of serviceTask serviceTask_charge has the unknown attribute sorce (did you mean source?); Camunda 8 ignores it',
          path: ['extensionElements', 'values', 1, 'inputParameters', 0, 'sorce'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
        {
          id: 'serviceTask_charge',
          message:
            'zeebe:header (in zeebe:executionListeners > zeebe:executionListener > zeebe:taskHeaders) of serviceTask serviceTask_charge has the unknown attribute kind; Camunda 8 ignores it',
          path: ['extensionElements', 'values', 2, 'listeners', 0, 'headers', 'values', 0, 'kind'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      ],
    },
  ],
});
