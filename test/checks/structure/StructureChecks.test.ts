import { describe, expect, it } from 'vitest';
import { StructureChecks } from '../../../src/checks/structure/StructureChecks.js';
import { EngineRows } from '../../support/EngineRows.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('StructureChecks', () => {
  const rows = new EngineRows('StructureChecks', (document) => new StructureChecks(document));

  it.each(rows.structure())('reports what main reports on: $name', (row) => rows.expectStructure(row));

  it('marks each finding as an error or a warning', async () => {
    const findings = new StructureChecks(await Fixtures.read('engine/structure/boundary-event-without-a-host.bpmn')).all();

    expect(findings.find(({ code }) => code === 'E_NO_HOST')?.severity).toBe('error');
    expect(findings.find(({ code }) => code === 'W_DEAD_END')?.severity).toBe('warning');
  });

  it('completes the incoming and outgoing lists a file left out', async () => {
    const document = await Fixtures.read('models/roundtrip/listless.bpmn');
    new StructureChecks(document).all();
    const flow = document.tree.processes().flatMap((process) => document.flows.sequenceFlows(process))[0]!;

    expect(document.flows.outgoing(flow.get('sourceRef'))).toContain(flow);
  });
});
