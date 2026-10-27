/**
 * E_NOT_FOUND names what was meant: typos, umlaut spellings, another or no
 * prefix, the ids a running batch created and the flows it renamed, and an
 * alias written without `$`. Elements are addressed by id only. Synthetic
 * fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../../../src/api.js';
import { CliError } from '../../../src/domain/document/CliError.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { runOps } from '../../../src/index.js';

async function invoice(): Promise<string> {
  return (
    await applyToXml((await newXml({ processName: 'Rechnung' })).xml, [
      { op: 'add', kind: 'start', name: 'Rechnung eingegangen' },
      { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'Event_RechnungEingegangen' },
      { op: 'add', kind: 'userTask', name: 'Prüfung', after: 'Activity_CheckInvoice' },
      { op: 'add', kind: 'end', name: 'Done', after: 'Activity_Pruefung' },
    ])
  ).xml;
}

async function notFound(xml: string, ops: unknown): Promise<CliError> {
  try {
    await applyToXml(xml, ops);
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected E_NOT_FOUND');
}

describe('E_NOT_FOUND candidates', () => {
  it('typos, another or no prefix, umlaut spellings: the meant id first', async () => {
    const doc = await Doc.fromXml(await invoice());
    expect(doc.suggest('Activity_ChekInvoice')[0]).toBe('Activity_CheckInvoice');
    expect(doc.suggest('Activity_CheckInvocie')[0]).toBe('Activity_CheckInvoice');
    expect(doc.suggest('Task_CheckInvoice')[0]).toBe('Activity_CheckInvoice');
    expect(doc.suggest('CheckInvoice')[0]).toBe('Activity_CheckInvoice');
    expect(doc.suggest('Task_ChekInvoice')[0]).toBe('Activity_CheckInvoice');
    expect(doc.suggest('Activity_Prüfung')[0]).toBe('Activity_Pruefung');
    expect(doc.suggest('activity_prufung')[0]).toBe('Activity_Pruefung');
    // flows too: their ids name their ends
    expect(doc.suggest('Flow_CheckInvoiceToPrufung')[0]).toBe('Flow_CheckInvoiceToPruefung');
    // a short id is no typo of everything
    expect(doc.suggest('Done')).toEqual(['Event_Done', 'Flow_PruefungToDone']);
    expect(doc.suggest('Xyz')).toEqual([]);
  });

  it('inside a batch: the ids it created come first and are listed in the hint', async () => {
    const failure = await notFound(await invoice(), [
      { op: 'add', kind: 'userTask', name: 'Vollständigkeit prüfen', after: 'Activity_CheckInvoice' },
      { op: 'add', kind: 'serviceTask', name: 'Buchen', after: 'Activity_VollstandigkeitPrufen' },
    ]);
    expect(failure.code).toBe('E_NOT_FOUND');
    expect(failure.details.op).toBe(1);
    expect(failure.details.candidates?.[0]).toBe('Activity_VollstaendigkeitPruefen');
    expect(failure.message).toBe('No element with id "Activity_VollstandigkeitPrufen" (did you mean: Activity_VollstaendigkeitPruefen?)');
    expect(failure.details.hint).toMatch(/^Created earlier in this batch: Activity_VollstaendigkeitPruefen, Flow_VollstaendigkeitPruefenToPruefung; name them with "as": "\$name" to refer to them\./);
  });

  it('a flow an op of the batch renamed: the message says to what', async () => {
    const failure = await notFound(await invoice(), [
      { op: 'add', kind: 'task', name: 'Archive', after: 'Activity_Pruefung' },
      { op: 'set', id: 'Flow_PruefungToDone', values: { name: 'ok' } },
    ]);
    expect(failure.message).toBe('No element with id "Flow_PruefungToDone": an op before this one renamed it to Flow_PruefungToArchive (its id named its old ends)');
    expect(failure.details.candidates?.[0]).toBe('Flow_PruefungToArchive');
  });

  it('an alias written without $ is pointed out', async () => {
    const failure = await notFound(await invoice(), [
      { op: 'add', kind: 'task', name: 'Archive', after: 'Activity_Pruefung', as: '$archive' },
      { op: 'add', kind: 'end', name: 'Archived', after: 'archive' },
    ]);
    expect(failure.details.hint).toMatch(/^In this batch \$archive is an alias: write "\$archive"\./);
  });

  it('a batch that fails at its first op: the plain hint afterwards', async () => {
    const doc = await Doc.fromXml(await invoice());
    let err: CliError | undefined;
    try {
      runOps(doc, [{ op: 'remove', ids: ['Activity_ChekInvoice'] }]);
      doc.require('Activity_Chek');
    } catch (error) {
      err = error as CliError;
    }
    expect(err?.details.candidates?.[0]).toBe('Activity_CheckInvoice');
    expect(err?.details.hint).toBe('Run `bpmn show <file>` or `bpmn find <file> <text>` to list ids.');
  });
});
