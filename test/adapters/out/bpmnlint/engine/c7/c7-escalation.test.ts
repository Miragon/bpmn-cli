import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-escalation.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ESCALATIONS =
  '<bpmn:escalation id="Esc" name="Esc" /><bpmn:escalation id="EscCoded" name="Coded" escalationCode="E" />';
const START = '<bpmn:startEvent id="Start" />';
const escalation = (ref?: string) =>
  `<bpmn:escalationEventDefinition${ref ? ` escalationRef="${ref}"` : ''} />`;
const escalationEnd = (definition: string) =>
  `${START}<bpmn:endEvent id="End">${definition}</bpmn:endEvent>`;
const onHost = (host: string) =>
  `${START}${host}<bpmn:boundaryEvent id="B" attachedToRef="X">${escalation('EscCoded')}</bpmn:boundaryEvent>`;
const SERVICE_TASK = '<bpmn:serviceTask id="X" camunda:expression="${true}" />';

verifyEngineRule('c7-escalation', rule, {
  valid: [
    {
      name: 'an escalation end event whose escalation has an escalationCode',
      moddleElement: engineModel('c7', escalationEnd(escalation('EscCoded')), {
        roots: ESCALATIONS,
      }),
    },
    {
      name: 'an escalation boundary event on a sub-process',
      moddleElement: engineModel('c7', onHost('<bpmn:subProcess id="X" />'), {
        roots: ESCALATIONS,
      }),
    },
    {
      name: 'an escalation boundary event on a call activity',
      moddleElement: engineModel(
        'c7',
        onHost('<bpmn:callActivity id="X" calledElement="other" />'),
        {
          roots: ESCALATIONS,
        },
      ),
    },
    {
      name: 'an escalation boundary event on a user task',
      moddleElement: engineModel('c7', onHost('<bpmn:userTask id="X" />'), { roots: ESCALATIONS }),
    },
    {
      name: 'an escalation boundary event on a service task in a non-executable process',
      moddleElement: engineModel('c7', onHost(SERVICE_TASK), {
        roots: ESCALATIONS,
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'an escalation end event without escalationRef in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="AH">${escalationEnd(escalation())}</bpmn:adHocSubProcess>`,
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', escalationEnd(escalation('Esc')), { roots: ESCALATIONS }),
    },
  ],
  invalid: [
    {
      name: 'an escalation end event without escalationCode',
      moddleElement: engineModel('c7', escalationEnd(escalation('Esc')), { roots: ESCALATIONS }),
      report: {
        id: 'End',
        message:
          'Escalation Esc thrown by endEvent:escalation End has no escalationCode; the engines refuse the file',
        path: ['eventDefinitions', 0, 'escalationRef', 'escalationCode'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    {
      name: 'an escalation throw event without escalationRef',
      moddleElement: engineModel(
        'c7',
        `${START}<bpmn:intermediateThrowEvent id="T">${escalation()}</bpmn:intermediateThrowEvent>`,
      ),
      report: {
        id: 'T',
        message:
          'intermediateThrowEvent:escalation T throws no escalation (no escalationRef); the engines refuse the file',
        path: ['eventDefinitions', 0, 'escalationRef'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    {
      name: 'an escalation boundary event on a service task',
      moddleElement: engineModel('c7', onHost(SERVICE_TASK), { roots: ESCALATIONS }),
      report: {
        id: 'B',
        message:
          'Escalation boundary event B is attached to serviceTask X; the engines allow it only on sub-processes, call activities and user tasks and refuse the file',
        path: ['attachedToRef'],
        type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED,
      },
    },
  ],
});
