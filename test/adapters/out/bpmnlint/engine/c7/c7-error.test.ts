import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-error.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ERRORS =
  '<bpmn:error id="Err" name="Err" /><bpmn:error id="ErrBlank" name="Blank" errorCode=" " /><bpmn:error id="ErrCoded" name="Coded" errorCode="E1" />';
const START = '<bpmn:startEvent id="Start" />';
const errorEnd = (definition: string) =>
  `${START}<bpmn:endEvent id="End">${definition}</bpmn:endEvent>`;
const error = (ref?: string) => `<bpmn:errorEventDefinition${ref ? ` errorRef="${ref}"` : ''} />`;

verifyEngineRule('c7-error', rule, {
  valid: [
    {
      name: 'an error end event whose error has an errorCode',
      moddleElement: engineModel('c7', errorEnd(error('ErrCoded')), { roots: ERRORS }),
    },
    {
      name: 'an error boundary event without errorCode catches everything',
      moddleElement: engineModel(
        'c7',
        `${START}<bpmn:userTask id="X" /><bpmn:boundaryEvent id="B" attachedToRef="X">${error('Err')}</bpmn:boundaryEvent>`,
        { roots: ERRORS },
      ),
    },
    {
      name: 'an error end event without errorCode in a non-executable process',
      moddleElement: engineModel('c7', errorEnd(error('Err')), {
        roots: ERRORS,
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'an error end event without errorRef in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="AH">${errorEnd(error())}</bpmn:adHocSubProcess>`,
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', errorEnd(error()), { roots: ERRORS }),
    },
  ],
  invalid: [
    {
      name: 'an error end event whose error has no errorCode',
      moddleElement: engineModel('c7', errorEnd(error('Err')), { roots: ERRORS }),
      report: {
        id: 'End',
        message: 'Error Err thrown by endEvent:error End has no errorCode; the engines refuse the file',
        path: ['eventDefinitions', 0, 'errorRef', 'errorCode'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    {
      name: 'an error end event whose errorCode is blank',
      moddleElement: engineModel('c7', errorEnd(error('ErrBlank')), { roots: ERRORS }),
      report: {
        id: 'End',
        message:
          'Error ErrBlank thrown by endEvent:error End has no errorCode; the engines refuse the file',
        path: ['eventDefinitions', 0, 'errorRef', 'errorCode'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    {
      name: 'an error end event without errorRef',
      moddleElement: engineModel('c7', errorEnd(error())),
      report: {
        id: 'End',
        message: 'endEvent:error End throws no error (no errorRef); the engines refuse the file',
        path: ['eventDefinitions', 0, 'errorRef'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
  ],
});
