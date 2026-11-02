import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7CallMappingNeedsSourceAndTargetRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-call-mapping-needs-source-and-target', () => {
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
        name: 'camunda:in with a source but no target',
        moddleElement: engineModel('c7', callActivity('<camunda:in source="a" />')),
        report: report(
          'callActivity_ship',
          'camunda:in of callActivity callActivity_ship has no target (and no variables="all" / businessKey); the engines refuse the file',
          ['extensionElements', 'values', 0, 'target'],
        ),
      },
      {
        name: 'camunda:out without source and target',
        moddleElement: engineModel('c7', callActivity('<camunda:out local="true" />')),
        report: report(
          'callActivity_ship',
          'camunda:out of callActivity callActivity_ship has no source or sourceExpression and target (and no variables="all"); the engines refuse the file',
          ['extensionElements', 'values', 0],
        ),
      },
      {
        name: 'camunda:in without target on a signal throw event definition',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateThrowEvent id="intermediateThrowEvent_go"><bpmn:signalEventDefinition signalRef="signal_go">${ext('<camunda:in source="a" target="a" /><camunda:in source="b" />')}</bpmn:signalEventDefinition></bpmn:intermediateThrowEvent>`,
          { roots: ROOTS },
        ),
        report: report(
          'intermediateThrowEvent_go',
          'camunda:in of the signalEventDefinition of intermediateThrowEvent:signal intermediateThrowEvent_go has no target (and no variables="all" / businessKey); the engines refuse the file',
          ['eventDefinitions', 0, 'extensionElements', 'values', 1, 'target'],
        ),
      },
    ],
  });
});
