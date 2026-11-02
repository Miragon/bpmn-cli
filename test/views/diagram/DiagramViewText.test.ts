import { describe, expect, it } from 'vitest';
import { DiagramView } from '../../../src/views/diagram/DiagramView.js';
import { DiagramViewText } from '../../../src/views/diagram/DiagramViewText.js';
import { Fixtures } from '../../support/Fixtures.js';

const zero = { crossings: 0 } as ConstructorParameters<typeof DiagramViewText>[0]['counts'];

describe('DiagramViewText', () => {
  it('starts with the score and the counts per kind', async () => {
    const lines = new DiagramView(await Fixtures.read('models/render/gallery.bpmn')).answer().text.split('\n');

    expect(lines[0]).toBe('score 64: crossings 10, through 1, diagonal 2');
    expect(lines[1]).toBe('  crossings  Flow_BookingStartedToCancelled x Flow_EscalatedToEscalationEnd');
    expect(lines).toContain('  through    Flow_TwoDaysToTimedOut, Activity_InnerTask');
  });

  it('says so when there is no layout problem', () => {
    const text = new DiagramViewText({ score: 0, counts: zero, problems: [], rows: [] }).text();

    expect(text).toBe('score 0: no layout problems');
  });

  it('groups intruders per frame and says how many it left out', () => {
    const problems = ['a', 'b', 'c', 'd'].map((id) => ({ kind: 'frameIntrusion' as const, ids: [id, 'Lane_Clerks'] }));

    const text = new DiagramViewText({ score: 40, counts: { ...zero, frameIntrusion: 4 }, problems, rows: [] }).text();

    expect(text.split('\n')[1]).toBe('  frameIntrusion  Lane_Clerks: a, b, +2');
  });

  it('prints a problem detail behind its ids', () => {
    const text = new DiagramViewText({ score: 2, counts: zero, problems: [{ kind: 'laneGap', ids: ['a', 'b'], detail: 'top' }], rows: [] }).text();

    expect(text).toContain('  laneGap  a, b top');
  });

  it('prints the rows and columns of a frame, further rows lined up, a wide gap marked', () => {
    const task = (id: string) => ({ id, kind: 'task' });
    const rows = [
      {
        id: 'Plane',
        root: 'Pool',
        columns: 4,
        gaps: [{ after: 1, width: 300 }],
        frames: [
          { id: 'Pool', kind: 'participant' as const, rows: [], columns: [] },
          { id: 'Lane', kind: 'lane' as const, name: 'Office', parent: 'Pool', rows: [[task('a'), task('b'), task('c')], [task('d')]], columns: [[0, 1, 3], [2]], gaps: [{ row: 0, before: [2] }] },
        ],
      },
    ];

    const lines = new DiagramViewText({ score: 0, counts: zero, problems: [], rows }).text().split('\n');

    expect(lines[1]).toBe('participant Pool  c0..c3; wide gaps: c1|c2 300px');
    expect(lines[2]).toBe('  lane Lane "Office"   row 1: c0 a, c1 b … c3 c');
    expect(lines[3]).toBe(`${' '.repeat(23)}row 2: c2 d`);
  });
});
