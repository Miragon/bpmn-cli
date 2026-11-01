import { describe, expect, it } from 'vitest';
import { Plane } from '../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { TrialGuard } from '../../../src/drawing/plane/TrialGuard.js';
import { ElementHomes } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('TrialGuard', () => {
  async function guarded(policy = TrialGuard.NO_WORSE): Promise<{ planes: Plane[]; guard: TrialGuard }> {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const planes = new PlaneReader(document.tree.definitions).planes();
    return { planes, guard: new TrialGuard(planes, new ElementHomes(document), policy) };
  }

  it('keeps a move that changes nothing', async () => {
    const { guard } = await guarded();

    expect(guard.judge()).toMatchObject({ ok: true, added: [] });
    expect(guard.rejected).toEqual([]);
  });

  it('refuses a move that adds a hard defect and says what it would add', async () => {
    const { planes, guard } = await guarded();
    const [plane] = planes;
    const task = plane!.shapes.get('C')!;
    task.bounds = plane!.shapes.get('D')!.bounds.copy();

    const verdict = guard.judge();

    expect(verdict.ok).toBe(false);
    expect(verdict.added.map(({ kind }) => kind)).toContain('overlaps');
    expect(verdict.addedKeys.length).toBeGreaterThan(0);
    expect(verdict.after).toBeGreaterThan(verdict.before);
    expect(guard.rejected.length).toBeGreaterThan(0);
  });

  it('refuses a soft worsening by the score alone', async () => {
    const { planes, guard } = await guarded({ ...TrialGuard.NO_WORSE, key: () => undefined });
    const [plane] = planes;
    plane!.shapes.get('C')!.bounds = plane!.shapes.get('D')!.bounds.copy();

    expect(guard.judge()).toMatchObject({ ok: false, added: [] });
    expect(guard.rejected.length).toBeGreaterThan(0);
  });

  it('asks for a lower score under a lowering policy, and keeps the new base', async () => {
    const { guard } = await guarded({ ...TrialGuard.NO_WORSE, lower: true });
    const { score } = guard;

    expect(guard.judge().ok).toBe(false);
    expect(guard.score).toBe(score);
  });

  it('counts anew after a kept trial under a rebasing policy', async () => {
    const { planes, guard } = await guarded({ key: ({ kind }) => kind, lower: false, rebase: true });
    planes[0]!.shapes.get('C')!.bounds.translate(1, 0);

    guard.judge();

    expect(guard.judge().added).toEqual([]);
  });
});
