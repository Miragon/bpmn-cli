import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-implementation.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const JOB =
  '<bpmn:extensionElements><zeebe:taskDefinition type="notify" /></bpmn:extensionElements>';
const message = (name: string | null) =>
  `<bpmn:message id="M1"${name === null ? '' : ` name="${name}"`} />`;

const sendTask = `<bpmn:sendTask id="X" messageRef="M1">${JOB}</bpmn:sendTask>`;
const throwEvent = (kind: string) =>
  `<bpmn:${kind} id="X">${JOB}<bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:${kind}>`;

verifyEngineRule('c8-implementation', rule, {
  valid: [
    {
      name: 'a send task with a named message',
      moddleElement: engineModel('c8', sendTask, { roots: message('Notified') }),
    },
    {
      name: 'a message with a white-space name (Camunda 8 deploys it)',
      moddleElement: engineModel('c8', sendTask, { roots: message('   ') }),
    },
    {
      name: 'a send task without message (left to camunda-compat)',
      moddleElement: engineModel('c8', `<bpmn:sendTask id="X">${JOB}</bpmn:sendTask>`),
    },
    {
      name: 'a receive task with a nameless message (camunda-compat message-reference)',
      moddleElement: engineModel('c8', '<bpmn:receiveTask id="X" messageRef="M1" />', {
        roots: message(null),
      }),
    },
    {
      name: 'a throw event with two definitions (refused for that)',
      moddleElement: engineModel(
        'c8',
        `<bpmn:intermediateThrowEvent id="X"><bpmn:messageEventDefinition id="MD" messageRef="M1" /><bpmn:signalEventDefinition id="SD" /></bpmn:intermediateThrowEvent>`,
        { roots: message(null) },
      ),
    },
    {
      name: 'a process that is not executable',
      moddleElement: engineModel('c8', sendTask, {
        roots: message(null),
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel('c7', '<bpmn:sendTask id="X" messageRef="M1" />', {
        roots: message(null),
      }),
    },
  ],
  invalid: [
    {
      name: 'a send task whose message has no name',
      moddleElement: engineModel('c8', sendTask, { roots: message(null) }),
      report: {
        id: 'X',
        message: 'Message M1 of sendTask X has no name; Camunda 8 refuses the file',
        path: ['messageRef', 'name'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    {
      name: 'a send task whose message has an empty name',
      moddleElement: engineModel('c8', sendTask, { roots: message('') }),
      report: {
        id: 'X',
        message: 'Message M1 of sendTask X has no name; Camunda 8 refuses the file',
        path: ['messageRef', 'name'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    ...['intermediateThrowEvent', 'endEvent'].map((kind) => ({
      name: `a message ${kind} whose message has no name`,
      moddleElement: engineModel('c8', throwEvent(kind), { roots: message(null) }),
      report: {
        id: 'X',
        message: `Message M1 of ${kind}:message X has no name; Camunda 8 refuses the file`,
        path: ['eventDefinitions', 0, 'messageRef', 'name'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    })),
  ],
});
