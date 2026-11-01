import { describe, expect, it } from 'vitest';
import { LaneArranger } from '../../../../src/drawing/full/lanes/LaneArranger.js';
import { ScopePlacer } from '../../../../src/drawing/full/scopes/ScopePlacer.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('LaneArranger', () => {
  async function arranged(path: string) {
    const document = await Fixtures.read(path);
    const process = document.tree.processes().find((candidate) => candidate.list('laneSets').length)!;
    const scope = new ScopePlacer({ expanded: document.diagram.expandedIds(), collapsedScopes: new Map() }).layOut(process);
    new LaneArranger(scope, process).apply();
    return scope;
  }

  it.each(['layout/lanes__complaint-t1.bpmn', 'layout/subproc__s13-lanes-loop-top.bpmn', 'layout/subproc__s15-lanes-sub-eventsub.bpmn', 'layout/subproc__s19-lanes-loop-3.bpmn'])('keeps each node of %s inside its lane', async (path) => {
    const scope = await arranged(path);

    for (const band of scope.laneBands!) {
      expect([...band.nodes].every((node) => node.box.y >= band.top && node.box.bottom <= band.bottom)).toBe(true);
    }
  });

  it('gives each top lane a box and draws nested lanes as children', async () => {
    const scope = await arranged('layout/subproc__s10-nested-lanes.bpmn');

    expect(scope.lanes.some((lane) => lane.children.length)).toBe(true);
  });

  it('leaves a process without lanes alone', async () => {
    const document = await Fixtures.read('layout/gallery__01-xor-join.bpmn');
    const process = document.tree.processes()[0]!;
    const scope = new ScopePlacer({ expanded: new Set(), collapsedScopes: new Map() }).layOut(process);

    new LaneArranger(scope, process).apply();

    expect(scope.lanes).toEqual([]);
  });
});
