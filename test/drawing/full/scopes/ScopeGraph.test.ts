import { describe, expect, it } from 'vitest';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('ScopeGraph', () => {
  async function graphOf(path: string) {
    const document = await Fixtures.read(path);
    return new ScopeGraph(document.tree.processes()[0]!, () => {});
  }

  it('keeps boundary events on their host, not among the nodes', async () => {
    const { layout, byId } = await graphOf('layout/artifacts__10-three-boundaries.bpmn');

    expect(layout.nodes.map((node) => node.id)).not.toContain('Event_Reminder');
    expect(byId.get('Event_Reminder')?.host?.id).toBe('Activity_Approve');
  });

  it('puts boundary events on the bottom border until it is full, then on the top border', async () => {
    const { byId } = await graphOf('layout/artifacts__10-three-boundaries.bpmn');

    expect(byId.get('Activity_Approve')?.boundary.filter((event) => event.onTop)).toHaveLength(1);
  });

  it('takes a dangling boundary event for a node of its own', async () => {
    const { layout } = await graphOf('drawing/full/dangling-boundary.bpmn');

    expect(layout.nodes.some((node) => node.el.is('bpmn:BoundaryEvent'))).toBe(true);
  });

  it('links a compensation event and its handler, without a flow', async () => {
    const { layout } = await graphOf('layout/artifacts__09-compensation.bpmn');

    expect(layout.compensations.length).toBeGreaterThan(0);
    expect(layout.compensations[0]?.handler.compensatedBy).toBe(layout.compensations[0]?.event);
  });

  it('keeps an event sub-process out of the nodes', async () => {
    const { layout } = await graphOf('layout/subproc__s07-two-eventsubs.bpmn');

    expect(layout.eventSubs).toHaveLength(2);
    expect(layout.nodes.every((node) => node.kind !== 'eventSubProcess')).toBe(true);
  });
});
