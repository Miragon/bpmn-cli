import { describe, it } from 'vitest';
import { CamundaChecks } from '../../../../src/checks/camunda/CamundaChecks.js';
import { EngineRows } from '../../../support/EngineRows.js';

describe('C7BindingRules', () => {
  const rows = new EngineRows('C7BindingRules', (document, platform) => new CamundaChecks(document, platform));

  it.each(rows.verdicts())('answers as the engines recorded: $name', (row) => rows.expectVerdict(row));
  it.each(rows.parity())('reports the code of $rule: $name', (row) => rows.expectParity(row));
});
