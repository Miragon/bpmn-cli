import { Box, type BpmnElement, type Point } from '../../../model/index.js';
import type { GEdge } from './GEdge.js';
import type { GNode } from './GNode.js';

export interface LinkEnd {
  box: Box;
  flow?: GEdge;
}

export interface ArtifactLink {
  el: BpmnElement;
  id: string;
  from: LinkEnd;
  to: LinkEnd;
  points: Point[];
}

export type GArtifactKind = 'annotation' | 'dataObject' | 'dataStore';

export class GArtifact {
  readonly width: number;
  readonly height: number;
  box: Box;
  anchor?: LinkEnd | undefined;
  anchorNode?: GNode | undefined;
  readonly links: ArtifactLink[] = [];

  constructor(
    readonly el: BpmnElement,
    readonly id: string,
    readonly kind: GArtifactKind,
    size: { width: number; height: number },
  ) {
    this.width = size.width;
    this.height = size.height;
    this.box = new Box(0, 0, size.width, size.height);
  }

  get name(): string | undefined {
    return this.el.name;
  }

  get isRoutedAround(): boolean {
    return this.kind !== 'annotation' || !!this.anchorNode?.host;
  }
}
