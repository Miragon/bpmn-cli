import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7HistoryTimeToLiveValidRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-history-time-to-live-valid', () => {
  const withTimeToLive = (value: string, executable = 'true') =>
    engineModel('c7', '', {
      processAttributes: `isExecutable="${executable}" camunda:historyTimeToLive="${value}"`,
    });

  verifyEngineRule(rule, {
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
