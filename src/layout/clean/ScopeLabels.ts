import { LABEL_LINE, labelSize } from '../../drawing/utils/text.js';
import { boxesOverlap } from '../../drawing/utils/geom.js';
import type { Box, GArtifact, GNode, ScopeLayout } from '../../drawing/types.js';
import { bottom } from './utils/geometry.js';
import { nameOf } from './utils/names.js';
import { boundaryLeft, isEvent } from './utils/nodes.js';

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
    for (const e of this.layout.edges) if (e.label) out.push(e.label);
    return out;
  }

  shapes(): Box[] {
    return this.ownShapes().map(([b]) => b);
  }

  /** a boundary event's node is its host */
  ownShapes(): Array<[Box, GNode]> {
    const out: Array<[Box, GNode]> = [];
    for (const n of this.layout.nodes) {
      const kind = n.child || n.kind === 'subProcess' || n.kind === 'eventSubProcess' ? undefined : n.kind === 'gateway' ? 'gateway' : isEvent(n) ? 'event' : undefined;
      const label = kind ? ScopeLabels.of(n, kind) : undefined;
      if (label) out.push([label, n]);
      for (const b of n.boundary) {
        const bl = ScopeLabels.of(b, 'boundary');
        if (bl) out.push([bl, n]);
      }
    }
    return out;
  }

  /**
   * Two data objects of one task stand closer than their labels are wide, so a clashing label
   * takes the first free spot below its shape that LabelDeclutter would try.
   */
  data(): Box[] {
    return this.placedData().map(([b]) => b);
  }

  placedData(): Array<[Box, GArtifact]> {
    const out: Array<[Box, GArtifact]> = [];
    for (const a of this.layout.artifacts) {
      const label = a.kind === 'annotation' ? undefined : ScopeLabels.of(a, 'data');
      if (!label) continue;
      const spots = [...[0, -0.6, 0.6, -1.2, 1.2].map((dx) => ({ ...label, x: Math.round(label.x + dx * label.width) })), ...[1, 2, 3].map((step) => ({ ...label, y: label.y + step * (label.height + 4) }))];
      out.push([spots.find((b) => !out.some(([o]) => boxesOverlap(o, b, 2))) ?? label, a]);
    }
    return out;
  }

  /**
   * A boundary event's label hangs beside the event below its host (above it on the top border);
   * a second event's goes left, more step outwards. Matches the incremental layout's placement.
   */
  static of(n: { box: Box; el: GNode['el']; host?: GNode; topUsed?: boolean; onTop?: boolean; labelLeft?: boolean } | GArtifact, kind: 'event' | 'gateway' | 'boundary' | 'data', opts: LabelOptions = {}): Box | undefined {
    const name = nameOf(n);
    if (!name) return undefined;
    const b = n.box;
    const cx = b.x + b.width / 2;
    switch (kind) {
      case 'gateway': {
        if ('topUsed' in n && n.topUsed) {
          /**
           * bpmn-js centres the text and wraps it at 90 px, so a short line can be wider than the
           * estimated box; the label goes upper left, clear of the flow leaving through the top.
           */
          const { width, height } = labelSize(name, 80);
          const drawn = Math.max(width, Math.min(90, name.length * 6));
          return { x: Math.round(cx - 8 - drawn / 2 - width / 2), y: b.y - height - 2, width, height };
        }
        const { width, height } = labelSize(name);
        return { x: Math.round(cx - width / 2), y: b.y - height - 6, width, height };
      }
      case 'boundary': {
        const { width, height } = labelSize(name);
        const host = 'host' in n ? n.host : undefined;
        const top = !!host && 'onTop' in n && !!n.onTop;
        const siblings = (host?.boundary ?? []).filter((s) => !!s.onTop === top);
        if (top) {
          // the top border's events run right to left
          const j = siblings.filter((s) => s.box.x > b.x).length;
          const y = host.box.y - 2 - height;
          if ((siblings.length === 2 && j === 1) || ('labelLeft' in n && n.labelLeft)) return { x: b.x - 4 - width, y, width, height };
          return { x: b.x + b.width + 4, y: y - (siblings.length >= 3 ? j * (LABEL_LINE + 2) : 0), width, height };
        }
        const k = Math.max(0, siblings.findIndex((s) => s.box === b));
        const hostBottom = host ? bottom(host.box) : b.y + b.height / 2;
        // a collapsed sub-process has its events left to right
        const i = host && boundaryLeft(host) ? siblings.length - 1 - k : k;
        if (siblings.length === 2 && i === 1) return { x: b.x - 4 - width, y: hostBottom + 2, width, height };
        const stagger = siblings.length >= 3 ? i * (LABEL_LINE + 2) : 0;
        return { x: b.x + b.width + 4, y: hostBottom + 2 + stagger, width, height };
      }
      default: {
        const { width, height } = labelSize(name);
        if (opts.above) return { x: Math.round(cx - width / 2), y: b.y - height - 6, width, height };
        return { x: Math.round(cx - width / 2), y: b.y + b.height + 6, width, height };
      }
    }
  }
}
