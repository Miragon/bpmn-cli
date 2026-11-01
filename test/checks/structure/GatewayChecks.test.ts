import { describe, it } from 'vitest';
import { StructureChecks } from '../../../src/checks/structure/StructureChecks.js';
import { EngineRows } from '../../support/EngineRows.js';

describe('GatewayChecks', () => {
  const rows = new EngineRows('GatewayChecks', (document) => new StructureChecks(document));

  it.each(rows.structure())('reports what main reports on: $name', (row) => rows.expectStructure(row));
});
