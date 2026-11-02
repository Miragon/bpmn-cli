import { describe, expect, it } from 'vitest';
import { RowCloser, type RowGap } from '../../../../src/drawing/incremental/space/RowCloser.js';
import { PlaneEdge } from '../../../../src/drawing/plane/PlaneEdge.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('RowCloser', () => {
  async function planeOf(path = 'models/incremental/boundary.bpmn') {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function closing(plane: Plane, gap: Partial<RowGap> = {}) {
    return new RowCloser(plane).close({ box: new Box(400, 80, 100, 80), frame: undefined, from: 340, to: 560, gap: 60, ignore: new Set(['F2', 'F3']), ...gap });
  }

  function emptied(plane: Plane): void {
    plane.shapes.delete('C');
    plane.edges.delete('F2');
    plane.edges.delete('F3');
  }

  it('pulls the rest of the row back over the gap of a removed shape', async () => {
    const plane = await planeOf();
    emptied(plane);
    const result = closing(plane);

    expect(result?.moved.has('D')).toBe(true);
    expect(plane.shapes.get('D')!.bounds.x).toBe(400);
  });

  it('does nothing without a shape behind the gap', async () => {
    const plane = await planeOf();
    emptied(plane);
    plane.shapes.delete('D');
    plane.shapes.delete('E');
    plane.edges.delete('F4');

    expect(closing(plane)).toBeUndefined();
  });

  it('keeps the row when the strip itself cannot close', async () => {
    const plane = await planeOf();

    expect(closing(plane, { ignore: new Set() })).toBeUndefined();
    expect(plane.shapes.get('C')!.bounds.x).toBe(400);
  });

  it('undoes the close when a shape would land on a shape of another row', async () => {
    const plane = await planeOf();
    emptied(plane);
    plane.shapes.get('E2')!.bounds.translate(150, -60);
    plane.shapes.get('E2')!.label = undefined;
    plane.shapes.get('D')!.bounds.height = 100;
    plane.edges.delete('F5');
    const result = closing(plane);

    expect(result).toBeUndefined();
    expect(plane.shapes.get('D')!.bounds.x).toBe(560);
  });

  it('undoes the close when a shape would leave a group', async () => {
    const plane = await planeOf('models/incremental/groups.bpmn');
    plane.shapes.delete('A');
    plane.edges.delete('F1');
    plane.edges.delete('F2');
    const end = plane.shapes.get('E1')!;
    end.bounds.x = 720;
    const result = new RowCloser(plane).close({ box: new Box(260, 100, 100, 80), frame: undefined, from: 188, to: 730, gap: 60, ignore: new Set() });

    expect(result).toBeUndefined();
    expect(end.bounds.x).toBe(720);
  });

  it('undoes the close when a line ties the moved shape to one that stays behind', async () => {
    const plane = await planeOf();
    emptied(plane);
    const tie = new PlaneEdge('tie', plane.edges.get('F1')!.el, 'sequenceFlow', [new Point(610, 160), new Point(610, 232)]);
    tie.sourceId = 'D';
    tie.targetId = 'E2';
    plane.edges.set('tie', tie);
    plane.shapes.get('E2')!.bounds.x = 620;

    expect(closing(plane)).toBeUndefined();
  });

  it('undoes the close when an association would tear', async () => {
    const plane = await planeOf();
    emptied(plane);
    const note = new PlaneEdge('note', plane.edges.get('F1')!.el, 'association', [new Point(610, 160), new Point(610, 232)]);
    note.sourceId = 'D';
    note.targetId = 'A';
    plane.edges.set('note', note);

    expect(closing(plane)).toBeUndefined();
  });

  it('undoes the close when a moved sub-process would cover a shape', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    plane.shapes.delete('S');
    plane.edges.clear();
    const stayer = plane.shapes.get('T')!;
    stayer.bounds = new Box(100, 305, 100, 80);
    const sub = plane.shapes.get('SP')!;
    const result = new RowCloser(plane).close({ box: new Box(160, 100, 60, 190), frame: undefined, from: 100, to: 235, gap: 40, ignore: new Set() });

    expect(result).toBeUndefined();
    expect(sub.bounds.x).toBe(240);
  });

  it('stays inside its frame', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    const frame = plane.shapes.get('Pool')!;
    plane.shapes.delete('A');
    plane.edges.delete('F1');
    plane.edges.delete('F2');
    const result = new RowCloser(plane).close({ box: new Box(260, 120, 100, 80), frame, from: 200, to: 420, gap: 60, ignore: new Set() });

    expect(result?.moved.has('C')).toBe(true);
    expect(plane.shapes.get('C')!.bounds.x).toBeLessThan(420);
  });
});
