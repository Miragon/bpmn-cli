import { describe, expect, it } from 'vitest';
import { AliasTable } from '../../../src/edit/session/AliasTable.js';
import { Fixtures } from '../../support/Fixtures.js';

const OPERATION = { op: 'remove', ids: ['$check'] } as const;

async function tableWithCheck() {
  const document = await Fixtures.readForWrite('edit/order-check.bpmn');
  const table = new AliasTable(document);
  table.define('$check', document.tree.require('check'), 0);
  return { document, table };
}

describe('AliasTable', () => {
  it('answers the current id of the task an alias names', async () => {
    const { document, table } = await tableWithCheck();

    document.tree.require('check').set('id', 'check_renamed');
    document.tree.invalidate();

    expect(table.idOf('$check', 1, OPERATION, 'ids[0]')).toBe('check_renamed');
    expect(table.toRecord()).toEqual({ $check: 'check_renamed' });
  });

  it('follows the task a retype replaced', async () => {
    const { document, table } = await tableWithCheck();

    table.rebind(document.tree.require('check'), document.tree.require('ship'));

    expect(table.idOf('$check', 1, OPERATION, 'ids[0]')).toBe('ship');
  });

  it('refuses an alias twice with the op that defined it', async () => {
    const { document, table } = await tableWithCheck();

    expect(() => table.define('$check', document.tree.require('ship'), 2)).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_ALIAS', message: expect.stringContaining('ops[0]') }));
  });

  it('refuses an alias without the dollar', async () => {
    const { document, table } = await tableWithCheck();

    expect(() => table.define('check', document.tree.require('ship'), 2)).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
  });

  it('refuses an alias nobody defined and lists the defined ones', async () => {
    const { table } = await tableWithCheck();

    expect(() => table.idOf('$other', 1, OPERATION, 'ids[0]')).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_ALIAS', message: expect.stringContaining('$check (ops[0])') }));
  });

  it('refuses an alias of a task an earlier op removed and leaves it out of the record', async () => {
    const { document, table } = await tableWithCheck();

    document.tree.require('Process_orderCheck').remove('flowElements', document.tree.require('check'));
    document.tree.invalidate();

    expect(() => table.idOf('$check', 1, OPERATION, 'ids[0]')).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND' }));
    expect(table.toRecord()).toEqual({});
  });
});
