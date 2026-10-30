/**
 * A crossing with the dotted line of a text annotation is no layout problem, so only another
 * annotation line is routed around it (src/domain/diagram/utils/annotations.ts, EdgeRouter.ts
 * `routeEdge` with the router's `freeLines`):
 *  - a flow is routed as if the annotation line were not there, while a compensation association
 *    or a flow in the same place still makes it take the other way round
 *  - an annotation line routed round a shape keeps off every line, an annotation line too
 */
import { describe, expect, it } from 'vitest';
import type { DEdge, DShape, Plane } from '../../../../../src/domain/diagram/di/types.js';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import { Drawing } from '../../../../../src/domain/diagram/layout/incremental/Drawing.js';
import type { El } from '../../../../../src/domain/document/utils/moddle.js';

const els = Doc.create({ processId: 'P' });
const el = (type: string, id: string, props: Record<string, unknown> = {}): El => els.moddle.create(type, { id, ...props });

function sh(id: string, kind: DShape['kind'], element: El, [x, y, width, height]: [number, number, number, number]): DShape {
  return { id, el: element, kind, container: false, bounds: { x, y, width, height } };
}

type Line = 'annotation' | 'compensation' | 'flow';

/**
 * F from A to B goes down and right by default (D keeps a straight association off); the line L
 * from X to C crosses its way down. `routed`: F as a sequence flow or as the line of the
 * annotation A; `line`: L as an annotation's line, a compensation association or a sequence flow.
 */
function setup(routed: 'flow' | 'annotation', line: Line): { plane: Plane; edge: DEdge } {
  const a = el(routed === 'annotation' ? 'bpmn:TextAnnotation' : 'bpmn:Task', 'A');
  const [b, c, d] = ['B', 'C', 'D'].map((id) => el('bpmn:Task', id));
  const x = line === 'annotation' ? el('bpmn:TextAnnotation', 'X') : line === 'compensation' ? el('bpmn:BoundaryEvent', 'X') : el('bpmn:Task', 'X');
  const shapes = [
    sh('A', routed === 'annotation' ? 'annotation' : 'task', a, [100, 100, 100, 80]),
    sh('B', 'task', b!, [400, 300, 100, 80]),
    sh('C', 'task', c!, [220, 230, 60, 40]),
    sh('D', 'task', d!, [300, 200, 60, 60]),
    sh('X', line === 'annotation' ? 'annotation' : 'task', x, [0, 250, 80, 30]),
  ];
  const edge: DEdge = { id: 'F', el: el(routed === 'flow' ? 'bpmn:SequenceFlow' : 'bpmn:Association', 'F', { sourceRef: a, targetRef: b }), kind: routed === 'flow' ? 'sequenceFlow' : 'association', sourceId: 'A', targetId: 'B', points: [] };
  const crossed: DEdge = {
    id: 'L',
    el: el(line === 'flow' ? 'bpmn:SequenceFlow' : 'bpmn:Association', 'L', { sourceRef: x, targetRef: c }),
    kind: line === 'flow' ? 'sequenceFlow' : 'association',
    sourceId: 'X',
    targetId: 'C',
    points: [
      { x: 80, y: 265 },
      { x: 220, y: 250 },
    ],
  };
  const plane: Plane = { id: 'p', rootId: 'r', root: el('bpmn:Process', 'r'), shapes: new Map(shapes.map((shape) => [shape.id, shape])), edges: new Map([edge, crossed].map((one) => [one.id, one])), dropped: [] };
  return { plane, edge };
}

const route = ({ plane, edge }: { plane: Plane; edge: DEdge }) => new Drawing(plane).route(edge, { lines: new Drawing(plane).routingLines(edge.id) });
const DOWN = [
  { x: 150, y: 180 },
  { x: 150, y: 340 },
  { x: 400, y: 340 },
];
const ROUND = [
  { x: 200, y: 140 },
  { x: 450, y: 140 },
  { x: 450, y: 300 },
];

describe('only an annotation line gives way to an annotation line', () => {
  it('a flow keeps its way down across the annotation line', () => {
    expect(route(setup('flow', 'annotation'))).toEqual(DOWN);
  });

  it.each(['compensation', 'flow'] as const)('a flow goes right and down round a %s line in the same place', (line) => {
    expect(route(setup('flow', line))).toEqual(ROUND);
  });

  it.each(['annotation', 'compensation', 'flow'] as const)('an annotation line goes right and down round a %s line', (line) => {
    expect(route(setup('annotation', line))).toEqual(ROUND);
  });
});
