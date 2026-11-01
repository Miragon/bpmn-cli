import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box } from '../../../model/index.js';
import { GArtifact } from './GArtifact.js';
import type { GNode } from './GNode.js';
import type { ScopeLayout } from './ScopeLayout.js';

export type LabelKind = 'event' | 'gateway' | 'boundary' | 'data';

export interface LabelOptions {
  above?: boolean;
}

export class ScopeLabels {
  private static readonly GATEWAY_LABEL_WRAP = 80;
  private static readonly DATA_SPOTS = [0, -0.6, 0.6, -1.2, 1.2];
  private static readonly DATA_ROWS = [1, 2, 3];

  constructor(private readonly layout: ScopeLayout) {}

  static of(element: GNode | GArtifact, kind: LabelKind, options: LabelOptions = {}): Box | undefined {
    const { name } = element;
    if (!name) {
      return undefined;
    }
    if (element instanceof GArtifact) {
      return ScopeLabels.centred(name, element.box, options);
    }
    if (kind === 'gateway') {
      return ScopeLabels.ofGateway(element, name);
    }
    return kind === 'boundary' ? ScopeLabels.ofBoundary(element, name) : ScopeLabels.centred(name, element.box, options);
  }

  private static centred(name: string, box: Box, { above }: LabelOptions): Box {
    const { width, height } = TextMetrics.labelSize(name);
    const y = above ? box.y - height - 6 : box.y + box.height + 6;
    return new Box(Math.round(box.center.x - width / 2), y, width, height);
  }

  private static ofGateway(node: GNode, name: string): Box {
    const { box } = node;
    const centerX = box.center.x;
    if (node.topUsed) {
      const { width, height } = TextMetrics.labelSize(name, ScopeLabels.GATEWAY_LABEL_WRAP);
      const drawn = Math.max(width, Math.min(90, name.length * 6));
      return new Box(Math.round(centerX - 8 - drawn / 2 - width / 2), box.y - height - 2, width, height);
    }
    const { width, height } = TextMetrics.labelSize(name);
    return new Box(Math.round(centerX - width / 2), box.y - height - 6, width, height);
  }

  private static ofBoundary(event: GNode, name: string): Box {
    const { width, height } = TextMetrics.labelSize(name);
    const { host, box } = event;
    const top = !!host && !!event.onTop;
    const siblings = (host?.boundary ?? []).filter((sibling) => !!sibling.onTop === top);
    if (host && top) {
      return ScopeLabels.onTopBorder(event, host, siblings, width, height);
    }
    const position = Math.max(0, siblings.findIndex((sibling) => sibling.box === box));
    const hostBottom = host ? host.box.bottom : box.y + box.height / 2;
    const order = host?.keepsBoundaryLeft ? siblings.length - 1 - position : position;
    if (siblings.length === 2 && order === 1) {
      return new Box(box.x - 4 - width, hostBottom + 2, width, height);
    }
    const stagger = siblings.length >= 3 ? order * (TextMetrics.LABEL_LINE + 2) : 0;
    return new Box(box.right + 4, hostBottom + 2 + stagger, width, height);
  }

  private static onTopBorder({ box, labelLeft }: GNode, host: GNode, siblings: readonly GNode[], width: number, height: number): Box {
    const rightward = siblings.filter((sibling) => sibling.box.x > box.x).length;
    const labelY = host.box.y - 2 - height;
    if ((siblings.length === 2 && rightward === 1) || labelLeft) {
      return new Box(box.x - 4 - width, labelY, width, height);
    }
    return new Box(box.right + 4, labelY - (siblings.length >= 3 ? rightward * (TextMetrics.LABEL_LINE + 2) : 0), width, height);
  }

  private static kindOf(node: GNode): LabelKind | undefined {
    if (node.child || node.kind === 'subProcess' || node.kind === 'eventSubProcess') {
      return undefined;
    }
    if (node.kind === 'gateway') {
      return 'gateway';
    }
    return node.isEvent ? 'event' : undefined;
  }

  private static spotsOf(label: Box): Box[] {
    const beside = ScopeLabels.DATA_SPOTS.map((offset) => new Box(Math.round(label.x + offset * label.width), label.y, label.width, label.height));
    const below = ScopeLabels.DATA_ROWS.map((step) => new Box(label.x, label.y + step * (label.height + 4), label.width, label.height));
    return [...beside, ...below];
  }

  all(): Box[] {
    return [...this.shapes(), ...this.layout.edges.flatMap((edge) => edge.label ?? [])];
  }

  shapes(): Box[] {
    return this.ownShapes().map(([box]) => box);
  }

  ownShapes(): Array<[Box, GNode]> {
    const found: Array<[Box, GNode]> = [];
    for (const node of this.layout.nodes) {
      const kind = ScopeLabels.kindOf(node);
      const label = kind && ScopeLabels.of(node, kind);
      if (label) {
        found.push([label, node]);
      }
      for (const boundaryEvent of node.boundary) {
        const boundaryLabel = ScopeLabels.of(boundaryEvent, 'boundary');
        if (boundaryLabel) {
          found.push([boundaryLabel, node]);
        }
      }
    }
    return found;
  }

  data(): Box[] {
    return this.placedData().map(([box]) => box);
  }

  placedData(): Array<[Box, GArtifact]> {
    const placed: Array<[Box, GArtifact]> = [];
    for (const artifact of this.layout.artifacts) {
      const label = artifact.kind === 'annotation' ? undefined : ScopeLabels.of(artifact, 'data');
      if (label) {
        const free = ScopeLabels.spotsOf(label).find((spot) => !placed.some(([taken]) => taken.overlaps(spot, 2)));
        placed.push([free ?? label, artifact]);
      }
    }
    return placed;
  }
}
