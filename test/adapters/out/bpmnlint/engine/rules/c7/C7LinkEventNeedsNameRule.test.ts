import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7LinkEventNeedsNameRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-link-event-needs-name', () => {
  const TIMER =
    '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const link = (name?: string) =>
    `<bpmn:linkEventDefinition${name === undefined ? '' : ` name="${name}"`} />`;
  const linkThrow = (id: string, name?: string) =>
    `<bpmn:intermediateThrowEvent id="${id}">${link(name)}</bpmn:intermediateThrowEvent>`;
  const linkCatch = (id: string, name?: string) =>
    `<bpmn:intermediateCatchEvent id="${id}">${link(name)}</bpmn:intermediateCatchEvent>`;
  const flow = (id: string, source: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;
  const START = '<bpmn:startEvent id="Start" />';
  const reachedThrow = (id: string, name: string) =>
    `${START}${flow(`F_${id}`, 'Start', id)}${linkThrow(id, name)}`;
  const target = (id: string, missing: string, scope = 'process_test') => ({
    id,
    message: `Link throw event ${id} jumps to "L1", but ${missing}; the engines resolve links within one (sub-)process (${scope}) and refuse the file`,
    path: ['eventDefinitions', 0, 'name'],
    type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
  });
  const noName = (id: string, subject: string, index = 0) => ({
    id,
    message: `${subject} has no link name, which the BPMN schema requires; the engines refuse the file`,
    path: ['eventDefinitions', index, 'name'],
    type: ERROR_TYPES.PROPERTY_REQUIRED,
  });

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a link pair, an unconnected throw event, a catch event without throw, an empty name',
        moddleElement: engineModel(
          'c7',
          `${reachedThrow('L', 'L1')}${linkCatch('C1', 'L1')}${linkThrow('Lonely', 'Nowhere')}${linkCatch('C2', 'L2')}${linkCatch('C3', '')}`,
        ),
      },
      {
        name: 'duplicate catch names and an unmatched throw in a non-executable process',
        moddleElement: engineModel(
          'c7',
          `${reachedThrow('L', 'Nowhere')}${linkCatch('C1', 'L1')}${linkCatch('C2', 'L1')}`,
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'duplicate catch names and an unmatched throw in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `${linkCatch('C1', 'L1')}<bpmn:adHocSubProcess id="AH">${reachedThrow('L', 'Nowhere')}${linkCatch('C2', 'L1')}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', `${reachedThrow('L', 'Nowhere')}${linkCatch('C1')}`),
      },
    ],
    invalid: [
      {
        name: 'a link catch event without a name',
        moddleElement: engineModel('c7', `${START}${linkCatch('C1')}`),
        report: noName('C1', 'Link event C1'),
      },
      {
        name: 'timer + link without name (intermediate catch)',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:intermediateCatchEvent id="W">${TIMER}<bpmn:linkEventDefinition id="LDef" /></bpmn:intermediateCatchEvent>`,
        ),
        report: noName('W', 'The link definition of intermediateCatchEvent:timer W', 1),
      },
      {
        name: 'a link without name in a non-executable process',
        moddleElement: engineModel('c7', `${START}${linkThrow('O_W')}`, {
          processAttributes: 'isExecutable="false"',
        }),
        report: noName('O_W', 'Link event O_W'),
      },
    ],
  });
});
