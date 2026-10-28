import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-dangling-reference.js';
import { UnresolvedReferences } from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/extensions/UnresolvedReferences.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

/** The model with the references its parse could not resolve recorded, as the engine run does before it lints. */
const withUnresolvedReferences = (model: ReturnType<typeof engineModel>) =>
  model.then((parsed) => {
    UnresolvedReferences.record(parsed.warnings);
    return parsed;
  });

const ROOTS =
  '<bpmn:error id="error_failed" name="failed" errorCode="E1" /><bpmn:message id="message_paid" name="paid" />';
const task = (errorRef: string) =>
  `<bpmn:serviceTask id="serviceTask_charge" camunda:type="external" camunda:topic="charge"><bpmn:extensionElements><camunda:errorEventDefinition id="errorEventDefinition_failed" errorRef="${errorRef}" expression="\${true}" /></bpmn:extensionElements></bpmn:serviceTask>`;

verifyEngineRule('c7-dangling-reference', rule, {
  valid: [
    {
      name: 'an errorRef to a message in a non-executable process (the engines skip it)',
      moddleElement: engineModel('c7', task('message_paid'), {
        roots: ROOTS,
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'an errorRef to a bpmn:Error',
      moddleElement: engineModel('c7', task('error_failed'), { roots: ROOTS }),
    },
    {
      name: 'an errorRef to no element the engine run has not handed over',
      moddleElement: engineModel('c7', task('error_gone'), { roots: ROOTS }),
    },
    {
      name: 'a dangling reference inside an ad-hoc sub-process of an executable process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="adHocSubProcess_steps">${task('message_paid')}</bpmn:adHocSubProcess>`,
        {
          roots: ROOTS,
        },
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', '<bpmn:serviceTask id="serviceTask_charge" />'),
    },
  ],
  invalid: [
    {
      name: 'an errorRef to no element (the typed parse drops it, the engine run hands it over)',
      moddleElement: withUnresolvedReferences(engineModel('c7', task('error_gone'), { roots: ROOTS })),
      report: {
        id: 'serviceTask_charge',
        message:
          'camunda:errorEventDefinition of serviceTask serviceTask_charge references errorRef="error_gone", which is not a bpmn:Error in the file; the engines ignore the mapping when it runs',
        path: ['extensionElements', 'values', 0, 'errorRef'],
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
    {
      name: 'an errorRef to a message',
      moddleElement: engineModel('c7', task('message_paid'), { roots: ROOTS }),
      report: {
        id: 'serviceTask_charge',
        message:
          'camunda:errorEventDefinition of serviceTask serviceTask_charge references errorRef="message_paid", which is not a bpmn:Error in the file; the engines ignore the mapping when it runs',
        path: ['extensionElements', 'values', 0, 'errorRef'],
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      },
    },
  ],
});
