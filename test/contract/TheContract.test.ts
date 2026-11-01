import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as contract from '../../src/index.js';
import { applyToXml, BpmnError, diagramXml, findXml, kindsJson, newXml, OPS_SCHEMA, renderXml, showXml, validateXml } from '../../src/index.js';
import { Fixtures } from '../support/Fixtures.js';

const orderCheck = Fixtures.text('edit/order-check.bpmn');

const PUBLISHED_TYPES = ['Change', 'DiagramResult', 'EditOptions', 'EditResult', 'ElementDetailData', 'Finding', 'FindOptions', 'FindResult', 'FormatResult', 'IdConventions', 'ModelViewData', 'NewOptions', 'Operation', 'RenderOptions', 'ShowOptions', 'ShowResult', 'Suggestion', 'SvgImage', 'ValidateOptions', 'ValidationReport', 'Validator', 'ValidatorContext', 'ValidatorFinding'];
const RUNTIME_EXPORTS = ['applyToXml', 'BpmnError', 'diagramXml', 'findXml', 'kindsJson', 'newXml', 'OPS_SCHEMA', 'renderXml', 'showXml', 'validateXml'];

describe('the contract', () => {
  it('exports the 8 functions, OPS_SCHEMA and BpmnError, and nothing else', () => {
    expect(Object.keys(contract).sort()).toEqual(['BpmnError', 'OPS_SCHEMA', 'applyToXml', 'diagramXml', 'findXml', 'kindsJson', 'newXml', 'renderXml', 'showXml', 'validateXml']);
  });

  it('publishes the types of the contract and no others', () => {
    const report = readFileSync(new URL('../../api-report/bpmn-cli.api.md', import.meta.url), 'utf8');
    const published = [...report.matchAll(/^export (?:declare )?(?:abstract )?(?:class|const|function|interface|type) (\w+)/gm)].map(([, name]) => name);

    expect([...new Set(published)].sort()).toEqual([...RUNTIME_EXPORTS, ...PUBLISHED_TYPES].sort());
  });

  it('answers a write in plain data', async () => {
    const { score } = await applyToXml(orderCheck, [{ op: 'set', id: 'check', set: { name: 'Check' } }]);

    expect(Object.getPrototypeOf(score)).toBe(Object.prototype);
  });

  it('writes through applyToXml', async () => {
    expect((await applyToXml(orderCheck, [{ op: 'set', id: 'check', set: { name: 'Check' } }])).changed[0]?.id).toBe('check');
  });

  it('answers show, find and diagram from the text', async () => {
    expect((await showXml(orderCheck, { id: 'check' })).view.kind).toBe('element');
    expect((await findXml(orderCheck, { text: 'check' })).total).toBeGreaterThan(0);
    expect((await diagramXml(Fixtures.text('models/incremental/orders.bpmn'))).score).toBeGreaterThanOrEqual(0);
  });

  it('paints an image and checks a file', async () => {
    expect((await renderXml(orderCheck)).svg).toContain('<svg');
    expect((await validateXml(orderCheck)).ok).toBe(true);
  });

  it('starts a file newXml can hand to applyToXml', async () => {
    const { created } = await applyToXml(await newXml({ id: 'Process_1' }), [{ op: 'add', kind: 'startEvent', name: 'Go' }]);

    expect(created[0]?.id).toBe('startEvent_go');
  });

  it('lists kinds without a file', () => {
    expect(kindsJson().kinds.length).toBeGreaterThan(20);
    expect(kindsJson({ conventions: { prefixes: { 'bpmn:Task': 'T_' } } }).kinds[0]?.pattern).toContain('T_');
  });

  it('holds the 8 drawing operations in OPS_SCHEMA', () => {
    expect(((OPS_SCHEMA['$defs'] as Record<string, { oneOf?: unknown[] }>)['drawingOp']?.oneOf ?? []).length).toBe(8);
  });

  it('refuses with a BpmnError of a known category', async () => {
    const failure = await showXml('<not-bpmn/>').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BpmnError);
    expect((failure as BpmnError).category).toBe('io');
  });
});
