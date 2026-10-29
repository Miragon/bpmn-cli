import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8LinkThrowNeedsCatchRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-link-throw-needs-catch', () => {
  const LINKS = (throwDefinition: string, catchDefinitions: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:intermediateThrowEvent id="X">${throwDefinition}</bpmn:intermediateThrowEvent>
    ${catchDefinitions
      .map(
        (definition, index) =>
          `<bpmn:intermediateCatchEvent id="C${index}">${definition}</bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="FC${index}" sourceRef="C${index}" targetRef="End" />`,
      )
      .join('\n')}
    <bpmn:endEvent id="End" />`;
  const PAIR = (name: string) =>
    LINKS(`<bpmn:linkEventDefinition id="L1" name="${name}" />`, [
      `<bpmn:linkEventDefinition id="L2" name="${name}" />`,
    ]);
  const UNMATCHED = LINKS('<bpmn:linkEventDefinition id="L1" name="A" />', [
    '<bpmn:linkEventDefinition id="L2" name="B" />',
  ]);

  verifyEngineRule(rule, {
    valid: [
      { name: 'a link pair', moddleElement: engineModel('c8', PAIR('L')) },
      { name: 'link names of white space', moddleElement: engineModel('c8', PAIR('   ')) },
      {
        name: 'empty link names on intermediate events (camunda-compat link-event)',
        moddleElement: engineModel('c8', PAIR('')),
      },
      {
        name: 'a link definition without name (camunda-compat link-event)',
        moddleElement: engineModel(
          'c8',
          LINKS('<bpmn:linkEventDefinition id="L1" />', [
            '<bpmn:linkEventDefinition id="L2" name="L" />',
          ]),
        ),
      },
      {
        name: 'two link catch events of one name (camunda-compat link-event)',
        moddleElement: engineModel(
          'c8',
          LINKS('<bpmn:linkEventDefinition id="L1" name="B" />', [
            '<bpmn:linkEventDefinition id="L2" name="B" />',
            '<bpmn:linkEventDefinition id="L3" name="B" />',
          ]),
        ),
      },
      {
        name: 'a throw without catch in a process that is not executable',
        moddleElement: engineModel('c8', UNMATCHED, { processAttributes: 'isExecutable="false"' }),
      },
      {
        name: 'a throw and its catch in one sub-process',
        moddleElement: engineModel('c8', `<bpmn:subProcess id="Sub">${PAIR('L')}</bpmn:subProcess>`),
      },
      { name: 'a Camunda 7 diagram', moddleElement: engineModel('c7', UNMATCHED) },
    ],
    invalid: [
      {
        name: 'a link throw without catch',
        moddleElement: engineModel('c8', UNMATCHED),
        report: {
          id: 'X',
          message:
            'Link throw event X goes to "A", but process_test has no link catch event of that name; Camunda 8 refuses the file',
          path: ['eventDefinitions', 0, 'name'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a link throw whose catch is in another sub-process',
        moddleElement: engineModel(
          'c8',
          `<bpmn:subProcess id="Sub"><bpmn:intermediateThrowEvent id="X"><bpmn:linkEventDefinition id="L1" name="L" /></bpmn:intermediateThrowEvent></bpmn:subProcess>
           <bpmn:intermediateCatchEvent id="C"><bpmn:linkEventDefinition id="L2" name="L" /></bpmn:intermediateCatchEvent>`,
        ),
        report: {
          id: 'X',
          message:
            'Link throw event X goes to "L", but Sub has no link catch event of that name; Camunda 8 refuses the file',
          path: ['eventDefinitions', 0, 'name'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});
