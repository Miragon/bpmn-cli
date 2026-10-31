import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8MultiInstanceCompletionNeedsFeelRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-multi-instance-completion-needs-feel', () => {
  const ZEEBE_LOOP =
    '<bpmn:extensionElements><zeebe:loopCharacteristics inputCollection="=items" inputElement="item" /></bpmn:extensionElements>';
  const multiInstance = (condition: string | null, task = 'serviceTask') => `
    <bpmn:${task} id="X">
      <bpmn:extensionElements><zeebe:taskDefinition type="work" /></bpmn:extensionElements>
      <bpmn:multiInstanceLoopCharacteristics>${ZEEBE_LOOP}${
        condition === null
          ? ''
          : `<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${condition}</bpmn:completionCondition>`
      }</bpmn:multiInstanceLoopCharacteristics>
    </bpmn:${task}>`;
  const report = (body: string, label = 'serviceTask X') => ({
    id: 'X',
    message: `The completion condition "${body}" of multi-instance ${label} is no FEEL expression (=...); it deploys, but every completed instance gets an incident (expected a boolean, got a string)`,
    path: ['loopCharacteristics', 'completionCondition'],
    type: ERROR_TYPES.EXPRESSION_REQUIRED,
  });

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a FEEL completion condition',
        moddleElement: engineModel('c8', multiInstance('= done')),
      },
      {
        name: 'a multi-instance without completion condition',
        moddleElement: engineModel('c8', multiInstance(null)),
      },
      {
        name: 'a FEEL completion condition with leading white space',
        moddleElement: engineModel('c8', multiInstance('  =done')),
      },
      {
        name: 'a standard loop',
        moddleElement: engineModel(
          'c8',
          '<bpmn:serviceTask id="X"><bpmn:standardLoopCharacteristics /></bpmn:serviceTask>',
        ),
      },
      {
        name: 'a process that is not executable',
        moddleElement: engineModel('c8', multiInstance('${done}'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'inside a transaction (refused as a whole)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:transaction id="T">${multiInstance('${done}')}</bpmn:transaction>`,
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="X" camunda:type="external" camunda:topic="work"><bpmn:multiInstanceLoopCharacteristics camunda:collection="items"><bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${done}</bpmn:completionCondition></bpmn:multiInstanceLoopCharacteristics></bpmn:serviceTask>',
        ),
      },
    ],
    invalid: [
      {
        name: 'a JUEL completion condition',
        moddleElement: engineModel('c8', multiInstance('${done}')),
        report: report('${done}'),
      },
      {
        name: 'a static completion condition of a sub-process',
        moddleElement: engineModel('c8', multiInstance('true', 'subProcess')),
        report: report('true', 'subProcess X'),
      },
      {
        name: 'an empty completion condition',
        moddleElement: engineModel('c8', multiInstance('')),
        report: report(''),
      },
    ],
  });
});
