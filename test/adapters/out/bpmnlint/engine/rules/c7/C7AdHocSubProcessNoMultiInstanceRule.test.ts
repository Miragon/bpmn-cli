import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7AdHocSubProcessNoMultiInstanceRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-ad-hoc-sub-process-no-multi-instance', () => {
  const flow = (id: string, from: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${target}" />`;
  const userTask = (id: string) => `<bpmn:userTask id="${id}" />`;
  const around = (node: string) =>
    `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'SP')}${node}${flow('F2', 'SP', 'End')}<bpmn:endEvent id="End" />`;
  const beside = (extra: string) =>
    `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'U')}${userTask('U')}${flow('F2', 'U', 'End')}<bpmn:endEvent id="End" />${extra}`;
  const LOOP =
    '<bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>2</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>';
  const REFUSED = 'the engines do not run ad-hoc sub-processes and refuse the file';
  const connected = (parts: string, refusal: string) => ({
    id: 'SP',
    message: `Ad-hoc sub-process SP is connected (${parts}); ${REFUSED} (${refusal})`,
    type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
  });
  const LOOP_REPORT = {
    id: 'SP',
    message:
      'Ad-hoc sub-process SP has a multi-instance loop; the engines do not run ad-hoc sub-processes, and Camunda 7 and CIB seven refuse the file (ENGINE-01009, "activity" is null)',
    path: ['loopCharacteristics'],
    type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
  };

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'an ad-hoc sub-process that nothing connects: its content is skipped',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="SP"><bpmn:serviceTask id="X" /><bpmn:scriptTask id="Y" /><bpmn:subProcess id="Z">${userTask('Z1')}</bpmn:subProcess><bpmn:startEvent id="A1" /><bpmn:startEvent id="A2" />${flow('a1', 'A1', 'X')}${flow('a2', 'A2', 'X')}</bpmn:adHocSubProcess>`,
          ),
        ),
      },
      {
        name: 'an ad-hoc sub-process that nothing connects: broken settings on it are skipped too',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="SP" camunda:asyncBefore="true" camunda:jobPriority="abc"><bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R1/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R2/PT1M</camunda:failedJobRetryTimeCycle><camunda:executionListener event="start" /></bpmn:extensionElements>${userTask('T')}</bpmn:adHocSubProcess>`,
          ),
        ),
      },
      {
        name: 'a connected ad-hoc sub-process inside an ad-hoc sub-process (skipped with its parent)',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="AH">${around(`<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess>`)}</bpmn:adHocSubProcess>`,
          ),
        ),
      },
      {
        name: 'a connected ad-hoc sub-process in a non-executable process',
        moddleElement: engineModel(
          'c7',
          around(`<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess>`),
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'a connected embedded sub-process',
        moddleElement: engineModel(
          'c7',
          around(`<bpmn:subProcess id="SP">${userTask('T')}</bpmn:subProcess>`),
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          around(`<bpmn:adHocSubProcess id="SP">${userTask('T')}</bpmn:adHocSubProcess>`),
        ),
      },
    ],
    invalid: [
      {
        name: 'an ad-hoc sub-process with a valid multi-instance loop',
        moddleElement: engineModel(
          'c7',
          beside(`<bpmn:adHocSubProcess id="SP">${LOOP}${userTask('T')}</bpmn:adHocSubProcess>`),
        ),
        report: LOOP_REPORT,
      },
      {
        name: 'an ad-hoc sub-process with a multi-instance loop without cardinality',
        moddleElement: engineModel(
          'c7',
          beside(
            `<bpmn:adHocSubProcess id="SP"><bpmn:multiInstanceLoopCharacteristics />${userTask('T')}</bpmn:adHocSubProcess>`,
          ),
        ),
        report: LOOP_REPORT,
      },
    ],
  });
});
