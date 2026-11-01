import type { BpmnDocument, LayoutRequests } from '../../model/index.js';
import type { GivenId } from '../diagram/DrawnElementIds.js';

export interface LayoutWarning {
  code: string;
  elementId: string;
  message: string;
  relatedElementIds: string[];
}

export interface FullLayoutReport {
  warnings: LayoutWarning[];
  expanded: string[];
  givenIds: GivenId[];
  notes: string[];
}

export class FullLayout {
  constructor(
    private readonly document: BpmnDocument,
    private readonly expansions: LayoutRequests,
  ) {}

  draw(): FullLayoutReport {
    throw new Error(`FullLayout is not ported yet: ${this.document.tree.definitions.type}, ${this.expansions.expansion().expand.length} expansions`);
  }
}
