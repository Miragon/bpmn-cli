import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-signal.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const SIGNAL_DEFINITION = (id: string, ref = 'Sig') =>
  `<bpmn:signalEventDefinition id="${id}" signalRef="${ref}" />`;

const toEnd = (start = '') => `
  <bpmn:startEvent id="Start">${start}</bpmn:startEvent>
  <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
  <bpmn:endEvent id="End" />`;

const TWO_STARTS = `${toEnd(SIGNAL_DEFINITION('SD'))}
  <bpmn:startEvent id="S2">${SIGNAL_DEFINITION('SD2', 'Sig2')}</bpmn:startEvent>
  <bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />`;

const TWO_BOUNDARIES = `
  <bpmn:startEvent id="Start" />
  <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
  <bpmn:serviceTask id="X" />
  <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
  <bpmn:endEvent id="End" />
  <bpmn:boundaryEvent id="B0" attachedToRef="X">${SIGNAL_DEFINITION('SD0')}</bpmn:boundaryEvent>
  <bpmn:boundaryEvent id="B1" attachedToRef="X">${SIGNAL_DEFINITION('SD1')}</bpmn:boundaryEvent>`;

const SIGNALS = (first: string, second = first) =>
  `<bpmn:signal id="Sig" name="${first}" /><bpmn:signal id="Sig2" name="${second}" />`;

verifyEngineRule('c8-signal', rule, {
  valid: [
    {
      name: 'a signal start event with a static name',
      moddleElement: engineModel('c8', toEnd(SIGNAL_DEFINITION('SD')), { roots: SIGNALS('sig') }),
    },
    {
      name: 'a FEEL signal name on a throw event',
      moddleElement: engineModel(
        'c8',
        `<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" /><bpmn:endEvent id="End">${SIGNAL_DEFINITION('SD')}</bpmn:endEvent>`,
        { roots: SIGNALS('=sig') },
      ),
    },
    {
      name: 'two signal start events with different names',
      moddleElement: engineModel('c8', TWO_STARTS, { roots: SIGNALS('one', 'two') }),
    },
    {
      name: 'a signal without name (camunda-compat signal-reference)',
      moddleElement: engineModel('c8', toEnd(SIGNAL_DEFINITION('SD')), {
        roots: '<bpmn:signal id="Sig" />',
      }),
    },
    {
      name: 'two signal start events with one name in a process that is not executable',
      moddleElement: engineModel('c8', TWO_STARTS, {
        roots: SIGNALS('sig'),
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'two signal start events of one name in an event sub-process scope',
      moddleElement: engineModel(
        'c8',
        `${toEnd()}<bpmn:subProcess id="ESP" triggeredByEvent="true"><bpmn:startEvent id="ESP_S">${SIGNAL_DEFINITION('SD')}</bpmn:startEvent></bpmn:subProcess><bpmn:subProcess id="ESP2" triggeredByEvent="true"><bpmn:startEvent id="ESP2_S">${SIGNAL_DEFINITION('SD2')}</bpmn:startEvent></bpmn:subProcess>`,
        { roots: SIGNALS('sig') },
      ),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel('c7', TWO_STARTS, { roots: SIGNALS('sig') }),
    },
  ],
  invalid: [
    {
      name: 'a signal start event with a FEEL name',
      moddleElement: engineModel('c8', toEnd(SIGNAL_DEFINITION('SD')), { roots: SIGNALS('=sig') }),
      report: {
        id: 'Start',
        message:
          'Start event Start catches the signal "=sig", a FEEL expression; Camunda 8 needs a static signal name on start events and refuses the file',
        path: ['eventDefinitions', 0, 'signalRef', 'name'],
        type: ERROR_TYPES.EXPRESSION_NOT_ALLOWED,
      },
    },
    {
      name: 'two signal start events with one name',
      moddleElement: engineModel('c8', TWO_STARTS, { roots: SIGNALS('sig') }),
      report: {
        id: 'S2',
        message:
          'startEvent:signal S2 waits for the signal "sig" like startEvent:signal Start in process process_test; Camunda 8 refuses one signal name twice there',
        path: ['eventDefinitions', 0, 'signalRef'],
        type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
      },
    },
    {
      name: 'two signal boundary events with one name',
      moddleElement: engineModel('c8', TWO_BOUNDARIES, { roots: SIGNALS('sig') }),
      report: {
        id: 'B1',
        message:
          'boundaryEvent:signal B1 waits for the signal "sig" like boundaryEvent:signal B0 on X; Camunda 8 refuses one signal name twice there',
        path: ['eventDefinitions', 0, 'signalRef'],
        type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
      },
    },
  ],
});
