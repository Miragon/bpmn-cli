import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { applyToXml } from '../../src/index.js';
import { ModdleParser } from '../../src/model/index.js';
import { Fixtures } from '../support/Fixtures.js';

const MAX_PARSES = 2;
const MAX_SERIALISATIONS = 3;

const MODDLE = Object.getPrototypeOf(ModdleParser.moddle());

const DRAWN = Fixtures.text('models/incremental/orders.bpmn');

describe('the cost of one write', () => {
  let parses: MockInstance;
  let serialisations: MockInstance;

  beforeEach(() => {
    parses = vi.spyOn(MODDLE, 'fromXML');
    serialisations = vi.spyOn(MODDLE, 'toXML');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['one add', [{ op: 'add', kind: 'task', name: 'Audit', after: 'Task_A' }]],
    ['one rename', [{ op: 'set', id: 'Task_A', set: { name: 'Audit' } }]],
    ['one drawing operation', [{ op: 'tidy' }]],
    ['one full layout', [{ op: 'layout' }]],
  ])('%s stays within the bound', async (_name, operations) => {
    await applyToXml(DRAWN, operations);

    expect(parses.mock.calls.length).toBeLessThanOrEqual(MAX_PARSES);
    expect(serialisations.mock.calls.length).toBeLessThanOrEqual(MAX_SERIALISATIONS);
  });

  it('parses a third time only when the new file has an error, wherever it sits, to tell it from an old one', async () => {
    await applyToXml(Fixtures.text('edit/events-gateway.bpmn'), [{ op: 'set', id: 'loose_task', set: { name: 'Renamed' } }]);

    expect(parses).toHaveBeenCalledTimes(MAX_PARSES + 1);
  });

  it('checks a file without errors once, whole, and never reads the old one again', async () => {
    await applyToXml(DRAWN, [{ op: 'set', id: 'Task_A', set: { name: 'Audit' } }]);

    expect(parses).toHaveBeenCalledTimes(MAX_PARSES);
  });

  it('parses the old file a second time only to tell a new error from an old one, and refuses before it serialises the new one', async () => {
    await applyToXml(DRAWN, [{ op: 'add', kind: 'eventSubProcess', name: 'Handle', in: 'Proc_A' }]).catch(() => undefined);

    expect(parses).toHaveBeenCalledTimes(2);
    expect(serialisations).toHaveBeenCalledTimes(1);
  });
});
