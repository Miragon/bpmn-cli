import { describe, expect, it } from 'vitest';
import type { ProblemKind } from '../../src/scoring/plane/ProblemKinds.js';
import { ProblemLocator } from '../../src/scoring/ProblemLocator.js';
import { Scorer } from '../../src/scoring/Scorer.js';
import { Fixtures } from '../support/Fixtures.js';

const ROWS_FROM_MAIN: [string, ProblemKind, string, number, number][] = [
  ['backward-flow', 'backwardFlow', 'process', 300, 140],
  ['containment', 'frameIntrusion', 'collaboration', 250, 310],
  ['containment', 'outsideLane', 'collaboration', 250, 310],
  ['containment', 'outsidePool', 'collaboration', 1000, 160],
  ['containment', 'outsideSub', 'collaboration', 670, 340],
  ['crossing', 'crossings', 'process', 250, 250],
  ['data-association', 'detachedEdge', 'process', 520, 140],
  ['degenerate-edge', 'degenerateEdge', 'process', 200, 140],
  ['degenerate-edge', 'detachedEdge', 'process', 250, 140],
  ['diagonal', 'diagonal', 'process', 250, 240],
  ['flow-bounds', 'edgeLeavesLane', 'collaboration', 300, 290],
  ['flow-bounds', 'edgeOutside', 'collaboration', 50, 160],
  ['frame-intrusion', 'overlaps', 'process', 225, 195],
  ['frame-overlap', 'frameOverlap', 'collaboration', 350, 275],
  ['in-out', 'inOut', 'process', 275, 140],
  ['join-tail-together', 'segmentOverlap', 'process', 325, 245],
  ['label-clash', 'labelClash', 'process', 150, 167],
  ['label-clash', 'labelClash', 'process', 435, 159.5],
  ['label-on-line', 'labelOnLine', 'process', 258, 140],
  ['label-outside-frame', 'labelOutsideFrame', 'collaboration', 320, 311],
  ['label-title', 'labelOnTitle', 'process', 250, 113],
  ['lane-gap', 'laneGap', 'collaboration', 415, 105],
  ['lane-gap', 'laneGap', 'collaboration', 415, 295],
  ['message-label', 'messageLabelFar', 'collaboration', 430, 327],
  ['message-through-pool', 'msgThroughPool', 'collaboration', 250, 375],
  ['parallel-run', 'parallelRun', 'process', 275, 250],
  ['through', 'through', 'process', 350, 140],
];

describe('ProblemLocator', () => {
  it.each(ROWS_FROM_MAIN)('finds where main puts the badge of %s: %s on %s at %d,%d', async (file, kind, plane, x, y) => {
    const document = await Fixtures.read(`scoring/${file}.bpmn`);

    const located = new ProblemLocator(document).locate(new Scorer().score(document).problems);

    expect(located.filter((problem) => problem.kind === kind).map(({ at }) => at)).toContainEqual({ plane, x, y });
  });

  it('gives no place to a problem no plane shows, and leaves the problem as it was', async () => {
    const document = await Fixtures.read('scoring/missing.bpmn');
    const { problems } = new Scorer().score(document);

    const located = new ProblemLocator(document).locate(problems);

    expect(located).toEqual(problems);
    expect(located[0]).not.toBe(problems[0]);
    expect(located[0]).not.toHaveProperty('at');
  });

  it('gives no place to an import warning, which names no element', async () => {
    const document = await Fixtures.read('scoring/import-warning.bpmn');

    expect(new ProblemLocator(document).locate(new Scorer().score(document).problems)[0]).not.toHaveProperty('at');
  });

  it('shows a plane without an element of its own under the first process', async () => {
    const document = await Fixtures.read('scoring/overlap.bpmn');
    document.diagram.planes()[0]!.set('bpmnElement', undefined);

    const [located] = new ProblemLocator(document).locate(new Scorer().score(document).problems);

    expect(located?.at?.plane).toBe('process');
  });
});
