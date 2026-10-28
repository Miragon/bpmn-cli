import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-misplaced-extension.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const MAPPING =
  '<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>';
const RETRY = '<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle>';
const NOT_ALLOWED = ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED;
const task = (inner: string) =>
  `<bpmn:serviceTask id="serviceTask_charge" camunda:expression="\${true}">${ext(inner)}</bpmn:serviceTask>`;
const timerCatch = (definitionId: string) =>
  `<bpmn:intermediateCatchEvent id="intermediateCatchEvent_wait"><bpmn:timerEventDefinition ${definitionId}>${ext(RETRY)}<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`;
const RETRY_HOSTS = 'activity, gateway, event, multiInstanceLoopCharacteristics';

verifyEngineRule('c7-misplaced-extension', rule, {
  valid: [
    {
      name: 'a misplaced extension element in a non-executable process (the engines skip it)',
      moddleElement: engineModel('c7', task('<camunda:formData />'), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'extension elements where the engines read them',
      moddleElement: engineModel(
        'c7',
        `${ext('<camunda:executionListener event="start" class="a.B" /><camunda:potentialStarter />')}
         <bpmn:userTask id="userTask_review">${ext(`${MAPPING}<camunda:taskListener event="create" class="a.B" /><camunda:formData /><camunda:properties><camunda:property name="a" value="1" /></camunda:properties>`)}</bpmn:userTask>
         <bpmn:serviceTask id="serviceTask_charge" camunda:type="external" camunda:topic="charge">${ext('<camunda:errorEventDefinition id="errorEventDefinition_failed" expression="${true}" />')}</bpmn:serviceTask>
         <bpmn:callActivity id="callActivity_ship" calledElement="ship">${ext('<camunda:in variables="all" /><camunda:out variables="all" />')}</bpmn:callActivity>`,
      ),
    },
    {
      name: 'a parameter loose in the extension elements (the typed parse drops it)',
      moddleElement: engineModel(
        'c7',
        task('<camunda:inputParameter name="a">x</camunda:inputParameter>'),
      ),
    },
    {
      name: 'a misplaced extension element inside an ad-hoc sub-process of an executable process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="adHocSubProcess_steps">${task('<camunda:formData />')}</bpmn:adHocSubProcess>`,
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', '<bpmn:serviceTask id="serviceTask_charge" />'),
    },
  ],
  invalid: [
    {
      name: 'a task listener, camunda:in and formData on a service task',
      moddleElement: engineModel(
        'c7',
        task(
          '<camunda:taskListener event="create" class="a.B" /><camunda:in variables="all" /><camunda:formData />',
        ),
      ),
      report: [
        {
          id: 'serviceTask_charge',
          message:
            'camunda:taskListener on serviceTask serviceTask_charge has no effect: the engines read it on userTask only',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
        {
          id: 'serviceTask_charge',
          message:
            'camunda:in on serviceTask serviceTask_charge has no effect: the engines read it on callActivity, signalEventDefinition only',
          path: ['extensionElements', 'values', 1],
          type: NOT_ALLOWED,
        },
        {
          id: 'serviceTask_charge',
          message:
            'camunda:formData on serviceTask serviceTask_charge has no effect: the engines read it on startEvent, userTask only',
          path: ['extensionElements', 'values', 2],
          type: NOT_ALLOWED,
        },
      ],
    },
    {
      name: 'camunda:inputOutput on the process',
      moddleElement: engineModel('c7', `${ext(MAPPING)}<bpmn:userTask id="userTask_review" />`),
      report: {
        id: 'process_test',
        message:
          'camunda:inputOutput on process process_test has no effect: the engines read it on flowNode, camunda:connector only',
        path: ['extensionElements', 'values', 0],
        type: NOT_ALLOWED,
      },
    },
    {
      name: 'camunda:field on a message catch event definition',
      moddleElement: engineModel(
        'c7',
        `<bpmn:intermediateCatchEvent id="intermediateCatchEvent_paid"><bpmn:messageEventDefinition messageRef="message_paid">${ext('<camunda:field name="a" stringValue="x" />')}</bpmn:messageEventDefinition></bpmn:intermediateCatchEvent>`,
        { roots: '<bpmn:message id="message_paid" name="paid" />' },
      ),
      report: {
        id: 'intermediateCatchEvent_paid',
        message:
          'camunda:field on the messageEventDefinition of intermediateCatchEvent:message intermediateCatchEvent_paid has no effect: the engines read it on message throw and end events only',
        path: ['eventDefinitions', 0, 'extensionElements', 'values', 0],
        type: NOT_ALLOWED,
      },
    },
    {
      name: 'a retry cycle on a timer definition without an id',
      moddleElement: engineModel('c7', timerCatch('')),
      report: {
        id: 'intermediateCatchEvent_wait',
        message: `camunda:failedJobRetryTimeCycle on the timerEventDefinition of intermediateCatchEvent:timer intermediateCatchEvent_wait has no effect: the engines read it on ${RETRY_HOSTS} only`,
        path: ['eventDefinitions', 0, 'extensionElements', 'values', 0],
        type: NOT_ALLOWED,
      },
    },
    {
      name: 'a retry cycle on a timer definition with an id',
      moddleElement: engineModel('c7', timerCatch('id="timerEventDefinition_wait"')),
      report: {
        id: 'intermediateCatchEvent_wait',
        message: `camunda:failedJobRetryTimeCycle on timerEventDefinition timerEventDefinition_wait has no effect: the engines read it on ${RETRY_HOSTS} only`,
        path: ['eventDefinitions', 0, 'extensionElements', 'values', 0],
        type: NOT_ALLOWED,
      },
    },
    {
      name: 'a task listener on a multi-instance loop (its retry cycle is read)',
      moddleElement: engineModel(
        'c7',
        `<bpmn:userTask id="userTask_review"><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${items}" camunda:elementVariable="item">${ext(`${RETRY}<camunda:taskListener event="create" expression="\${x}" />`)}</bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>`,
      ),
      report: {
        id: 'userTask_review',
        message:
          'camunda:taskListener on the multiInstanceLoopCharacteristics of userTask userTask_review has no effect: the engines read it on userTask only',
        path: ['loopCharacteristics', 'extensionElements', 'values', 1],
        type: NOT_ALLOWED,
      },
    },
    {
      name: 'a property loose in the extension elements',
      moddleElement: engineModel('c7', task('<camunda:property name="a" value="1" />')),
      report: {
        id: 'serviceTask_charge',
        message:
          'camunda:property sits directly in the extension elements of serviceTask serviceTask_charge, but belongs inside camunda:properties; the engines ignore it',
        path: ['extensionElements', 'values', 0],
        type: NOT_ALLOWED,
      },
    },
  ],
});
