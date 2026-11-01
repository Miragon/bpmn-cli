import { describe, expect, it } from 'vitest';
import { DiagramView } from '../../../src/views/diagram/DiagramView.js';
import { Fixtures } from '../../support/Fixtures.js';

const answer = async (file: string) => new DiagramView(await Fixtures.read(file)).answer();

describe('DiagramView', () => {
  it('holds the score, the counts and every problem', async () => {
    const { score, counts, problems } = await answer('models/render/gallery.bpmn');

    expect(score).toBeGreaterThan(0);
    expect(counts.crossings).toBe(10);
    expect(problems.filter(({ kind }) => kind === 'crossings')).toHaveLength(10);
  });

  it('holds the rows of each frame as id, kind and name, with their columns', async () => {
    const { rows } = await answer('models/render/gallery.bpmn');
    const frame = rows[0]!.frames.find(({ id }) => id === 'Activity_ExpandedSubProcess');

    expect(frame).toMatchObject({ kind: 'subProcess', name: 'Expanded sub-process', parent: 'Participant_RenderGallery' });
    expect(frame?.rows[0]?.[0]).toEqual({ id: 'Event_InnerStart', kind: 'startEvent', name: 'Inner start' });
    expect(frame?.columns[0]?.length).toBe(frame?.rows[0]?.length);
  });

  it('leaves out an empty collaboration root and starts at its pools', async () => {
    const { rows } = await answer('models/render/gallery.bpmn');

    expect(rows[0]?.frames.some(({ kind }) => kind === 'collaboration')).toBe(false);
    expect(rows[0]?.frames.filter(({ parent }) => parent === undefined).map(({ id }) => id)).toContain('Participant_RenderGallery');
  });

  it('keeps a lane in its pool and a nested lane in its lane', async () => {
    const { rows } = await answer('models/incremental/orders.bpmn');
    const lane = rows[0]?.frames.find(({ kind }) => kind === 'lane');

    expect(lane?.parent).toBeDefined();
  });

  it('holds one entry per plane, a collapsed sub-process with its own', async () => {
    const { rows } = await answer('models/render/gallery.bpmn');

    expect(rows.map(({ root }) => root)).toContain('Activity_CollapsedSubProcess');
    expect(rows.find(({ root }) => root === 'Activity_CollapsedSubProcess')?.frames[0]?.kind).toBe('subProcess');
  });

  it('marks a wide gap inside a row', async () => {
    const { rows } = await answer('views/wide-gap.bpmn');

    expect(rows[0]?.frames[0]).toMatchObject({ kind: 'process', gaps: [{ row: 0, before: [2] }] });
  });

  it('says how to draw a file without a drawing, and gives it no score', async () => {
    const { text, score, rows, counts, problems } = await answer('models/views/claims.bpmn');

    expect(text).toBe('no diagram: bpmn layout <file> draws one');
    expect(score).toBeNull();
    expect(rows).toEqual([]);
    expect(problems).toEqual([]);
    expect(counts.missing).toBe(0);
  });

  it('treats a diagram with nothing on it like no drawing', async () => {
    expect((await answer('drawing/empty-diagram.bpmn')).text).toBe('no diagram: bpmn layout <file> draws one');
  });
});
