import { describe, expect, it } from 'vitest';
import type { ScopeLayout } from '../../../../src/drawing/full/scopes/GNode.js';
import { ScopePlacer } from '../../../../src/drawing/full/scopes/ScopePlacer.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('ScopePlacer', () => {
  async function placed(path: string, expanded?: Set<string>) {
    const document = await Fixtures.read(path);
    const collapsedScopes = new Map<string, ScopeLayout>();
    const layout = new ScopePlacer({ expanded: expanded ?? document.diagram.expandedIds(), collapsedScopes }).layOut(document.tree.processes()[0]!);
    return { layout, collapsedScopes };
  }

  it('lays the happy path out left to right on one line', async () => {
    const { layout } = await placed('layout/gallery__02-parallel.bpmn');
    const [first, ...rest] = layout.nodes.filter((node) => node.row === 0).sort((a, b) => a.layer - b.layer);

    expect(rest.every((node) => node.box.center.y === first!.box.center.y)).toBe(true);
  });

  it('nests an expanded sub-process and keeps a collapsed one for its own plane', async () => {
    const expanded = await placed('layout/subproc__s02-nested3.bpmn');
    const collapsed = await placed('layout/subproc__s02-nested3.bpmn', new Set());

    expect(expanded.layout.nodes.some((node) => node.child)).toBe(true);
    expect(collapsed.collapsedScopes.size).toBeGreaterThan(0);
  });

  it('stacks event sub-processes below everything', async () => {
    const { layout } = await placed('layout/subproc__s07-two-eventsubs.bpmn');
    const lowest = Math.max(...layout.nodes.map((node) => node.box.bottom));

    expect(layout.eventSubs.every((eventSub) => eventSub.box.y > lowest)).toBe(true);
  });
});
