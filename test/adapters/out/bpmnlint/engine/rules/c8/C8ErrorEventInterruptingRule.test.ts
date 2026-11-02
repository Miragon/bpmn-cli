import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8ErrorEventInterruptingRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-error-event-interrupting', () => {
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
        name: 'a non-interrupting error boundary event',
        moddleElement: engineModel(
          'c8',
          boundaries([ERROR_DEFINITION('ED0')], ' cancelActivity="false"'),
        ),
        report: {
          id: 'B0',
          message:
            'boundaryEvent:error B0 is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)',
          path: ['cancelActivity'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a non-interrupting error start event of an event sub-process',
        moddleElement: engineModel(
          'c8',
          eventSubProcesses(ERROR_DEFINITION('ED0')).replace(
            '<bpmn:startEvent id="ESP0_S">',
            '<bpmn:startEvent id="ESP0_S" isInterrupting="false">',
          ),
        ),
        report: {
          id: 'ESP0_S',
          message:
            'startEvent:error ESP0_S is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)',
          path: ['isInterrupting'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});
