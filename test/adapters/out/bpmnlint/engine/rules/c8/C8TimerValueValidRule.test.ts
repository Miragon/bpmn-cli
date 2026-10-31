import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8TimerValueValidRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-timer-value-valid', () => {
  const timer = (kind: string, value: string) =>
    `<bpmn:startEvent id="Start" /><bpmn:intermediateCatchEvent id="Wait"><bpmn:timerEventDefinition><bpmn:${kind} xsi:type="bpmn:tFormalExpression">${value}</bpmn:${kind}></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`;
  const refused = (kind: string, text: string) => ({
    id: 'Wait',
    message: `The ${kind}${text}; Camunda 8 refuses the file`,
    path: ['eventDefinitions', 0, kind],
    type: ERROR_TYPES.EXPRESSION_VALUE_NOT_ALLOWED,
  });

  verifyEngineRule(rule, {
    valid: [
      { name: 'an ISO 8601 duration', moddleElement: engineModel('c8', timer('timeDuration', 'PT1H')) },
      { name: 'a FEEL expression', moddleElement: engineModel('c8', timer('timeDuration', '=duration')) },
      { name: 'a timer in a process that is not executable', moddleElement: engineModel('c8', timer('timeDuration', '1 hour'), { processAttributes: 'isExecutable="false"' }) },
    ],
    invalid: [
      {
        name: 'a duration in words',
        moddleElement: engineModel('c8', timer('timeDuration', '1 hour')),
        report: refused('timeDuration', ' "1 hour" of intermediateCatchEvent:timer Wait is not an ISO 8601 duration (PT1H, P2D)'),
      },
      {
        name: 'an empty duration',
        moddleElement: engineModel('c8', timer('timeDuration', '')),
        report: refused('timeDuration', ' of intermediateCatchEvent:timer Wait is empty'),
      },
      {
        name: 'a date out of range',
        moddleElement: engineModel('c8', timer('timeDate', '2030-13-01T10:00:00Z')),
        report: refused('timeDate', ' "2030-13-01T10:00:00Z" of intermediateCatchEvent:timer Wait is no valid date-time: month 13 is not in 01-12'),
      },
      {
        name: 'a cycle in words',
        moddleElement: engineModel('c8', timer('timeCycle', 'every day')),
        report: refused('timeCycle', ' "every day" of intermediateCatchEvent:timer Wait is not a repeating interval (R/PT1H, R5/2030-01-01T08:00:00Z/P1D) or a 6-field cron expression (0 0 9 * * MON)'),
      },
    ],
  });
});
