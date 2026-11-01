import { describe, expect, it } from 'vitest';
import { DiagramColumns } from '../../../src/views/diagram/DiagramColumns.js';
import { DiagramView } from '../../../src/views/diagram/DiagramView.js';
import { Fixtures } from '../../support/Fixtures.js';

const columns = async (file: string) => new DiagramColumns(new DiagramView(await Fixtures.read(file)).planes[0]!);

describe('DiagramColumns', () => {
  it('clusters the flow nodes of a plane into columns, left to right', async () => {
    const { of, count, nodes } = await columns('models/render/long.bpmn');

    expect(count).toBeGreaterThan(1);
    expect(nodes.length).toBeGreaterThanOrEqual(count);
    expect([...of.values()].sort((first, second) => first - second)[0]).toBe(0);
  });

  it('leaves boundary events out', async () => {
    const { nodes } = await columns('models/render/gallery.bpmn');

    expect(nodes.some(({ kind }) => kind === 'boundary')).toBe(false);
  });

  it('notes a strip wider than one column', async () => {
    const { gaps, wide } = await columns('views/wide-gap.bpmn');

    expect(wide).toBeGreaterThan(100);
    expect(gaps).toEqual([{ after: 1, width: 600 }]);
  });

  it('counts no column on a plane without flow nodes', async () => {
    const { count, gaps } = await columns('drawing/empty-diagram.bpmn');

    expect(count).toBe(0);
    expect(gaps).toEqual([]);
  });
});
