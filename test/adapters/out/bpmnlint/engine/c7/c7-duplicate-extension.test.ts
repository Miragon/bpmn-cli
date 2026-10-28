import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-duplicate-extension.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const MAPPING =
  '<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>';
const RETRIES =
  '<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R5/PT1M</camunda:failedJobRetryTimeCycle>';
const serviceTask = (attributes: string, inner: string) =>
  `<bpmn:serviceTask id="serviceTask_charge" camunda:expression="\${true}" ${attributes}>${ext(inner)}</bpmn:serviceTask>`;
const MULTIPLE = ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED;

verifyEngineRule('c7-duplicate-extension', rule, {
  valid: [
    {
      name: 'one of each, and two camunda:properties',
      moddleElement: engineModel(
        'c7',
        serviceTask(
          'camunda:asyncBefore="true"',
          `${MAPPING}<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:properties /><camunda:properties />`,
        ),
      ),
    },
    {
      name: 'two retry cycles on a synchronous task (c7-async-duplicate-extension)',
      moddleElement: engineModel('c7', serviceTask('', RETRIES)),
    },
    {
      name: 'two mappings in a non-executable process',
      moddleElement: engineModel('c7', serviceTask('', MAPPING + MAPPING), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'two mappings inside an ad-hoc sub-process of an executable process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="adHocSubProcess_steps">${serviceTask('', MAPPING + MAPPING)}</bpmn:adHocSubProcess>`,
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', '<bpmn:serviceTask id="serviceTask_charge" />'),
    },
  ],
  invalid: [
    {
      name: 'two camunda:inputOutput on a task',
      moddleElement: engineModel('c7', serviceTask('', MAPPING + MAPPING)),
      report: {
        id: 'serviceTask_charge',
        message:
          'serviceTask serviceTask_charge has 2 camunda:inputOutput elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name inputOutput)',
        path: ['extensionElements', 'values', 1],
        type: MULTIPLE,
      },
    },
    {
      name: 'two camunda:formData on a user task',
      moddleElement: engineModel(
        'c7',
        `<bpmn:userTask id="userTask_review">${ext('<camunda:formData><camunda:formField id="a" type="string" /></camunda:formData><camunda:formData><camunda:formField id="b" type="string" /></camunda:formData>')}</bpmn:userTask>`,
      ),
      report: {
        id: 'userTask_review',
        message:
          'userTask userTask_review has 2 camunda:formData elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name formData)',
        path: ['extensionElements', 'values', 1],
        type: MULTIPLE,
      },
    },
    {
      name: 'two connectors on a send task',
      moddleElement: engineModel(
        'c7',
        `<bpmn:sendTask id="sendTask_notify">${ext('<camunda:connector><camunda:connectorId>mail</camunda:connectorId></camunda:connector><camunda:connector><camunda:connectorId>http</camunda:connectorId></camunda:connector>')}</bpmn:sendTask>`,
      ),
      report: {
        id: 'sendTask_notify',
        message:
          'sendTask sendTask_notify has 2 camunda:connector elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name connector)',
        path: ['extensionElements', 'values', 1],
        type: MULTIPLE,
      },
    },
    {
      name: 'two retry cycles on an asynchronous task',
      moddleElement: engineModel('c7', serviceTask('camunda:asyncBefore="true"', RETRIES)),
      report: {
        id: 'serviceTask_charge',
        message:
          'serviceTask serviceTask_charge has 2 camunda:failedJobRetryTimeCycle elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name failedJobRetryTimeCycle)',
        path: ['extensionElements', 'values', 1],
        type: MULTIPLE,
      },
    },
    {
      name: 'two retry cycles on a timer event',
      moddleElement: engineModel(
        'c7',
        `<bpmn:intermediateCatchEvent id="intermediateCatchEvent_wait">${ext(RETRIES)}<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`,
      ),
      report: {
        id: 'intermediateCatchEvent_wait',
        message:
          'intermediateCatchEvent:timer intermediateCatchEvent_wait has 2 camunda:failedJobRetryTimeCycle elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name failedJobRetryTimeCycle)',
        path: ['extensionElements', 'values', 1],
        type: MULTIPLE,
      },
    },
    {
      name: 'two retry cycles on an asynchronous multi-instance loop, reported on its activity',
      moddleElement: engineModel(
        'c7',
        `<bpmn:userTask id="userTask_review"><bpmn:multiInstanceLoopCharacteristics camunda:asyncBefore="true" camunda:collection="\${items}" camunda:elementVariable="item">${ext(RETRIES)}</bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>`,
      ),
      report: {
        id: 'userTask_review',
        message:
          'the multiInstanceLoopCharacteristics of userTask userTask_review has 2 camunda:failedJobRetryTimeCycle elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name failedJobRetryTimeCycle)',
        path: ['loopCharacteristics', 'extensionElements', 'values', 1],
        type: MULTIPLE,
      },
    },
  ],
});
