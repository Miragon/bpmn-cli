import type { BpmnElement } from '../document/BpmnElement.js';
import { DiIdStyle, type DiStyles } from './DiIdStyle.js';

export class DiIds {
  private readonly styles: DiStyles;
  private readonly taken: Set<string>;

  constructor(definitions: BpmnElement) {
    this.styles = DiIdStyle.stylesOf(definitions);
    this.taken = DiIdStyle.allIds(definitions);
  }

  shape(id: string): string {
    return DiIdStyle.claimUnique(this.taken, DiIdStyle.styledId(this.styles.shape ?? 'suffix', 'Shape', id));
  }

  edge(id: string): string {
    return DiIdStyle.claimUnique(this.taken, DiIdStyle.styledId(this.styles.edge ?? 'suffix', 'Edge', id));
  }

  plane(id: string): string {
    return DiIdStyle.claimUnique(this.taken, DiIdStyle.rootDiId('Plane', id));
  }

  diagram(id: string): string {
    return DiIdStyle.claimUnique(this.taken, DiIdStyle.rootDiId('Diagram', id));
  }
}
