import { describe, expect, it } from 'vitest';
import { ShowQuery } from '../../src/views/ShowQuery.js';
import { Fixtures } from '../support/Fixtures.js';

const claims = () => Fixtures.read('models/views/claims.bpmn');

describe('ShowQuery', () => {
  it('answers with the outline, and ends like a write with the state line', async () => {
    const { text, view, state } = new ShowQuery(await claims()).answer();

    expect(view.kind).toBe('model');
    expect(state).toEqual({ errors: 0, warnings: 1 });
    expect(text.split('\n').at(-1)).toBe("state: 0 errors, 1 warning (bpmn validate lists them and runs the project's lint)");
    expect(text).not.toContain('problems');
  });

  it('answers with one element for an id, the state line included', async () => {
    const { text, view } = new ShowQuery(await claims(), { id: 'Activity_Pay' }).answer();

    expect(view.kind).toBe('element');
    expect(text.split('\n')[0]).toBe('serviceTask Activity_Pay "Pay claim"');
    expect(text).toContain('state: 0 errors, 1 warning');
  });

  it('keeps the shape of the outline for a neighbourhood, one step by default', async () => {
    const { view } = new ShowQuery(await claims(), { around: 'Activity_Pay' }).answer();

    expect(view).toMatchObject({ kind: 'model', cut: { depth: 1, nodes: { shown: 3, total: 16 } } });
  });

  it('keeps the shape of the outline for a cut to a lane', async () => {
    const { view } = new ShowQuery(await claims(), { in: 'Lane_Fraud' }).answer();

    expect(view).toMatchObject({ kind: 'model', cut: { in: { id: 'Lane_Fraud', kind: 'lane', name: 'Fraud team' } } });
  });

  it('counts a broken reference as an error in the state', async () => {
    const { state, text } = new ShowQuery(await Fixtures.read('views/long-outline.bpmn')).answer();

    expect(state.errors).toBeGreaterThan(0);
    expect(text).toContain('state: ');
  });

  it.each([
    [{ id: 'Activity_Pay', around: 'Activity_Pay' }, 'drop the element id'],
    [{ in: 'Process_Claims', around: 'Activity_Pay' }, 'drop --in'],
    [{ id: 'Activity_Pay', in: 'Process_Claims' }, 'drop --in'],
    [{ depth: 2 }, 'only with --around'],
  ])('refuses options that do not go together: %j', async (options, message) => {
    const query = new ShowQuery(await claims(), options);

    expect(() => query.answer()).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(message) }));
  });
});
