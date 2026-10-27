import { LABEL_LINE, labelSize } from '../../utils/text.js';
import { boxesOverlap } from '../../utils/geom.js';
import type { Box, GArtifact, GNode, ScopeLayout } from '../../di/types.js';
import { bottom } from '../../utils/geom.js';
import { nameOf } from '../../utils/names.js';
import { boundaryLeft, isEvent } from '../../utils/nodes.js';

export interface LabelOptions {
  /** a message flow docks at the bottom */
  above?: boolean;
}

/**
 * The external labels the engine draws for a scope's nodes, flows and data,
 * relative to the scope origin.
 */
export class ScopeLabels {
  constructor(private readonly layout: ScopeLayout) {}

  all(): Box[] {
    const out = this.shapes();
    for (const edge of this.layout.edges) if (edge.label) out.push(edge.label);
    return out;
  }

  shapes(): Box[] {
    return this.ownShapes().map(([box]) => box);
  }

  /** a boundary event's node is its host */
  ownShapes(): Array<[Box, GNode]> {
    const out: Array<[Box, GNode]> = [];
    for (const node of this.layout.nodes) {
      const kind = node.child || node.kind === 'subProcess' || node.kind === 'eventSubProcess' ? undefined : node.kind === 'gateway' ? 'gateway' : isEvent(node) ? 'event' : undefined;
      const label = kind ? ScopeLabels.of(node, kind) : undefined;
      if (label) out.push([label, node]);
      for (const boundaryEvent of node.boundary) {
        const bl = ScopeLabels.of(boundaryEvent, 'boundary');
        if (bl) out.push([bl, node]);
      }
    }
    return out;
  }

  /**
   * Two data objects of one task stand closer than their labels are wide, so a clashing label
   * takes the first free spot below its shape that LabelDeclutter would try.
   */
  data(): Box[] {
    return this.placedData().map(([box]) => box);
  }

  placedData(): Array<[Box, GArtifact]> {
    const out: Array<[Box, GArtifact]> = [];
    for (const artifact of this.layout.artifacts) {
      const label = artifact.kind === 'annotation' ? undefined : ScopeLabels.of(artifact, 'data');
      if (!label) continue;
      const spots = [...[0, -0.6, 0.6, -1.2, 1.2].map((dx) => ({ ...label, x: Math.round(label.x + dx * label.width) })), ...[1, 2, 3].map((step) => ({ ...label, y: label.y + step * (label.height + 4) }))];
      out.push([spots.find((spot) => !out.some(([placed]) => boxesOverlap(placed, spot, 2))) ?? label, artifact]);
    }
    return out;
  }

  /**
   * A boundary event's label hangs beside the event below its host (above it on the top border);
   * a second event's goes left, more step outwards. Matches the incremental layout's placement.
   * The top border's events run right to left, as do the bottom border's except on a collapsed
   * sub-process.
   */
  static of(element: { box: Box; el: GNode['el']; host?: GNode; topUsed?: boolean; onTop?: boolean; labelLeft?: boolean } | GArtifact, kind: 'event' | 'gateway' | 'boundary' | 'data', opts: LabelOptions = {}): Box | undefined {
    const name = nameOf(element);
    if (!name) return undefined;
    const box = element.box;
    const cx = box.x + box.width / 2;
    switch (kind) {
      case 'gateway': {
        if ('topUsed' in element && element.topUsed) {
          /**
           * bpmn-js centres the text and wraps it at 90 px, so a short line can be wider than the
           * estimated box; the label goes upper left, clear of the flow leaving through the top.
           */
          const { width, height } = labelSize(name, 80);
          const drawn = Math.max(width, Math.min(90, name.length * 6));
          return { x: Math.round(cx - 8 - drawn / 2 - width / 2), y: box.y - height - 2, width, height };
        }
        const { width, height } = labelSize(name);
        return { x: Math.round(cx - width / 2), y: box.y - height - 6, width, height };
      }
      case 'boundary': {
        const { width, height } = labelSize(name);
        const host = 'host' in element ? element.host : undefined;
        const top = !!host && 'onTop' in element && !!element.onTop;
        const siblings = (host?.boundary ?? []).filter((sibling) => !!sibling.onTop === top);
        if (top) {
          const rightward = siblings.filter((sibling) => sibling.box.x > box.x).length;
          const labelY = host.box.y - 2 - height;
          if ((siblings.length === 2 && rightward === 1) || ('labelLeft' in element && element.labelLeft)) return { x: box.x - 4 - width, y: labelY, width, height };
          return { x: box.x + box.width + 4, y: labelY - (siblings.length >= 3 ? rightward * (LABEL_LINE + 2) : 0), width, height };
        }
        const position = Math.max(0, siblings.findIndex((sibling) => sibling.box === box));
        const hostBottom = host ? bottom(host.box) : box.y + box.height / 2;
        const order = host && boundaryLeft(host) ? siblings.length - 1 - position : position;
        if (siblings.length === 2 && order === 1) return { x: box.x - 4 - width, y: hostBottom + 2, width, height };
        const stagger = siblings.length >= 3 ? order * (LABEL_LINE + 2) : 0;
        return { x: box.x + box.width + 4, y: hostBottom + 2 + stagger, width, height };
      }
      default: {
        const { width, height } = labelSize(name);
        if (opts.above) return { x: Math.round(cx - width / 2), y: box.y - height - 6, width, height };
        return { x: Math.round(cx - width / 2), y: box.y + box.height + 6, width, height };
      }
    }
  }
}
