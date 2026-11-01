import { describe, expect, it } from 'vitest';
import type { DrawingReport } from '../../src/drawing/index.js';
import type { OperationRun } from '../../src/edit/index.js';
import type { Finding } from '../../src/model/index.js';
import type { ScoredProblems } from '../../src/scoring/index.js';
import { IdRenames } from '../../src/write/IdRenames.js';
import { type WriteOutcomeParts, WriteOutcome } from '../../src/write/WriteOutcome.js';
import { ChangeSet, ScoreChange } from '../support/ModelValues.js';

const noScore = { counts: {}, score: 0, problems: [] } as unknown as ScoredProblems;

const partsWith = (build: (changes: ChangeSet) => void, fields: Partial<WriteOutcomeParts> = {}): WriteOutcomeParts => {
  const changes = new ChangeSet();
  build(changes);
  return {
    input: '<before/>',
    xml: '<after/>',
    run: { changes, model: [], drawing: [], aliases: {} } as OperationRun,
    drawing: { warnings: [], format: [], notes: [] } as unknown as DrawingReport,
    renames: new IdRenames(changes),
    checks: [],
    host: { added: [], blocking: [], preexisting: [] },
    score: new ScoreChange(noScore, noScore),
    ...fields,
  };
};

const warningAt = (element: string): Finding => ({ code: 'W_DEAD_END', message: 'no way on', severity: 'warning', element });

describe('WriteOutcome', () => {
  it('keeps the findings at touched elements and counts the rest in the state', () => {
    const checks = [warningAt('new'), warningAt('old'), { code: 'E_NO_HOST', message: 'loose', severity: 'error', element: 'old' } as Finding];

    const { findings, state } = new WriteOutcome(partsWith((changes) => changes.create({ id: 'new', kind: 'task' }), { checks })).result();

    expect(findings).toEqual([warningAt('new')]);
    expect(state).toEqual({ errors: 1, warnings: 2 });
  });

  it('lists an operation warning once when a check says the same', () => {
    const operationWarning = { code: 'W_DEAD_END', message: 'said by the operation', element: 'new' };
    const parts = partsWith((changes) => changes.create({ id: 'new', kind: 'task' }).warn(operationWarning), { checks: [warningAt('new')] });

    expect(new WriteOutcome(parts).result().findings).toEqual([warningAt('new')]);
  });

  it('tells event gateway targets apart when it matches operation warnings', () => {
    const toFirst = { code: 'W_EVENT_GATEWAY_TARGET', message: 'first', element: 'gateway', related: ['first'] };
    const toSecond = { code: 'W_EVENT_GATEWAY_TARGET', message: 'second', element: 'gateway', related: ['second'] };
    const parts = partsWith((changes) => changes.change({ id: 'gateway', kind: 'eventBasedGateway' }).warn(toSecond), { checks: [toFirst] });

    expect(new WriteOutcome(parts).result().findings).toEqual([toSecond, toFirst]);
  });

  it('adds the host findings the change added, the warnings of the layout and its notes', () => {
    const added = [{ code: 'gate/new', message: 'new', validator: 'gate', severity: 'warning' as const }];
    const drawing = { warnings: [{ code: 'DI_NOT_CREATED', elementId: 'flow', message: 'no shape', relatedElementIds: [] }], format: [], notes: ['placed'] } as unknown as DrawingReport;

    const { findings, notes } = new WriteOutcome(partsWith((changes) => changes.note('appended'), { drawing, host: { added, blocking: [], preexisting: [] } })).result();

    expect(findings.map(({ code }) => code)).toEqual(['gate/new', 'W_LAYOUT_DI_NOT_CREATED']);
    expect(notes).toEqual(['appended', 'placed']);
  });

  it('is unchanged when the new text is the old one', () => {
    expect(new WriteOutcome(partsWith(() => undefined, { xml: '<before/>' })).result().unchanged).toBe(true);
  });
});
