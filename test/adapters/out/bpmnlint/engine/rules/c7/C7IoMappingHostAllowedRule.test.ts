import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7IoMappingHostAllowedRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-io-mapping-host-allowed', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const MAPPING = ext(
    '<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>',
  );
  const OUTPUT_MAPPING = ext(
    '<camunda:inputOutput><camunda:outputParameter name="o">1</camunda:outputParameter></camunda:inputOutput>',
  );
  const TIMER =
    '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const MULTI_INSTANCE =
    '<bpmn:multiInstanceLoopCharacteristics camunda:collection="${items}" camunda:elementVariable="item" />';
  const NOT_ALLOWED = ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED;

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
        name: 'a mapping on a start event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="startEvent_go">${MAPPING}</bpmn:startEvent>`,
        ),
        report: {
          id: 'startEvent_go',
          message:
            'camunda:inputOutput on startEvent startEvent_go: the engines do not support input/output mappings on a startEvent and refuse the file',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a mapping on a boundary event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review" /><bpmn:boundaryEvent id="boundaryEvent_late" attachedToRef="userTask_review">${MAPPING}${TIMER}</bpmn:boundaryEvent>`,
        ),
        report: {
          id: 'boundaryEvent_late',
          message:
            'camunda:inputOutput on boundaryEvent:timer boundaryEvent_late: the engines do not support input/output mappings on a boundaryEvent:timer and refuse the file',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a mapping on a gateway',
        moddleElement: engineModel(
          'c7',
          `<bpmn:parallelGateway id="parallelGateway_split">${MAPPING}</bpmn:parallelGateway>`,
        ),
        report: {
          id: 'parallelGateway_split',
          message:
            'camunda:inputOutput on parallelGateway parallelGateway_split: the engines do not support input/output mappings on a parallelGateway and refuse the file',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a mapping on an event sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:subProcess id="subProcess_cancel" triggeredByEvent="true">${MAPPING}<bpmn:startEvent id="startEvent_cancel">${TIMER}</bpmn:startEvent></bpmn:subProcess>`,
        ),
        report: {
          id: 'subProcess_cancel',
          message:
            'camunda:inputOutput on eventSubProcess subProcess_cancel: the engines do not support input/output mappings on an event sub-process and refuse the file',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
    ],
  });
});
