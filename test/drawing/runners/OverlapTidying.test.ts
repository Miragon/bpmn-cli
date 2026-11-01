import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { OverlapTidying } from '../../../src/drawing/runners/OverlapTidying.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('OverlapTidying', () => {
  async function drawn(path: string): Promise<DrawnDiagram> {
    return new DrawnDiagram(await Fixtures.read(path));
  }

  const apart = (diagram: DrawnDiagram, first: string, second: string): boolean => !diagram.drawnShape(first).shape.bounds.overlaps(diagram.drawnShape(second).shape.bounds);

  it('takes overlapping shapes apart on every diagram', async () => {
    const diagram = await drawn('drawing/runners/overlaps.bpmn');

    new OverlapTidying(diagram, { op: 'tidy' }, diagram.snapshot(), []).run();

    expect(apart(diagram, 'A', 'B')).toBe(true);
    expect(apart(diagram, 'C', 'D')).toBe(true);
  });

  it('touches only what its ids name', async () => {
    const diagram = await drawn('drawing/runners/overlaps.bpmn');

    new OverlapTidying(diagram, { op: 'tidy', ids: ['C', 'C'] }, diagram.snapshot(), []).run();

    expect(apart(diagram, 'A', 'B')).toBe(false);
    expect(apart(diagram, 'C', 'D')).toBe(true);
  });

  it('leaves a tidy drawing as it is', async () => {
    const diagram = await drawn('drawing/runners/branching.bpmn');
    const before = diagram.snapshot();

    new OverlapTidying(diagram, { op: 'tidy' }, before, []).run();

    expect(before.changedShapes()).toEqual([]);
  });

  it('refuses a file without diagram', async () => {
    const diagram = await drawn('drawing/idless.bpmn');

    expect(() => new OverlapTidying(diagram, { op: 'tidy' }, diagram.snapshot(), []).run()).toThrow(expect.objectContaining({ code: 'E_NO_DIAGRAM' }));
  });
});
