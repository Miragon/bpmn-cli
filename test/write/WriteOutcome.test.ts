import { describe, expect, it } from 'vitest';
import type { DrawingReport } from '../../src/drawing/index.js';
import type { OperationRun } from '../../src/edit/index.js';
import type { Finding } from '../../src/model/index.js';
import type { LayoutProblem } from '../../src/scoring/index.js';
import { IdRenames } from '../../src/write/IdRenames.js';
import { type WriteOutcomeParts, WriteOutcome } from '../../src/write/WriteOutcome.js';
import { ChangeSet, ScoreChange } from '../support/ModelValues.js';

const scored = (problems: LayoutProblem[]) => ({ counts: {}, score: 0, problems }) as unknown as ConstructorParameters<typeof ScoreChange>[1];
const noScore = scored([]);
const missing = (id: string): LayoutProblem => ({ kind: 'missing', ids: [id] });

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
    addedErrors: [],
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

  it('reports an error the write added at an element it did not touch', () => {
    const added = { code: 'E_EVENT_SUBPROCESS_NO_START', message: 'no start', severity: 'error', element: 'old' } as Finding;

    const { findings } = new WriteOutcome(partsWith((changes) => changes.create({ id: 'new', kind: 'task' }), { checks: [warningAt('old'), added], addedErrors: [added] })).result();

    expect(findings).toEqual([added]);
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

  it('warns of an element the write left undrawn, but not of one that was undrawn before', () => {
    const score = new ScoreChange(scored([missing('old')]), scored([missing('old'), missing('new')]));

    const { findings } = new WriteOutcome(partsWith(() => undefined, { score })).result();

    expect(findings).toEqual([{ code: 'W_LAYOUT_DI_NOT_CREATED', element: 'new', message: 'No DI created for new (the write left it undrawn)', severity: 'warning' }]);
  });

  it('keeps the reason of the layout when it warned of the same undrawn element', () => {
    const drawing = { warnings: [{ code: 'DI_NOT_CREATED', elementId: 'flow', message: 'No DI created for flow (an end has no shape)' }], format: [], notes: [] } as unknown as DrawingReport;
    const score = new ScoreChange(scored([]), scored([missing('flow')]));

    const { findings } = new WriteOutcome(partsWith(() => undefined, { drawing, score })).result();

    expect(findings.map(({ message }) => message)).toEqual(['No DI created for flow (an end has no shape)']);
  });

  it('is unchanged when the new text is the old one', () => {
    expect(new WriteOutcome(partsWith(() => undefined, { xml: '<before/>' })).result().unchanged).toBe(true);
  });
});
