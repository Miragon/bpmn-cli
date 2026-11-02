import { describe, expect, it } from 'vitest';
import { ArtifactLinks } from '../../../../src/drawing/full/links/ArtifactLinks.js';
import { ScopePlacer } from '../../../../src/drawing/full/scopes/ScopePlacer.js';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('ArtifactLinks', () => {
  async function linked(path: string) {
    const document = await Fixtures.read(path);
    const scope = document.tree.processes()[0]!;
    const graph = new ScopeGraph(scope, () => {});
    new ArtifactLinks(graph.layout).build(scope, graph.byId);
    return graph.layout;
  }

  it('anchors a data object to its node, a note to what it annotates', async () => {
    const data = await linked('layout/artifacts__03-data-objects.bpmn');
    const notes = await linked('layout/artifacts__01-annotations-basic.bpmn');

    expect(data.artifacts.filter((artifact) => artifact.kind !== 'annotation').some((artifact) => artifact.anchorNode)).toBe(true);
    expect(notes.artifacts.every((artifact) => artifact.anchor)).toBe(true);
  });

  it('keeps a link across scopes for when both shapes are drawn', async () => {
    const document = await Fixtures.read('layout/artifacts__04b-data-crossscope.bpmn');
    const scope = new ScopePlacer({ expanded: document.diagram.expandedIds(), collapsedScopes: new Map() }).layOut(document.tree.processes()[0]!);

    expect(scope.nodes.flatMap((node) => node.child?.crossLinks ?? []).length).toBeGreaterThan(0);
  });

  it('gives a note on a flow an end that is a point on the flow', async () => {
    const layout = await linked('layout/artifacts__01-annotations-basic.bpmn');
    const ends = layout.artifacts.flatMap((artifact) => artifact.links).flatMap((link) => [link.from, link.to]);

    expect(ends.some((end) => end.flow)).toBe(true);
  });
});
