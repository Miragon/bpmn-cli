import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8LinkEventNeedsNameRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-link-event-needs-name', () => {
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
  const TIMER =
    '<bpmn:timerEventDefinition id="timer_X"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';

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
        name: 'link definitions without name in a process that is not executable',
        moddleElement: engineModel(
          'c8',
          LINKS('<bpmn:linkEventDefinition id="L1" />', [
            '<bpmn:linkEventDefinition id="L2" name="" />',
          ]),
          { processAttributes: 'isExecutable="false"' },
        ),
        report: [
          {
            id: 'X',
            message:
              'The link event definition of intermediateThrowEvent:link X has no name, which the BPMN schema requires; Camunda 8 refuses the file',
            path: ['eventDefinitions', 0, 'name'],
            type: ERROR_TYPES.PROPERTY_REQUIRED,
          },
          {
            id: 'C0',
            message:
              'The link event definition of intermediateCatchEvent:link C0 has an empty name; Camunda 8 refuses the file',
            path: ['eventDefinitions', 0, 'name'],
            type: ERROR_TYPES.PROPERTY_REQUIRED,
          },
        ],
      },
      {
        name: 'a link definition without name behind another definition',
        moddleElement: engineModel(
          'c8',
          LINKS(`${TIMER}<bpmn:linkEventDefinition id="L1" />`, [
            '<bpmn:linkEventDefinition id="L2" name="L" />',
          ]),
        ),
        report: {
          id: 'X',
          message:
            'The link event definition of intermediateThrowEvent:timer X has no name, which the BPMN schema requires; Camunda 8 refuses the file',
          path: ['eventDefinitions', 1, 'name'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});
