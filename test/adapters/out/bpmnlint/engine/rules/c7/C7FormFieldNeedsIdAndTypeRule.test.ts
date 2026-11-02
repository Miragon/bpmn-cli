import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7FormFieldNeedsIdAndTypeRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-form-field-needs-id-and-type', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const ROOTS =
    '<bpmn:signal id="signal_go" name="go" /><bpmn:message id="message_paid" name="paid" />';
  const REQUIRED = ERROR_TYPES.PROPERTY_REQUIRED;
  const callActivity = (inner: string) =>
    `<bpmn:callActivity id="callActivity_ship" calledElement="ship">${ext(inner)}</bpmn:callActivity>`;
  const serviceTask = (attributes: string, inner: string) =>
    `<bpmn:serviceTask id="serviceTask_charge" ${attributes}>${ext(inner)}</bpmn:serviceTask>`;
  const userTask = (inner: string) =>
    `<bpmn:userTask id="userTask_review">${ext(inner)}</bpmn:userTask>`;
  const report = (id: string, message: string, path: (string | number)[], type = REQUIRED) => ({
    id,
    message,
    path,
    type,
  });

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'complete bindings, mappings, connector and form',
        moddleElement: engineModel(
          'c7',
          callActivity(
            '<camunda:in source="a" target="a" /><camunda:in sourceExpression="${b}" target="b" /><camunda:in businessKey="${key}" /><camunda:out variables="all" />',
          ) +
            serviceTask(
              'camunda:class="a.B"',
              '<camunda:field name="a" stringValue="x" /><camunda:field name="b"><camunda:string /></camunda:field><camunda:field name="c" expression="${c}" /><camunda:inputOutput><camunda:inputParameter name="p">1</camunda:inputParameter></camunda:inputOutput>',
            ) +
            '<bpmn:sendTask id="sendTask_notify"><bpmn:extensionElements><camunda:connector><camunda:connectorId>mail</camunda:connectorId></camunda:connector></bpmn:extensionElements></bpmn:sendTask>' +
            userTask(
              '<camunda:formData><camunda:formField id="a" type="string" /><camunda:formField id="b" type="date" /></camunda:formData>',
            ),
        ),
      },
      {
        name: 'fields the engines do not read: an expression or external implementation, an expression listener',
        moddleElement: engineModel(
          'c7',
          serviceTask('camunda:expression="${true}"', '<camunda:field name="a" />') +
            serviceTask(
              'camunda:type="external" camunda:topic="charge"',
              '<camunda:field name="a" />',
            ).replace('serviceTask_charge', 'serviceTask_refund') +
            userTask(
              '<camunda:taskListener event="create" expression="${l}" delegateExpression="${d}"><camunda:field name="a" /></camunda:taskListener>',
            ),
        ),
      },
      {
        name: 'an incomplete binding where the engines do not read it (c7-camunda-extension-placement)',
        moddleElement: engineModel(
          'c7',
          serviceTask('camunda:expression="${true}"', '<camunda:in source="a" />'),
        ),
      },
      {
        name: 'incomplete content in a non-executable process',
        moddleElement: engineModel('c7', callActivity('<camunda:in source="a" />'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'incomplete content inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="adHocSubProcess_steps">${callActivity('<camunda:in source="a" />')}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'fields of a message definition the event does not act on',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateThrowEvent id="intermediateThrowEvent_notify"><bpmn:signalEventDefinition signalRef="signal_go" /><bpmn:messageEventDefinition messageRef="message_paid" camunda:class="a.B">${ext('<camunda:field name="a" />')}</bpmn:messageEventDefinition></bpmn:intermediateThrowEvent>`,
          { roots: ROOTS },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:callActivity id="callActivity_ship" />'),
      },
    ],
    invalid: [
      {
        name: 'a form field without type, and one with a type the engines do not know',
        moddleElement: engineModel(
          'c7',
          userTask(
            '<camunda:formData><camunda:formField id="a" /><camunda:formField id="b" type="String" /><camunda:formField id="c" type="date" /><camunda:formField type="long" /></camunda:formData>',
          ),
        ),
        report: [
          report(
            'userTask_review',
            'Form field a of userTask userTask_review has no type; the engines refuse the file',
            ['extensionElements', 'values', 0, 'fields', 0, 'type'],
          ),
          report(
            'userTask_review',
            'Form field b of userTask userTask_review has type "String", which is not one of the built-in form types string, long, boolean, date, enum; the engines refuse the file (unless a plugin registers it as a custom form type)',
            ['extensionElements', 'values', 0, 'fields', 1, 'type'],
            ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          ),
          report(
            'userTask_review',
            'Form field 4 of userTask userTask_review has no id; the engines refuse the file',
            ['extensionElements', 'values', 0, 'fields', 3, 'id'],
          ),
        ],
      },
    ],
  });
});
