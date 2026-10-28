import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-bad-value.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const job = (retries: string) => `<zeebe:taskDefinition type="work" retries="${retries}" />`;
const serviceTask = (inner: string) => `<bpmn:serviceTask id="X">${ext(inner)}</bpmn:serviceTask>`;

const retriesReport = (retries: string, label = 'serviceTask X') => ({
  id: 'X',
  message: `The zeebe:taskDefinition of ${label} has retries="${retries}", which is no number; it deploys, but every instance gets an incident when it reaches X`,
  path: ['extensionElements', 'values', 0, 'retries'],
  type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
});

const headerReport = (
  header: string,
  where: string,
  missing: string,
  path: (string | number)[],
) => ({
  id: 'X',
  message: `Task header ${header} of ${where} has no ${missing}; Camunda 8 drops it, the job does not carry it`,
  path,
  type: ERROR_TYPES.PROPERTY_REQUIRED,
});

verifyEngineRule('c8-bad-value', rule, {
  valid: [
    ...['3', ' -1 ', '=retries'].map((retries) => ({
      name: `retries="${retries}"`,
      moddleElement: engineModel('c8', serviceTask(job(retries))),
    })),
    {
      name: 'headers with key and value',
      moddleElement: engineModel(
        'c8',
        serviceTask(
          '<zeebe:taskDefinition type="work" /><zeebe:taskHeaders><zeebe:header key="k" value="v" /></zeebe:taskHeaders>',
        ),
      ),
    },
    {
      name: 'task headers where Camunda 8 does not read them (a manual task)',
      moddleElement: engineModel(
        'c8',
        `<bpmn:manualTask id="X">${ext('<zeebe:taskHeaders><zeebe:header value="v" /></zeebe:taskHeaders>')}</bpmn:manualTask>`,
      ),
    },
    {
      name: 'retries on a task Camunda 8 runs no job for (a user task)',
      moddleElement: engineModel('c8', `<bpmn:userTask id="X">${ext(job('abc'))}</bpmn:userTask>`),
    },
    {
      name: 'a process that is not executable',
      moddleElement: engineModel('c8', serviceTask(job('abc')), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'inside a transaction (refused as a whole)',
      moddleElement: engineModel(
        'c8',
        `<bpmn:transaction id="T">${serviceTask(job('abc'))}</bpmn:transaction>`,
      ),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel(
        'c7',
        '<bpmn:serviceTask id="X" camunda:type="external" camunda:topic="work" />',
      ),
    },
  ],
  invalid: [
    {
      name: 'retries that are no number',
      moddleElement: engineModel('c8', serviceTask(job('abc'))),
      report: retriesReport('abc'),
    },
    {
      name: 'retries that are no number on a message end event',
      moddleElement: engineModel(
        'c8',
        `<bpmn:endEvent id="X">${ext(job('1.5'))}<bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:endEvent>`,
        { roots: '<bpmn:message id="M1" name="Done" />' },
      ),
      report: retriesReport('1.5', 'endEvent:message X'),
    },
    {
      name: 'task headers without key or value (the duplicate is camunda-compat duplicate-task-headers)',
      moddleElement: engineModel(
        'c8',
        serviceTask(
          '<zeebe:taskDefinition type="work" /><zeebe:taskHeaders><zeebe:header key="k" value="v" /><zeebe:header key="k" value="w" /><zeebe:header value="x" /><zeebe:header key="e" /><zeebe:header key="s" value="  " /></zeebe:taskHeaders>',
        ),
      ),
      report: [
        headerReport('3', 'serviceTask X', 'key', [
          'extensionElements',
          'values',
          1,
          'values',
          2,
          'key',
        ]),
        headerReport('"e"', 'serviceTask X', 'value', [
          'extensionElements',
          'values',
          1,
          'values',
          3,
          'value',
        ]),
        headerReport('"s"', 'serviceTask X', 'value', [
          'extensionElements',
          'values',
          1,
          'values',
          4,
          'value',
        ]),
      ],
    },
    {
      name: 'a header without value in an execution listener',
      moddleElement: engineModel(
        'c8',
        serviceTask(
          '<zeebe:taskDefinition type="work" /><zeebe:executionListeners><zeebe:executionListener eventType="start" type="audit"><zeebe:taskHeaders><zeebe:header key="k" /></zeebe:taskHeaders></zeebe:executionListener></zeebe:executionListeners>',
        ),
      ),
      report: headerReport('"k"', 'execution listener 1 of serviceTask X', 'value', [
        'extensionElements',
        'values',
        1,
        'listeners',
        0,
        'headers',
        'values',
        0,
        'value',
      ]),
    },
  ],
});
