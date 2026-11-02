import type { Box } from '../../../model/index.js';
import { GNode, type GArtifact, type GEdge, type ScopeLayout } from '../scopes/GNode.js';
import { ChannelRouter } from '../routing/ChannelRouter.js';
import { Scope } from '../scopes/Scope.js';
import { ScopeLabels } from '../scopes/ScopeLabels.js';
import { XIndex } from '../scopes/XIndex.js';

export type Columns = Map<GNode, Array<GNode | undefined>>;

type OwnedBox = [Box, GNode | undefined];

export class TakenColumns {
  constructor(private readonly layout: ScopeLayout) {}

  private static ownerOf(artifact: GArtifact): GNode | undefined {
    return artifact.anchorNode?.host ?? artifact.anchorNode;
  }

  of(over?: ReadonlySet<GEdge>): Columns {
    const taken: Columns = new Map();
    const entries = (node: GNode): GEdge[] => (over ? node.risesInto().filter((edge) => !over.has(edge)) : node.risesInto());
    const rising = this.layout.nodes.filter((node) => entries(node).length);
    if (!rising.length) {
      return taken;
    }
    const index = this.boxIndex();
    const keep = GNode.RISE_KEEP;
    for (const riser of rising) {
      const riseX = riser.riseX();
      const top = riser.box.bottom;
      const low = Math.max(...entries(riser).map(ChannelRouter.riseFrom));
      const beside = index.near(riseX - keep, riseX + keep).filter(([box, owner]) => owner !== riser && box.x - keep < riseX && riseX < box.right + keep && box.y < low && top < box.bottom);
      if (beside.length) {
        taken.set(riser, beside.map(([, owner]) => owner));
      }
    }
    return taken;
  }

  private boxIndex(): XIndex<OwnedBox> {
    const { layout } = this;
    const index = new XIndex<OwnedBox>();
    const add = (box: Box, owner: GNode | undefined): void => index.add([box, owner], box.x, box.right);
    for (const node of layout.nodes) {
      add(node.box, node);
      for (const event of node.boundary) {
        add(event.box, node);
      }
    }
    for (const artifact of new Scope(layout).routedArtifacts()) {
      add(artifact.box, TakenColumns.ownerOf(artifact));
    }
    const labels = new ScopeLabels(layout);
    for (const [box, node] of labels.ownShapes()) {
      add(box, node);
    }
    for (const [box, artifact] of labels.placedData()) {
      add(box, TakenColumns.ownerOf(artifact));
    }
    return index;
  }
}
