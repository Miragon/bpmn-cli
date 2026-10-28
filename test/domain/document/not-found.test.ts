/**
 * E_NOT_FOUND names what was meant: typos, umlaut spellings, another or no
 * prefix, the ids a running batch created and the flows it renamed, and an
 * alias written without `$`. Elements are addressed by id only. Synthetic
 * fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../../../src/api.js';
import { BpmnError } from '../../../src/domain/document/BpmnError.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { runOps } from '../../../src/index.js';

async function invoice(): Promise<string> {
  return (
    await applyToXml((await newXml({ processName: 'Rechnung' })).xml, [
      { op: 'add', kind: 'start', name: 'Rechnung eingegangen' },
      { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'startEvent_rechnungEingegangen' },
      { op: 'add', kind: 'userTask', name: 'Prüfung', after: 'userTask_checkInvoice' },
      { op: 'add', kind: 'end', name: 'Done', after: 'userTask_pruefung' },
    ])
  ).xml;
}

async function notFound(xml: string, ops: unknown): Promise<BpmnError> {
  try {
    await applyToXml(xml, ops);
  } catch (err) {
    if (err instanceof BpmnError) return err;
    throw err;
  }
  throw new Error('expected E_NOT_FOUND');
}

describe('E_NOT_FOUND candidates', () => {
  it('typos, another or no prefix, umlaut spellings: the meant id first', async () => {
    const doc = await Doc.fromXml(await invoice());
    expect(doc.suggest('userTask_chekInvoice')[0]).toBe('userTask_checkInvoice');
    expect(doc.suggest('userTask_checkInvocie')[0]).toBe('userTask_checkInvoice');
    expect(doc.suggest('task_checkInvoice')[0]).toBe('userTask_checkInvoice');
    expect(doc.suggest('checkInvoice')[0]).toBe('userTask_checkInvoice');
    expect(doc.suggest('task_chekInvoice')[0]).toBe('userTask_checkInvoice');
    expect(doc.suggest('userTask_prüfung')[0]).toBe('userTask_pruefung');
    expect(doc.suggest('usertask_prufung')[0]).toBe('userTask_pruefung');
    // flows too: their ids name their ends
    expect(doc.suggest('flow_checkInvoiceToPrufung')[0]).toBe('flow_checkInvoiceToPruefung');
    // a short id is no typo of everything
    expect(doc.suggest('Done')).toEqual(['endEvent_done', 'flow_pruefungToDone']);
    expect(doc.suggest('Xyz')).toEqual([]);
  });

  it('inside a batch: the ids it created come first and are listed in the hint', async () => {
    const failure = await notFound(await invoice(), [
      { op: 'add', kind: 'userTask', name: 'Vollständigkeit prüfen', after: 'userTask_checkInvoice' },
      { op: 'add', kind: 'serviceTask', name: 'Buchen', after: 'userTask_vollstandigkeitPrufen' },
    ]);
    expect(failure.code).toBe('E_NOT_FOUND');
    expect(failure.details.op).toBe(1);
    expect(failure.details.candidates?.[0]).toBe('userTask_vollstaendigkeitPruefen');
    expect(failure.message).toBe('No element with id "userTask_vollstandigkeitPrufen" (did you mean: userTask_vollstaendigkeitPruefen?)');
    expect(failure.details.hint).toMatch(/^Created earlier in this batch: userTask_vollstaendigkeitPruefen, flow_vollstaendigkeitPruefenToPruefung; name them with "as": "\$name" to refer to them\./);
  });

  it('a flow an op of the batch renamed: the message says to what', async () => {
    const failure = await notFound(await invoice(), [
      { op: 'add', kind: 'task', name: 'Archive', after: 'userTask_pruefung' },
      { op: 'set', id: 'flow_pruefungToDone', values: { name: 'ok' } },
    ]);
    expect(failure.message).toBe('No element with id "flow_pruefungToDone": an op before this one renamed it to flow_pruefungToArchive (its id named its old ends)');
    expect(failure.details.candidates?.[0]).toBe('flow_pruefungToArchive');
  });

  it('an alias written without $ is pointed out', async () => {
    const failure = await notFound(await invoice(), [
      { op: 'add', kind: 'task', name: 'Archive', after: 'userTask_pruefung', as: '$archive' },
      { op: 'add', kind: 'end', name: 'Archived', after: 'archive' },
    ]);
    expect(failure.details.hint).toMatch(/^In this batch \$archive is an alias: write "\$archive"\./);
  });

  it('a batch that fails at its first op: the plain hint afterwards', async () => {
    const doc = await Doc.fromXml(await invoice());
    let err: BpmnError | undefined;
    try {
      runOps(doc, [{ op: 'remove', ids: ['userTask_chekInvoice'] }]);
      doc.require('userTask_chek');
    } catch (error) {
      err = error as BpmnError;
    }
    expect(err?.details.candidates?.[0]).toBe('userTask_checkInvoice');
    expect(err?.details.hint).toBe('Run `bpmn show <file>` or `bpmn find <file> <text>` to list ids.');
  });
});
