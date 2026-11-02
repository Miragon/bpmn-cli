import type { BpmnElement } from '../document/BpmnElement.js';
import { DrawingIdStyle, type DrawingIdPatterns } from './DrawingIdStyle.js';

export class DrawingIds {
  private readonly styles: DrawingIdPatterns;
  private readonly taken: Set<string>;

  constructor(definitions: BpmnElement) {
    this.styles = DrawingIdStyle.stylesOf(definitions);
    this.taken = DrawingIdStyle.allIds(definitions);
  }

  shape(id: string): string {
    return DrawingIdStyle.claimUnique(this.taken, DrawingIdStyle.styledId(this.styles.shape ?? 'suffix', 'Shape', id));
  }

  edge(id: string): string {
    return DrawingIdStyle.claimUnique(this.taken, DrawingIdStyle.styledId(this.styles.edge ?? 'suffix', 'Edge', id));
  }

  plane(id: string): string {
    return DrawingIdStyle.claimUnique(this.taken, DrawingIdStyle.rootDrawingId('Plane', id));
  }

  diagram(id: string): string {
    return DrawingIdStyle.claimUnique(this.taken, DrawingIdStyle.rootDrawingId('Diagram', id));
  }
}
