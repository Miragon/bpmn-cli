import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8ErrorCodeUniqueRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-error-code-unique', () => {
  const ERROR_DEFINITION = (id: string, ref?: string) =>
    `<bpmn:errorEventDefinition id="${id}"${ref ? ` errorRef="${ref}"` : ''} />`;
  const ERROR = (code?: string) =>
    `<bpmn:error id="Err" name="E"${code === undefined ? '' : ` errorCode="${code}"`} />`;
  const boundaries = (definitions: string[], attributes = '', end = '') => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:serviceTask id="X" />
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End">${end}</bpmn:endEvent>
    ${definitions.map((definition, index) => `<bpmn:boundaryEvent id="B${index}" attachedToRef="X"${attributes}>${definition}</bpmn:boundaryEvent>`).join('\n')}`;
  const eventSubProcesses = (...definitions: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End" />
    ${definitions.map((definition, index) => `<bpmn:subProcess id="ESP${index}" triggeredByEvent="true"><bpmn:startEvent id="ESP${index}_S">${definition}</bpmn:startEvent></bpmn:subProcess>`).join('\n')}`;
  const TWO_BOUNDARIES = boundaries([ERROR_DEFINITION('ED0', 'Err'), ERROR_DEFINITION('ED1', 'Err')]);

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'an error boundary event with a static code',
        moddleElement: engineModel('c8', boundaries([ERROR_DEFINITION('ED0', 'Err')]), {
          roots: ERROR('C'),
        }),
      },
      {
        name: 'a FEEL error code on a throw event',
        moddleElement: engineModel('c8', boundaries([], '', ERROR_DEFINITION('ED', 'Err')), {
          roots: ERROR('=code'),
        }),
      },
      {
        name: 'two error boundary events with different codes on different activities',
        moddleElement: engineModel(
          'c8',
          `${boundaries([ERROR_DEFINITION('ED0', 'Err')])}<bpmn:task id="Y" /><bpmn:boundaryEvent id="BY" attachedToRef="Y">${ERROR_DEFINITION('EDY', 'Err')}</bpmn:boundaryEvent>`,
          { roots: ERROR('C') },
        ),
      },
      {
        name: 'a thrown error without code (camunda-compat error-reference)',
        moddleElement: engineModel('c8', boundaries([], '', ERROR_DEFINITION('ED', 'Err')), {
          roots: ERROR(),
        }),
      },
      {
        name: 'two error boundary events with one code in a process that is not executable',
        moddleElement: engineModel('c8', TWO_BOUNDARIES, {
          roots: ERROR('C'),
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel('c7', TWO_BOUNDARIES, { roots: ERROR('C') }),
      },
    ],
    invalid: [
      {
        name: 'two error boundary events with one code',
        moddleElement: engineModel('c8', TWO_BOUNDARIES, { roots: ERROR('C') }),
        report: {
          id: 'B1',
          message:
            'boundaryEvent:error B1 catches the error code "C" like boundaryEvent:error B0 (the boundary events of X); Camunda 8 refuses one code twice in a scope',
          path: ['eventDefinitions', 0, 'errorRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'two catch-all error boundary events',
        moddleElement: engineModel(
          'c8',
          boundaries([ERROR_DEFINITION('ED0'), ERROR_DEFINITION('ED1')]),
        ),
        report: {
          id: 'B1',
          message:
            'boundaryEvent:error B1 and boundaryEvent:error B0 both catch every error (no error code) (the boundary events of X); Camunda 8 allows one catch-all per scope',
          path: ['eventDefinitions', 0, 'errorRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
      {
        name: 'two error event sub-processes with one code',
        moddleElement: engineModel(
          'c8',
          eventSubProcesses(ERROR_DEFINITION('ED0', 'Err'), ERROR_DEFINITION('ED1', 'Err')),
          { roots: ERROR('C') },
        ),
        report: {
          id: 'ESP1_S',
          message:
            'startEvent:error ESP1_S catches the error code "C" like startEvent:error ESP0_S (the event sub-processes of process_test); Camunda 8 refuses one code twice in a scope',
          path: ['eventDefinitions', 0, 'errorRef'],
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
        },
      },
    ],
  });
});
