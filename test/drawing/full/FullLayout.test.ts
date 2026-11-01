import { afterAll, describe, expect, it } from 'vitest';
import { DrawingSnapshot } from '../../../src/drawing/DrawingSnapshot.js';
import { FullLayout } from '../../../src/drawing/full/FullLayout.js';
import { LayoutRequests, Scorer } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

const { scores } = JSON.parse(Fixtures.text('drawing/full/main-scenario-scores.json')) as { scores: Record<string, number> };

describe('FullLayout', () => {
  const drawnScores = new Map<string, number>();

  async function drawn(path: string, requests = new LayoutRequests()) {
    const document = await Fixtures.read(path);
    const report = new FullLayout(document, requests).draw();
    document.tree.invalidate();
    return { document, report };
  }

  it.each(Object.keys(scores))('draws scenario %s', async (scenario) => {
    const { document } = await drawn(scenario);

    drawnScores.set(scenario, new Scorer().score(document).score);
    expect(DrawingSnapshot.of(document).isEmpty()).toBe(false);
  });

  afterAll(() => {
    const higher = [...drawnScores].filter(([scenario, score]) => score > scores[scenario]!).map(([scenario, score]) => `${scenario}: ${score}, main ${scores[scenario]}`);
    const total = [...drawnScores.values()].reduce((sum, score) => sum + score, 0);
    const mainTotal = Object.values(scores).reduce((sum, score) => sum + score, 0);

    expect(total, `total over ${drawnScores.size} scenarios; higher than main:\n${higher.join('\n')}`).toBeLessThanOrEqual(mainTotal);
  });

  it('keeps a task with three boundary events at the standard size', async () => {
    const { document } = await drawn('layout/artifacts__10-three-boundaries.bpmn');
    const task = document.diagram.planes()[0]!.list('planeElement').find((di) => di.peek('bpmnElement') === Fixtures.element(document, 'Activity_Approve'))!;

    expect(task.peek<{ peek(property: string): number }>('bounds')?.peek('width')).toBe(100);
  });

  it('gives an element without id an id, so the diagram can show it', async () => {
    const { report } = await drawn('drawing/idless.bpmn');

    expect(report.givenIds.length).toBeGreaterThan(0);
  });

  it('draws a sub-process collapsed when asked', async () => {
    const requests = new LayoutRequests();
    requests.expand('Sub', false);
    const { report } = await drawn('models/incremental/sub.bpmn', requests);

    expect(report.expanded).not.toContain('Sub');
  });

  it('says what became of a group around nothing', async () => {
    const { report } = await drawn('drawing/group-around-nothing.bpmn');

    expect(report.notes).toEqual([expect.stringMatching(/^group around_nothing (kept its box|moved below the drawing)/)]);
  });

  it('survives a file without a process', async () => {
    const { report } = await drawn('drawing/full/no-process.bpmn');

    expect(report.warnings).toEqual([]);
  });

  it('hands the incremental layout an engine drawing with pools and sub-processes as blocks', async () => {
    const document = await Fixtures.read('layout/gallery__05-collab.bpmn');
    const engine = await FullLayout.engineDrawing(document, new LayoutRequests());
    const pool = document.tree.collaboration()!.list('participants')[0]!;

    expect(engine.block(pool.id, true)?.shapes.length).toBeGreaterThan(0);
  });
});
