import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-definitions-extension.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const CHAIN = `<bpmn:startEvent id="Start" /><bpmn:serviceTask id="X" camunda:expression="\${true}" /><bpmn:endEvent id="End" />
  <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" /><bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />`;
const PROPERTIES =
  '<camunda:properties><camunda:property name="a" value="b" /></camunda:properties>';
const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;

verifyEngineRule('c7-definitions-extension', rule, {
  valid: [
    {
      name: 'extension elements on the process',
      moddleElement: engineModel('c7', `${ext(PROPERTIES)}${CHAIN}`),
    },
    {
      name: 'empty extension elements under bpmn:definitions',
      moddleElement: engineModel('c7', CHAIN, { roots: ext('') }),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', CHAIN.replace(' camunda:expression="${true}"', ''), {
        roots: ext('<zeebe:properties><zeebe:property name="a" value="b" /></zeebe:properties>'),
      }),
    },
  ],
  invalid: [
    {
      name: 'extensionElements under bpmn:definitions',
      moddleElement: engineModel('c7', CHAIN, { roots: ext(PROPERTIES) }),
      report: {
        id: 'definitions_test',
        message:
          'bpmn:definitions carries bpmn:extensionElements (camunda:properties), which the BPMN schema does not allow there; the engines refuse the file',
        path: ['extensionElements'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
    {
      name: 'extensionElements under bpmn:definitions in a file whose process is not executable',
      moddleElement: engineModel('c7', CHAIN, {
        roots: ext(`${PROPERTIES}<camunda:inputOutput />`),
        processAttributes: 'isExecutable="false"',
      }),
      report: {
        id: 'definitions_test',
        message:
          'bpmn:definitions carries bpmn:extensionElements (camunda:properties, camunda:inputOutput), which the BPMN schema does not allow there; the engines refuse the file',
        path: ['extensionElements'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
  ],
});
