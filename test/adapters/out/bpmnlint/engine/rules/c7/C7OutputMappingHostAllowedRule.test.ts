import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7OutputMappingHostAllowedRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-output-mapping-host-allowed', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const MAPPING = ext(
    '<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>',
  );
  const OUTPUT_MAPPING = ext(
    '<camunda:inputOutput><camunda:outputParameter name="o">1</camunda:outputParameter></camunda:inputOutput>',
  );
  const MULTI_INSTANCE =
    '<bpmn:multiInstanceLoopCharacteristics camunda:collection="${items}" camunda:elementVariable="item" />';

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'mappings on tasks and input mappings on an end event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review">${OUTPUT_MAPPING}</bpmn:userTask><bpmn:userTask id="userTask_check">${MAPPING}${MULTI_INSTANCE}</bpmn:userTask><bpmn:endEvent id="endEvent_done">${MAPPING}</bpmn:endEvent>`,
        ),
      },
      {
        name: 'a mapping on a start event in a non-executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="startEvent_go">${MAPPING}</bpmn:startEvent>`,
          {
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'a mapping on a gateway inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="adHocSubProcess_steps"><bpmn:parallelGateway id="parallelGateway_split">${MAPPING}</bpmn:parallelGateway></bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:startEvent id="startEvent_go" />'),
      },
    ],
    invalid: [
      {
        name: 'an output parameter on an end event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:endEvent id="endEvent_done">${OUTPUT_MAPPING}</bpmn:endEvent>`,
        ),
        report: {
          id: 'endEvent_done',
          message:
            'camunda:outputParameter on end event endEvent_done: the engines refuse output mappings on end events',
          path: ['extensionElements', 'values', 0, 'outputParameters'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'an output parameter on a multi-instance task',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review">${OUTPUT_MAPPING}${MULTI_INSTANCE}</bpmn:userTask>`,
        ),
        report: {
          id: 'userTask_review',
          message:
            'camunda:outputParameter on multi-instance userTask userTask_review: the engines refuse output mappings on multi-instance activities',
          path: ['extensionElements', 'values', 0, 'outputParameters'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});
