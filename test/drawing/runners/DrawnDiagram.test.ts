import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { DocumentWriter } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DrawnDiagram', () => {
  async function drawn(path: string): Promise<DrawnDiagram> {
    return new DrawnDiagram(await Fixtures.read(path));
  }

  it('finds a drawn shape and its plane', async () => {
    const diagram = await drawn('models/incremental/boundary.bpmn');

    expect(diagram.drawnShape('A').shape.kind).toBe('task');
  });

  it('refuses with E_NO_DIAGRAM on a file without diagram', async () => {
    const diagram = await drawn('drawing/idless.bpmn');

    expect(() => diagram.drawnShape('start')).toThrow(expect.objectContaining({ code: 'E_NO_DIAGRAM' }));
    expect(() => diagram.drawnEdge('nothing')).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND' }));
  });

  it('refuses a connection as a shape and an undrawn element', async () => {
    const connection = await drawn('models/incremental/boundary.bpmn');
    const undrawn = await drawn('drawing/empty-diagram.bpmn');

    expect(() => connection.drawnShape('F1')).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
    expect(() => undrawn.drawnShape('undrawn_task')).toThrow(expect.objectContaining({ code: 'E_NO_SHAPE' }));
  });

  it('tells a process to be named by its pool', async () => {
    const pooled = await drawn('models/incremental/pool.bpmn');
    const plain = await drawn('drawing/empty-diagram.bpmn');

    expect(() => pooled.drawnShape('P1')).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: expect.stringContaining('Pool') }) }));
    expect(() => plain.drawnShape('process')).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: expect.stringContaining('name the shapes inside it') }) }));
  });

  it('finds a drawn edge, and draws a new one only when asked', async () => {
    const diagram = await drawn('models/incremental/boundary.bpmn');
    const { plane } = diagram.drawnEdge('F5');
    const line = plane.edges.get('F5')!;
    plane.edges.delete('F5');

    expect(() => diagram.drawnEdge('F5')).toThrow(expect.objectContaining({ code: 'E_NO_SHAPE', details: expect.objectContaining({ hint: expect.stringContaining('bpmn route') }) }));
    expect(diagram.drawnEdge('F5', true).edge).not.toBe(line);
    expect(diagram.drawnEdge('F5').edge.points).toEqual([]);
  });

  it('refuses to draw an edge whose ends share no plane', async () => {
    const diagram = await drawn('models/incremental/boundary.bpmn');
    const [plane] = diagram.planes;
    plane!.edges.delete('F5');
    plane!.shapes.delete('E2');

    expect(() => diagram.drawnEdge('F5', true)).toThrow(expect.objectContaining({ code: 'E_NO_SHAPE' }));
  });

  it('moves no boundary event, pool or lane', async () => {
    const diagram = await drawn('models/incremental/lanesub.bpmn');
    const boundary = await drawn('models/incremental/boundary.bpmn');

    expect(diagram.movableShape('T1').shape.id).toBe('T1');
    expect(() => boundary.movableShape('B')).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND', details: expect.objectContaining({ related: ['A'] }) }));
    expect(() => diagram.movableShape('Pool')).toThrow(/is a pool/);
    expect(() => diagram.movableShape('L1')).toThrow(/is a lane/);
  });

  it('refuses two shapes of different planes', async () => {
    const diagram = await drawn('models/incremental/twoviews.bpmn');
    const [first, second] = diagram.planes;

    expect(() => diagram.samePlane(first!, first!, 'A', 'C')).not.toThrow();
    expect(() => diagram.samePlane(first!, second!, 'A', 'C')).toThrow(expect.objectContaining({ code: 'E_DIFFERENT_DIAGRAM' }));
  });

  it('writes its planes back', async () => {
    const diagram = await drawn('models/incremental/boundary.bpmn');
    diagram.drawnShape('C').shape.bounds.x = 1234;

    diagram.write();

    expect(await new DocumentWriter().plain(diagram.document)).toContain('x="1234"');
  });

  it('words at most three problems, each once', () => {
    const problems = ['a', 'b', 'c', 'd', 'a'].map((id) => ({ kind: 'overlaps' as const, ids: [id] }));

    expect(DrawnDiagram.problemWords(problems)).toBe('overlaps [a], overlaps [b], overlaps [c], ...');
    expect(DrawnDiagram.problemWords(problems.slice(0, 1))).toBe('overlaps [a]');
  });
});
