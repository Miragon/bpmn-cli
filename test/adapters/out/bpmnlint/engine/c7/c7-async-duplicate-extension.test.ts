import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-async-duplicate-extension.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const RETRIES =
  '<bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R5/PT1M</camunda:failedJobRetryTimeCycle></bpmn:extensionElements>';
const serviceTask = (attributes: string, inner = RETRIES) =>
  `<bpmn:serviceTask id="serviceTask_charge" camunda:expression="\${true}" ${attributes}>${inner}</bpmn:serviceTask>`;

verifyEngineRule('c7-async-duplicate-extension', rule, {
  valid: [
    {
      name: 'one retry cycle on a synchronous task',
      moddleElement: engineModel(
        'c7',
        serviceTask(
          '',
          '<bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle></bpmn:extensionElements>',
        ),
      ),
    },
    {
      name: 'two retry cycles on an asynchronous task (c7-duplicate-extension)',
      moddleElement: engineModel('c7', serviceTask('camunda:asyncAfter="true"')),
    },
    {
      name: 'two retry cycles in a non-executable process',
      moddleElement: engineModel('c7', serviceTask(''), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', '<bpmn:serviceTask id="serviceTask_charge" />'),
    },
  ],
  invalid: [
    {
      name: 'two retry cycles on a synchronous task',
      moddleElement: engineModel('c7', serviceTask('')),
      report: {
        id: 'serviceTask_charge',
        message:
          'serviceTask serviceTask_charge has 2 camunda:failedJobRetryTimeCycle elements; once it runs asynchronously the engines refuse the file',
        path: ['extensionElements', 'values', 1],
        type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
      },
    },
  ],
});
