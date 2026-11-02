import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as contract from '../../src/index.js';
import { designIqCalls, onRebuild, recordedFacts, recordedSchema, schemaFacts } from '../../tools/oracle/design-iq-map.mjs';
import { differencesOfCall } from '../../tools/oracle/probes/edits.mjs';

const ALLOWED_DIFFERENCES: Array<{ probe: string; pattern: string }> = JSON.parse(readFileSync('tools/oracle/differences.json', 'utf8'));
const allowed = ALLOWED_DIFFERENCES.filter(({ probe }) => probe === 'edits').map(({ pattern }) => new RegExp(pattern));

describe("design-iq's recorded calls", () => {
  it.each(designIqCalls())('$id answers as main did, along the map', async ({ id, call }) => {
    const differences = differencesOfCall(id, recordedFacts(call), await onRebuild(contract, call));

    expect(differences.filter((difference: string) => !allowed.some((pattern) => pattern.test(difference)))).toEqual([]);
  });

  it('finds in OPS_SCHEMA each operation design-iq reads, with its properties and required keys, but the align that goes', () => {
    const { operations, drawing } = schemaFacts(contract.OPS_SCHEMA);
    const recorded = recordedSchema();

    expect(operations).toEqual(expect.arrayContaining(recorded.operations.filter((name: string) => name !== 'align')));
    expect(drawing.sort()).toEqual([...recorded.drawing.filter((name: string) => name !== 'align'), 'layout'].sort());
  });
});
