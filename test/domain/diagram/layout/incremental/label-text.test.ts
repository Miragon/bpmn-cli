/**
 * A label spot must keep the text bpmn-js draws off lines, not only the wrapped label box
 * (src/domain/diagram/layout/incremental/LabelPlacer.ts): a short name is drawn on one line up to
 * 90 px wide, centred on the box, so it reaches a line a few px beside the narrower box.
 *  - a spot clear for box and text first, also shifted as far as the text needs; a line 1 px
 *    inside the box (allowed for the box) is on the text
 *  - only when no spot keeps the text clear, the first one clear for the box
 *  - a line crossing the owner's own connection does not push the text aside: the crossing repair
 *    routes it again, and then along the side the label dodged to; an annotation line does, as its
 *    crossing is no problem the repair would remove
 *  - flow labels alike
 */
import { describe, expect, it } from 'vitest';
import type { DEdge, DShape, Plane } from '../../../../../src/domain/diagram/di/types.js';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import { Drawing } from '../../../../../src/domain/diagram/layout/incremental/Drawing.js';
import { glyph } from '../../../../../src/domain/diagram/utils/harness.js';
import { segmentHits, type Box } from '../../../../../src/domain/diagram/utils/geom.js';

const els = Doc.create({ processId: 'P' });
const TYPES: Partial<Record<DShape['kind'], string>> = { task: 'bpmn:Task', gateway: 'bpmn:ExclusiveGateway', event: 'bpmn:EndEvent' };

const sh = (id: string, kind: DShape['kind'], [left, top, width, height]: [number, number, number, number], name?: string): DShape => ({
  id,
  el: els.moddle.create(TYPES[kind]!, { id, ...(name ? { name } : {}) }),
  kind,
  container: false,
  bounds: { x: left, y: top, width, height },
});
const ed = (id: string, pts: Array<[number, number]>, name?: string, ends?: [string, string]): DEdge => ({
  id,
  el: els.moddle.create('bpmn:SequenceFlow', { id, ...(name ? { name } : {}) }),
  kind: 'sequenceFlow',
  ...(ends ? { sourceId: ends[0], targetId: ends[1] } : {}),
  points: pts.map(([left, top]) => ({ x: left, y: top })),
});
const plane = (shapes: DShape[], edges: DEdge[]): Plane => ({
  id: 'p',
  rootId: 'P',
  root: els.moddle.create('bpmn:Process', { id: 'P' }),
  shapes: new Map(shapes.map((shape) => [shape.id, shape])),
  edges: new Map(edges.map((edge) => [edge.id, edge])),
  dropped: [],
});
/** The lines that run over the text bpmn-js draws for `name` in `box` (what labelOnLine counts). */
const linesOverText = (testPlane: Plane, box: Box, name: string): string[] =>
  [...testPlane.edges.values()].filter((edge) => edge.points.slice(1).some((end, index) => segmentHits(edge.points[index]!, end, glyph(box, name), 0))).map((edge) => edge.id);

describe('label spots keep the drawn text off lines', () => {
  it('puts a gateway label beside its own branch going up, as far as the one-line text needs', () => {
    // A -> G -> B on the row, "no" leaves G's top vertex up to N; a task right below G
    const testPlane = plane(
      [sh('A', 'task', [150, 160, 100, 80]), sh('G', 'gateway', [300, 175, 50, 50], 'Bench approved?'), sh('B', 'task', [420, 160, 100, 80]), sh('N', 'task', [420, 20, 100, 80]), sh('D', 'task', [255, 240, 120, 80])],
      [ed('F1', [[250, 200], [300, 200]]), ed('F2', [[350, 200], [420, 200]]), ed('No', [[325, 175], [325, 60], [420, 60]], 'no')],
    );
    const box = new Drawing(testPlane).placeShapeLabel(testPlane.shapes.get('G')!)!;
    // the wrapped box would be clear 6 px right of the line already; the 90 px text is not
    expect(box).toEqual({ x: 339, y: 141, width: 75, height: 28 });
    expect(linesOverText(testPlane, box, 'Bench approved?')).toEqual([]);
  });

  it('takes a spot clear for the box when no spot keeps the text clear', () => {
    // lines 6 px left and right of the centred box below the event reach the text on every spot
    const testPlane = plane([sh('E', 'event', [300, 200, 36, 36], 'Order rejected')], [ed('L', [[278, 0], [278, 500]]), ed('R', [[358, 0], [358, 500]])]);
    const box = new Drawing(testPlane).placeShapeLabel(testPlane.shapes.get('E')!)!;
    expect(box).toEqual({ x: 284, y: 242, width: 68, height: 28 });
    expect(linesOverText(testPlane, box, 'Order rejected')).toEqual(['L', 'R']);
  });

  it('puts a flow label where a crossing line misses its text', () => {
    // a line crosses F 4 px before the first spot near the start
    const testPlane = plane([], [ed('F', [[200, 200], [500, 200]], 'Order rejected'), ed('V', [[204, 56], [204, 400]])]);
    const box = new Drawing(testPlane).placeEdgeLabel(testPlane.edges.get('F')!)!;
    expect(box).toEqual({ x: 316, y: 168, width: 68, height: 28 });
    expect(linesOverText(testPlane, box, 'Order rejected')).toEqual([]);
  });

  it('skips a flow label spot whose text a line touches 1 px inside the box', () => {
    // H runs 1 px inside the bottom of the first spot above F
    const testPlane = plane([], [ed('F', [[200, 200], [500, 200]], 're-check'), ed('H', [[150, 195], [260, 195]])]);
    const box = new Drawing(testPlane).placeEdgeLabel(testPlane.edges.get('F')!)!;
    expect(box).toEqual({ x: 208, y: 204, width: 68, height: 14 });
    expect(linesOverText(testPlane, box, 're-check')).toEqual([]);
  });

  it('keeps an event label below when the line its text would touch crosses the incoming flow', () => {
    // V runs 4 px left of the box below the end event E, through its text; In comes from the left
    const lines = (top: number): DEdge[] => [ed('In', [[200, 218], [300, 218]], undefined, ['X', 'E']), ed('V', [[280, top], [280, 400]], undefined, ['Y', 'Z'])];
    const crossed = plane([sh('E', 'event', [300, 200, 36, 36], 'Order rejected')], lines(100));
    expect(new Drawing(crossed).placeShapeLabel(crossed.shapes.get('E')!)).toEqual({ x: 284, y: 242, width: 68, height: 28 });
    // starting below In, V stays where it is: the label goes above
    const kept = plane([sh('E', 'event', [300, 200, 36, 36], 'Order rejected')], lines(230));
    expect(new Drawing(kept).placeShapeLabel(kept.shapes.get('E')!)).toEqual({ x: 284, y: 166, width: 68, height: 28 });
    // V as the line of a text annotation crossing In stays where it is too: the text keeps off it, right of the event
    const note = els.moddle.create('bpmn:TextAnnotation', { id: 'Y' });
    const [incoming, line] = lines(100);
    const annotated = plane([sh('E', 'event', [300, 200, 36, 36], 'Order rejected')], [incoming!, { ...line!, el: els.moddle.create('bpmn:Association', { id: 'V', sourceRef: note }), kind: 'association' }]);
    const box = new Drawing(annotated).placeShapeLabel(annotated.shapes.get('E')!)!;
    expect(box).toEqual({ x: 342, y: 204, width: 68, height: 28 });
    expect(linesOverText(annotated, box, 'Order rejected')).toEqual([]);
  });
});
