import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7ValuesRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-attribute-value', () => {
  const NOT_A_NUMBER = (attribute: string, value: string, where: string) =>
    `camunda:${attribute}="${value}" on ${where} is not a number or expression; the engines refuse it`;

  verifyEngineRule('c7-attribute-value', rule, {
    valid: [
      {
        name: 'priorities as numbers and expressions, a known decision result mapper',
        moddleElement: engineModel(
          'c7',
          `<bpmn:serviceTask id="serviceTask_a" camunda:type="external" camunda:topic="chargeCard" camunda:taskPriority="5" camunda:asyncBefore="true" camunda:jobPriority="\${priority}" />
          <bpmn:businessRuleTask id="businessRuleTask_b" camunda:decisionRef="risk" camunda:mapDecisionResult="collectEntries" />
          <bpmn:userTask id="userTask_c"><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${items}" camunda:elementVariable="item" camunda:jobPriority="-3" /></bpmn:userTask>`,
          {
            processAttributes:
              'isExecutable="true" camunda:jobPriority="10" camunda:taskPriority="#{priority}"',
          },
        ),
      },
      {
        name: 'a mapDecisionResult without decisionRef is not read',
        moddleElement: engineModel(
          'c7',
          '<bpmn:businessRuleTask id="businessRuleTask_b" camunda:class="org.example.Rule" camunda:mapDecisionResult="foo" />',
        ),
      },
      {
        name: 'a taskPriority where the engines do not read it',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_a" camunda:class="org.example.Bean" camunda:taskPriority="high" /><bpmn:userTask id="userTask_c" camunda:taskPriority="high" />',
        ),
      },
      {
        name: 'an ad-hoc sub-process and its content',
        moddleElement: engineModel(
          'c7',
          '<bpmn:adHocSubProcess id="adHocSubProcess_x" camunda:jobPriority="high"><bpmn:userTask id="userTask_c" camunda:jobPriority="high" /></bpmn:adHocSubProcess>',
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_c" camunda:jobPriority="high" />',
          {
            processAttributes: 'isExecutable="false" camunda:jobPriority="high"',
          },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_c" camunda:jobPriority="high" />',
          {
            definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
          },
        ),
      },
    ],
    invalid: [
      {
        name: 'a jobPriority that is not a number',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_a" camunda:class="org.example.Bean" camunda:asyncBefore="true" camunda:jobPriority="high" />',
        ),
        report: {
          id: 'serviceTask_a',
          message: NOT_A_NUMBER('jobPriority', 'high', 'serviceTask serviceTask_a'),
          path: ['jobPriority'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'process priorities that are not numbers',
        moddleElement: engineModel('c7', '', {
          processAttributes:
            'isExecutable="true" camunda:jobPriority="high" camunda:taskPriority="1.5"',
        }),
        report: [
          {
            id: 'process_test',
            message: NOT_A_NUMBER('jobPriority', 'high', 'process process_test'),
            path: ['jobPriority'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
          {
            id: 'process_test',
            message: NOT_A_NUMBER('taskPriority', '1.5', 'process process_test'),
            path: ['taskPriority'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'a jobPriority on the multi-instance loop',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_c"><bpmn:multiInstanceLoopCharacteristics camunda:collection="${items}" camunda:jobPriority=" 5" /></bpmn:userTask>',
        ),
        report: {
          id: 'userTask_c',
          message: NOT_A_NUMBER(
            'jobPriority',
            ' 5',
            'the multiInstanceLoopCharacteristics of userTask userTask_c',
          ),
          path: ['loopCharacteristics', 'jobPriority'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a taskPriority of an external message end event',
        moddleElement: engineModel(
          'c7',
          '<bpmn:endEvent id="endEvent_done"><bpmn:messageEventDefinition camunda:type="external" camunda:topic="notify" camunda:taskPriority="high" /></bpmn:endEvent>',
        ),
        report: {
          id: 'endEvent_done',
          message: NOT_A_NUMBER(
            'taskPriority',
            'high',
            'the messageEventDefinition of endEvent:message endEvent_done',
          ),
          path: ['eventDefinitions', 0, 'taskPriority'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a mapDecisionResult not one of the four',
        moddleElement: engineModel(
          'c7',
          '<bpmn:businessRuleTask id="businessRuleTask_b" camunda:decisionRef="risk" camunda:mapDecisionResult="foo" />',
        ),
        report: {
          id: 'businessRuleTask_b',
          message:
            'camunda:mapDecisionResult="foo" on businessRuleTask businessRuleTask_b is not one of singleEntry, singleResult, collectEntries, resultList; the engines refuse the file',
          path: ['mapDecisionResult'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c7-bad-value', () => {
  const conditional = (variableEvents: string) =>
    `<bpmn:intermediateCatchEvent id="event_wait"><bpmn:conditionalEventDefinition camunda:variableEvents="${variableEvents}"><bpmn:condition xsi:type="bpmn:tFormalExpression">\${ready}</bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>`;

  verifyEngineRule('c7-bad-value', rule, {
    valid: [
      {
        name: 'Camunda Modeler style values',
        moddleElement: engineModel(
          'c7',
          `<bpmn:serviceTask id="serviceTask_a" camunda:type="external" camunda:topic="chargeCard" />
          <bpmn:userTask id="userTask_b" camunda:priority="\${priority}" />
          <bpmn:userTask id="userTask_c" camunda:priority="50" />
          <bpmn:callActivity id="callActivity_d" calledElement="other" camunda:calledElementBinding="versionTag" camunda:calledElementVersionTag="1.0" camunda:caseBinding="deployment" />
          <bpmn:businessRuleTask id="businessRuleTask_e" camunda:decisionRef="risk" camunda:decisionRefBinding="latest" />
          ${conditional('create, update')}`,
        ),
      },
      {
        name: 'a missing version is c7-binding-version, a missing calledElement c7-called-element',
        moddleElement: engineModel(
          'c7',
          `<bpmn:callActivity id="callActivity_d" calledElement="other" camunda:calledElementBinding="version" />
          <bpmn:callActivity id="callActivity_e" />
          <bpmn:callActivity id="callActivity_f" calledElement="" camunda:caseRef="case" />`,
        ),
      },
      {
        name: 'a decisionRefBinding without decisionRef is not read',
        moddleElement: engineModel(
          'c7',
          '<bpmn:businessRuleTask id="businessRuleTask_e" camunda:class="org.example.Rule" camunda:decisionRefBinding="foo" />',
        ),
      },
      {
        name: 'a variable event on a definition the engines do not act on',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateCatchEvent id="event_wait"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition><bpmn:conditionalEventDefinition camunda:variableEvents="change"><bpmn:condition xsi:type="bpmn:tFormalExpression">\${ready}</bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>`,
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_b" camunda:priority="high" />',
          {
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_b" camunda:priority="high" />',
          {
            definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
          },
        ),
      },
    ],
    invalid: [
      {
        name: 'unknown binding values',
        moddleElement: engineModel(
          'c7',
          `<bpmn:callActivity id="callActivity_d" calledElement="other" camunda:calledElementBinding="foo" />
          <bpmn:businessRuleTask id="businessRuleTask_e" camunda:decisionRef="risk" camunda:decisionRefBinding="foo" />`,
        ),
        report: [
          {
            id: 'callActivity_d',
            message:
              'camunda:calledElementBinding="foo" on callActivity callActivity_d is not one of latest, deployment, version, versionTag; the engines accept the file but cannot resolve the reference as intended',
            path: ['calledElementBinding'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
          {
            id: 'businessRuleTask_e',
            message:
              'camunda:decisionRefBinding="foo" on businessRuleTask businessRuleTask_e is not one of latest, deployment, version, versionTag; the engines accept the file but cannot resolve the reference as intended',
            path: ['decisionRefBinding'],
            type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'a caseBinding of versionTag',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_d" camunda:caseRef="case" camunda:caseBinding="versionTag" />',
        ),
        report: {
          id: 'callActivity_d',
          message:
            'camunda:caseBinding="versionTag" on callActivity callActivity_d is not one of latest, deployment, version; the engines accept the file but cannot resolve the reference as intended',
          path: ['caseBinding'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a user task priority that is not a number or expression',
        moddleElement: engineModel('c7', '<bpmn:userTask id="userTask_b" camunda:priority="high" />'),
        report: {
          id: 'userTask_b',
          message:
            'camunda:priority="high" on userTask userTask_b is not a number or expression; creating the task fails',
          path: ['priority'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a variable event the engines do not know',
        moddleElement: engineModel('c7', conditional('create, change')),
        report: {
          id: 'event_wait',
          message:
            'camunda:variableEvents="create, change" of intermediateCatchEvent:conditional event_wait lists change; only create, update, delete trigger the condition',
          path: ['eventDefinitions', 0, 'variableEvents'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c7-binding-version', () => {
  const MISSING = (where: string, binding: string, value: string, missing: string) =>
    `${where} has camunda:${binding}="${value}" but no camunda:${missing}; the engines refuse the file`;

  verifyEngineRule('c7-binding-version', rule, {
    valid: [
      {
        name: 'bindings with the version or tag they bind to',
        moddleElement: engineModel(
          'c7',
          `<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="version" camunda:calledElementVersion="3" />
          <bpmn:callActivity id="callActivity_b" calledElement="other" camunda:calledElementBinding="versionTag" camunda:calledElementVersionTag="1.0" />
          <bpmn:businessRuleTask id="businessRuleTask_c" camunda:decisionRef="risk" camunda:decisionRefBinding="versionTag" camunda:decisionRefVersionTag="1.0" />
          <bpmn:userTask id="userTask_d" camunda:formRef="form" camunda:formRefBinding="version" camunda:formRefVersion="2" />
          <bpmn:callActivity id="callActivity_e" calledElement="other" camunda:calledElementBinding="latest" />`,
        ),
      },
      {
        name: 'a caseBinding of versionTag (c7-bad-value)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" camunda:caseRef="case" camunda:caseBinding="versionTag" />',
        ),
      },
      {
        name: 'a decisionRefBinding without decisionRef, a formRefBinding without formRef',
        moddleElement: engineModel(
          'c7',
          `<bpmn:businessRuleTask id="businessRuleTask_c" camunda:class="org.example.Rule" camunda:decisionRefBinding="version" />
          <bpmn:userTask id="userTask_d" camunda:formRefBinding="version" />`,
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="version" />',
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="version" />',
          { definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"' },
        ),
      },
    ],
    invalid: [
      {
        name: 'calledElementBinding=version without version',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="version" />',
        ),
        report: {
          id: 'callActivity_a',
          message: MISSING(
            'callActivity callActivity_a',
            'calledElementBinding',
            'version',
            'calledElementVersion',
          ),
          path: ['calledElementVersion'],
          type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
        },
      },
      {
        name: 'calledElementBinding=versionTag and caseBinding=version without them',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:calledElementBinding="versionTag" camunda:caseBinding="version" />',
        ),
        report: [
          {
            id: 'callActivity_a',
            message: MISSING(
              'callActivity callActivity_a',
              'calledElementBinding',
              'versionTag',
              'calledElementVersionTag',
            ),
            path: ['calledElementVersionTag'],
            type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
          },
          {
            id: 'callActivity_a',
            message: MISSING('callActivity callActivity_a', 'caseBinding', 'version', 'caseVersion'),
            path: ['caseVersion'],
            type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
          },
        ],
      },
      {
        name: 'decisionRefBinding=versionTag without tag',
        moddleElement: engineModel(
          'c7',
          '<bpmn:businessRuleTask id="businessRuleTask_c" camunda:decisionRef="risk" camunda:decisionRefBinding="versionTag" />',
        ),
        report: {
          id: 'businessRuleTask_c',
          message: MISSING(
            'businessRuleTask businessRuleTask_c',
            'decisionRefBinding',
            'versionTag',
            'decisionRefVersionTag',
          ),
          path: ['decisionRefVersionTag'],
          type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
        },
      },
      {
        name: 'formRefBinding=version without formRefVersion on a start event',
        moddleElement: engineModel(
          'c7',
          '<bpmn:startEvent id="startEvent_a" camunda:formRef="form" camunda:formRefBinding="version" />',
        ),
        report: {
          id: 'startEvent_a',
          message: MISSING('startEvent startEvent_a', 'formRefBinding', 'version', 'formRefVersion'),
          path: ['formRefVersion'],
          type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
        },
      },
    ],
  });
});

describe('c7-form', () => {
  verifyEngineRule('c7-form', rule, {
    valid: [
      {
        name: 'a form key, or a form reference with a binding',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_a" camunda:formKey="embedded:app:forms/a.html" />
          <bpmn:userTask id="userTask_b" camunda:formRef="form" camunda:formRefBinding="latest" />
          <bpmn:startEvent id="startEvent_c" camunda:formRef="form" camunda:formRefBinding="deployment" />`,
        ),
      },
      {
        name: 'a version binding without version (c7-binding-version)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_b" camunda:formRef="form" camunda:formRefBinding="version" />',
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel('c7', '<bpmn:userTask id="userTask_b" camunda:formRef="form" />', {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:userTask id="userTask_b" camunda:formRef="form" />', {
          definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
        }),
      },
    ],
    invalid: [
      {
        name: 'a formRef without formRefBinding',
        moddleElement: engineModel('c7', '<bpmn:userTask id="userTask_b" camunda:formRef="form" />'),
        report: {
          id: 'userTask_b',
          message:
            'userTask userTask_b has camunda:formRef but no camunda:formRefBinding (one of deployment, latest, version is required); the engines refuse the file',
          path: ['formRefBinding'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'a formRefBinding of versionTag on a start event',
        moddleElement: engineModel(
          'c7',
          '<bpmn:startEvent id="startEvent_c" camunda:formRef="form" camunda:formRefBinding="versionTag" />',
        ),
        report: {
          id: 'startEvent_c',
          message:
            'startEvent startEvent_c has camunda:formRef but camunda:formRefBinding="versionTag" (one of deployment, latest, version is required); the engines refuse the file',
          path: ['formRefBinding'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'formKey and formRef together',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_b" camunda:formKey="key" camunda:formRef="form" camunda:formRefBinding="latest" />',
        ),
        report: {
          id: 'userTask_b',
          message:
            'userTask userTask_b has both camunda:formKey and camunda:formRef; the engines refuse the file',
          path: ['formKey'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c7-called-element', () => {
  verifyEngineRule('c7-called-element', rule, {
    valid: [
      {
        name: 'a called process or a called case',
        moddleElement: engineModel(
          'c7',
          `<bpmn:callActivity id="callActivity_a" calledElement="other" />
          <bpmn:callActivity id="callActivity_b" camunda:caseRef="case" />`,
        ),
      },
      {
        name: 'an empty calledElement (c7-bad-value)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" calledElement="" />',
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel('c7', '<bpmn:callActivity id="callActivity_a" />', {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a call activity in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:adHocSubProcess id="adHocSubProcess_x"><bpmn:callActivity id="callActivity_a" /></bpmn:adHocSubProcess>',
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:callActivity id="callActivity_a" />'),
      },
    ],
    invalid: [
      {
        name: 'a call activity without calledElement',
        moddleElement: engineModel('c7', '<bpmn:callActivity id="callActivity_a" />'),
        report: {
          id: 'callActivity_a',
          message:
            'Call activity callActivity_a has no calledElement (nor camunda:caseRef); the engines refuse the file',
          path: ['calledElement'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
      {
        name: 'a call activity with calledElement and caseRef',
        moddleElement: engineModel(
          'c7',
          '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:caseRef="case" />',
        ),
        report: {
          id: 'callActivity_a',
          message:
            'Call activity callActivity_a has both calledElement and camunda:caseRef; the engines refuse the file',
          path: ['caseRef'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c7-history-time-to-live', () => {
  const withTimeToLive = (value: string, executable = 'true') =>
    engineModel('c7', '', {
      processAttributes: `isExecutable="${executable}" camunda:historyTimeToLive="${value}"`,
    });

  verifyEngineRule('c7-history-time-to-live', rule, {
    valid: [
      { name: 'a number of days', moddleElement: withTimeToLive('180') },
      { name: 'zero days', moddleElement: withTimeToLive('0') },
      { name: 'P<n>D', moddleElement: withTimeToLive('P30D') },
      { name: 'no history time to live (camunda-compat)', moddleElement: engineModel('c7', '') },
      { name: 'an empty history time to live (camunda-compat)', moddleElement: withTimeToLive('') },
      { name: 'a non-executable process', moddleElement: withTimeToLive('PT5H', 'false') },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '', {
          processAttributes: 'isExecutable="true" camunda:historyTimeToLive="PT5H"',
          definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
        }),
      },
    ],
    invalid: [
      ...['PT5H', 'abc', '2147483648', '-1'].map((value) => ({
        name: `a history time to live of ${value}`,
        moddleElement: withTimeToLive(value),
        report: {
          id: 'process_test',
          message: `camunda:historyTimeToLive="${value}" of process process_test is not a number of days (or P<n>D); the engines refuse it`,
          path: ['historyTimeToLive'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      })),
    ],
  });
});

describe('c7-multi-instance', () => {
  const NO_INPUT = (id: string, misplaced = '') => ({
    id,
    message: `Multi-instance userTask ${id} has neither a loop cardinality nor camunda:collection${misplaced}; the engines refuse the file`,
    path: ['loopCharacteristics', 'collection'],
    type: ERROR_TYPES.PROPERTY_REQUIRED,
  });

  verifyEngineRule('c7-multi-instance', rule, {
    valid: [
      {
        name: 'a collection, a cardinality or a loopDataInputRef',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_a"><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${items}" camunda:elementVariable="item" /></bpmn:userTask>
          <bpmn:userTask id="userTask_b"><bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>3</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>
          <bpmn:userTask id="userTask_c"><bpmn:ioSpecification><bpmn:dataInput id="dataInput_items" /><bpmn:inputSet><bpmn:dataInputRefs>dataInput_items</bpmn:dataInputRefs></bpmn:inputSet><bpmn:outputSet /></bpmn:ioSpecification><bpmn:multiInstanceLoopCharacteristics><bpmn:loopDataInputRef>dataInput_items</bpmn:loopDataInputRef></bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>
          <bpmn:userTask id="userTask_d"><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${items}"><bpmn:loopCardinality /></bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>
          <bpmn:userTask id="userTask_e"><bpmn:standardLoopCharacteristics /></bpmn:userTask>`,
        ),
      },
      {
        name: 'a loop inside an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:adHocSubProcess id="adHocSubProcess_x"><bpmn:userTask id="userTask_a"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask></bpmn:adHocSubProcess>',
        ),
      },
      {
        name: 'a non-executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_a"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>',
          {
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_a"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>',
        ),
      },
    ],
    invalid: [
      {
        name: 'a multi-instance loop without cardinality or collection',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_a"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>',
        ),
        report: NO_INPUT('userTask_a'),
      },
      {
        name: 'the collection on the task instead of the loop',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_a" camunda:collection="${items}" camunda:elementVariable="item"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>',
        ),
        report: NO_INPUT('userTask_a', ' (camunda:collection sits on the activity, not on the loop)'),
      },
      {
        name: 'an empty loop cardinality',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_a"><bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality xsi:type="bpmn:tFormalExpression"> </bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>',
        ),
        report: {
          id: 'userTask_a',
          message:
            'Multi-instance userTask userTask_a has an empty loop cardinality; the engines refuse the file',
          path: ['loopCharacteristics', 'loopCardinality'],
          type: ERROR_TYPES.EXPRESSION_REQUIRED,
        },
      },
      {
        name: 'an element variable without collection',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_a"><bpmn:multiInstanceLoopCharacteristics camunda:elementVariable="item"><bpmn:loopCardinality>3</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>',
        ),
        report: {
          id: 'userTask_a',
          message:
            'Multi-instance userTask userTask_a has camunda:elementVariable but no camunda:collection; the engines refuse the file',
          path: ['loopCharacteristics', 'collection'],
          type: ERROR_TYPES.PROPERTY_DEPENDENT_REQUIRED,
        },
      },
      {
        name: 'an ad-hoc sub-process with a loop without cardinality',
        moddleElement: engineModel(
          'c7',
          '<bpmn:adHocSubProcess id="adHocSubProcess_x"><bpmn:multiInstanceLoopCharacteristics /><bpmn:userTask id="userTask_a" /></bpmn:adHocSubProcess>',
        ),
        report: {
          id: 'adHocSubProcess_x',
          message:
            'Multi-instance adHocSubProcess adHocSubProcess_x has neither a loop cardinality nor camunda:collection; the engines refuse the file',
          path: ['loopCharacteristics', 'collection'],
          type: ERROR_TYPES.PROPERTY_REQUIRED,
        },
      },
    ],
  });
});
