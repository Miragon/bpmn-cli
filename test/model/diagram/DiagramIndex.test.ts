import { describe, expect, it } from 'vitest';
import { DiagramIndex } from '../../../src/model/diagram/DiagramIndex.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DiagramIndex', () => {
  it('has no plane when the file draws nothing', async () => {
    const undrawn = await Fixtures.read('model/c8-vendor.bpmn');

    expect(undrawn.diagram.planes()).toEqual([]);
  });

  it('lists the plane of every diagram and lays out the process, or the collaboration when there is one', async () => {
    const twoViews = await Fixtures.read('models/incremental/twoviews.bpmn');
    const pool = await Fixtures.read('models/incremental/pool.bpmn');

    expect(twoViews.diagram.planes().map((plane) => plane.id)).toEqual(['PL1', 'V2_PL1']);
    expect(twoViews.diagram.layoutRoot()?.id).toBe('P1');
    expect(pool.diagram.layoutRoot()?.id).toBe('C1');
  });

  it('shows the display root as the first process or collaboration of the definitions', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(DiagramIndex.displayRoot(document.tree.definitions)?.id).toBe('Process_events');
    expect(DiagramIndex.displayRoot(undefined)).toBeUndefined();
  });

  it('recognises a sub-process, an ad-hoc sub-process and nothing else', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const verdicts = ['sub_events', 'sub_adhoc', 'task_review'].map((id) => DiagramIndex.isSubProcess(document.tree.require(id)));

    expect(verdicts).toEqual([true, true, false]);
    expect(DiagramIndex.isSubProcess(undefined)).toBe(false);
  });

  it('reads a box from bounds, and none from a shape without bounds or with a coordinate that is no number', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const nobounds = await Fixtures.read('models/incremental/nobounds.bpmn');
    const nan = await Fixtures.read('models/incremental/nan.bpmn');
    const boundsOf = (source: typeof document, shapeId: string) => source.tree.definitions.list('diagrams').flatMap((diagram) => diagram.get<typeof document.tree.definitions>('plane').list('planeElement')).find((shape) => shape.id === shapeId)?.peek<typeof document.tree.definitions>('bounds');

    expect(DiagramIndex.boxOf(boundsOf(document, 'task_review_di'))).toMatchObject({ x: 200, y: 100, width: 100, height: 80 });
    expect(DiagramIndex.boxOf(boundsOf(nobounds, 'C_di'))).toBeUndefined();
    expect(DiagramIndex.boxOf(boundsOf(nan, 'C_di'))).toBeUndefined();
    expect(DiagramIndex.boxOf(undefined)).toBeUndefined();
  });

  it('records a sub-process as collapsed only when its shape says isExpanded false', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(document.diagram.expansionState()).toEqual(new Map([['sub_adhoc', false]]));
  });

  it('keeps every sub-process expanded unless the diagram or the request collapses it, and ignores an unknown id', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(document.diagram.expandedIds()).toEqual(new Set(['sub_events']));
    expect(document.diagram.expandedIds({ expand: ['sub_adhoc', 'task_review'] })).toEqual(new Set(['sub_events', 'sub_adhoc']));
    expect(document.diagram.expandedIds({ collapse: ['sub_events', 'sub_adhoc'] })).toEqual(new Set());
  });
});
