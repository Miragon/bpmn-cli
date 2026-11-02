import { describe, expect, it } from 'vitest';
import { applyToXml, newXml, validateXml } from '../../src/index.js';
import { Fixtures } from '../support/Fixtures.js';

const shapeOf = (result: object): string[] => Object.keys(result).sort();
const fixture = (name: string): unknown => JSON.parse(Fixtures.text(`contract/${name}.json`));

describe('the results the contract holds', () => {
  it('an edit result has the fields of the contract and answers as its fixture', async () => {
    const { xml: _written, score: _score, ...result } = await applyToXml(Fixtures.text('models/incremental/orders.bpmn'), [{ op: 'add', kind: 'task', name: 'Audit', after: 'Task_A', as: '$audit' }]);

    expect(result).toEqual(fixture('edit-result'));
  });

  it('every edit result carries the same fields', async () => {
    const result = await applyToXml(Fixtures.text('models/incremental/orders.bpmn'), [{ op: 'tidy' }]);

    expect(shapeOf(result)).toEqual(['aliases', 'changed', 'created', 'findings', 'format', 'notes', 'preexisting', 'removed', 'renamed', 'score', 'state', 'unchanged', 'xml']);
    expect(shapeOf(result.score)).toEqual(['added', 'after', 'before', 'resolved']);
  });

  it('a validation report answers as its fixture', async () => {
    const report = await validateXml(Fixtures.text('edit/extensions-zeebe.bpmn'));

    expect({ ...report, findings: report.findings.map(({ code, element, severity }) => ({ code, element, severity })) }).toEqual(fixture('validation-report'));
  });

  it('newXml answers the text of a file', async () => {
    expect(await newXml({ id: 'Process_1', name: 'A' })).toBe(Fixtures.text('contract/new-model.bpmn'));
  });
});
