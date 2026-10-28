import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-multi-instance.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

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
