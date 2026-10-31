import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7LinkThrowNeedsCatchRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-link-throw-needs-catch', () => {
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
  const subProcess = (id: string, inner: string) =>
    `<bpmn:subProcess id="${id}"><bpmn:startEvent id="${id}_S" />${inner}</bpmn:subProcess>`;
  const target = (id: string, missing: string, scope = 'process_test') => ({
    id,
    message: `Link throw event ${id} jumps to "L1", but ${missing}; the engines resolve links within one (sub-)process (${scope}) and refuse the file`,
    path: ['eventDefinitions', 0, 'name'],
    type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
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
        name: 'a link throw event without a catch event',
        moddleElement: engineModel('c7', reachedThrow('L', 'L1')),
        report: target('L', 'no link catch event has that name'),
      },
      {
        name: 'a link throw event in the process, its catch event in a sub-process',
        moddleElement: engineModel(
          'c7',
          `${reachedThrow('L', 'L1')}${subProcess('Sub', linkCatch('C1', 'L1'))}`,
        ),
        report: target('L', 'the catch event of that name (C1) is in another scope'),
      },
      {
        name: 'a link throw event in a sub-process, its catch event in the process',
        moddleElement: engineModel(
          'c7',
          `${START}${linkCatch('C1', 'L1')}${subProcess('Sub', `${flow('F_L', 'Sub_S', 'L')}${linkThrow('L', 'L1')}`)}`,
        ),
        report: target('L', 'the catch event of that name (C1) is in another scope', 'Sub'),
      },
    ],
  });
});
