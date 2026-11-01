import type { BpmnDocument } from '../../model/index.js';
import type { DrawingOperation, OrderOperation } from '../../operations/index.js';

export type DrawnOperation = DrawingOperation | OrderOperation;

export interface FormatResult {
  op: DrawnOperation['op'];
  index: number;
  moved: string[];
  rerouted: string[];
  reshaped?: string[];
  colored?: string[];
  labels?: string[];
  notes?: string[];
}

export class DrawingOperationRunner {
  constructor(private readonly document: BpmnDocument) {}

  run(operations: readonly DrawnOperation[], asFile = false): FormatResult[] {
    const drawn = operations.filter((operation) => operation.op !== 'layout');
    if (!drawn.length) {
      return [];
    }
    throw new Error(`DrawingOperationRunner is not ported yet: ${this.document.tree.definitions.type}, ${drawn.length} operations, as file: ${asFile}`);
  }
}
