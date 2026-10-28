import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe, expect, it } from 'vitest';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8Schema.js';
import { validateXml } from '../../../../../../src/api.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const SCHEMA = 'Camunda 8 validates the file against the schema and refuses it';
const ID_SCHEMA = 'Camunda 8 validates the file against the BPMN schema and refuses it';
const DI_NAMESPACES =
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"';
const diagram = (shape: string) => `
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="process_test">${shape}</bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>`;

const badId = (id: string, what: string, reason: string) => ({
  id,
  message: `${what} has the id "${id}", which is no XML NCName (${reason}); ${ID_SCHEMA}`,
  path: ['id'],
  type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
});

const COLON = 'a colon is not allowed in an id';

verifyEngineRule('c8-schema', rule, {
  valid: [
    {
      name: 'prefixed attributes and NCName ids (unknown zeebe attributes are c8-unknown-attribute)',
      moddleElement: engineModel(
        'c8',
        '<bpmn:task id="task_check.1-a" zeebe:bogus="x" /><bpmn:task id="täsk_ünïcode" />',
        {
          definitionsAttributes: DI_NAMESPACES,
          roots: diagram(
            '<bpmndi:BPMNShape id="task_check_di" bpmnElement="task_check.1-a"><dc:Bounds x="1" y="2" width="3" height="4" /></bpmndi:BPMNShape>',
          ),
        },
      ),
    },
    {
      name: 'empty extension elements on bpmn:definitions',
      moddleElement: engineModel('c8', '<bpmn:task id="X" />', {
        roots: '<bpmn:extensionElements />',
      }),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel('c7', '<bpmn:task id="a:b" bad="x" />'),
    },
  ],
  invalid: [
    {
      name: 'extension elements on bpmn:definitions',
      moddleElement: engineModel('c8', '<bpmn:task id="X" />', {
        roots:
          '<bpmn:extensionElements><zeebe:properties><zeebe:property name="a" value="b" /></zeebe:properties></bpmn:extensionElements>',
      }),
      report: {
        id: 'definitions_test',
        message:
          'bpmn:definitions carries bpmn:extensionElements, which the BPMN schema does not allow there; Camunda 8 refuses the file',
        path: ['extensionElements'],
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
      },
    },
    {
      name: 'a task id with a colon',
      moddleElement: engineModel('c8', '<bpmn:serviceTask id="a:b" />'),
      report: badId('a:b', 'serviceTask a:b', COLON),
    },
    {
      name: 'an id with a leading digit on a zeebe element (bpmn-moddle reads it as a string)',
      moddleElement: engineModel(
        'c8',
        '<bpmn:serviceTask id="X"><bpmn:extensionElements><zeebe:taskHeaders><zeebe:header id="1header" key="k" value="v" /></zeebe:taskHeaders></bpmn:extensionElements></bpmn:serviceTask>',
      ),
      report: badId(
        '1header',
        'zeebe:Header 1header',
        'letters, digits, _ . - and no leading digit',
      ),
    },
    {
      name: 'a shape id with a colon',
      moddleElement: engineModel('c8', '<bpmn:task id="X" />', {
        definitionsAttributes: DI_NAMESPACES,
        roots: diagram(
          '<bpmndi:BPMNShape id="X:di" bpmnElement="X"><dc:Bounds x="1" y="2" width="3" height="4" /></bpmndi:BPMNShape>',
        ),
      }),
      report: badId('X:di', 'bpmndi:BPMNShape', COLON),
    },
  ],
});

describe('unprefixed attributes: bpmn-cli reads them from its own model (UnprefixedAttributes), once each', () => {
  const xml = (content: string, { roots = '', definitions = '', executable = 'true' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" ${DI_NAMESPACES} modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0" ${definitions} id="definitions_test" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="process_test" isExecutable="${executable}">${content}</bpmn:process>${roots}
</bpmn:definitions>`;
  const attribute = (element: string, where: string, key: string) => ({ element, message: `${where} has the attribute ${key}, which the BPMN schema does not define; ${SCHEMA}` });
  const cases: Array<[name: string, xml: string, expected: Array<ReturnType<typeof attribute>>]> = [
    ['an unprefixed attribute on a task', xml('<bpmn:serviceTask id="X" bad="x" />'), [attribute('X', 'serviceTask X', 'bad')]],
    ['an unprefixed calledDecision on a business rule task, in a process that is not executable', xml('<bpmn:businessRuleTask id="X" calledDecision="d"><bpmn:extensionElements><zeebe:calledDecision decisionId="d" resultVariable="r" /></bpmn:extensionElements></bpmn:businessRuleTask>', { executable: 'false' }), [attribute('X', 'businessRuleTask X', 'calledDecision')]],
    ['an unprefixed attribute on an event definition with an id, reported on its event', xml('<bpmn:intermediateCatchEvent id="X"><bpmn:timerEventDefinition id="TD" bad="x"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>'), [attribute('X', 'bpmn:TimerEventDefinition in X', 'bad')]],
    ['an unprefixed attribute on a condition without id', xml('<bpmn:exclusiveGateway id="A" /><bpmn:task id="B" /><bpmn:sequenceFlow id="X" sourceRef="A" targetRef="B"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="feel" bad="x">= true</bpmn:conditionExpression></bpmn:sequenceFlow>'), [attribute('X', 'bpmn:FormalExpression in X', 'bad')]],
    ['two unprefixed attributes on bpmn:definitions', xml('<bpmn:task id="X" />', { definitions: 'bad="x" other="y"' }), [attribute('definitions_test', 'definitions definitions_test', 'bad'), attribute('definitions_test', 'definitions definitions_test', 'other')]],
    ['an unprefixed attribute on the bounds of a shape', xml('<bpmn:task id="X" />', { roots: diagram('<bpmndi:BPMNShape id="X_di" bpmnElement="X"><dc:Bounds x="1" y="2" width="3" height="4" bad="x" /></bpmndi:BPMNShape>') }), [attribute('X_di', 'dc:Bounds in X_di', 'bad')]],
  ];

  it.each(cases)('%s', async (_name, model, expected) => {
    const { warnings } = await validateXml(model);
    expect(warnings.filter((warning) => warning.code === 'W_C8_DEPLOY_SCHEMA' && warning.message.includes('which the BPMN schema does not define')).map(({ element, message }) => ({ element, message }))).toEqual(expected);
  });
});
