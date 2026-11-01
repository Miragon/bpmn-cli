import { BpmnError } from '../../model/index.js';

export class OperationLocation {
  constructor(
    readonly index: number,
    readonly path: string,
  ) {}

  inside(step: string): OperationLocation {
    return new OperationLocation(this.index, `${this.path}.${step}`);
  }

  refusal(message: string, hint?: string, candidates: string[] = []): BpmnError {
    return BpmnError.usage(`${this.path}: ${message}`, {
      op: this.index,
      ...(hint ? { hint } : {}),
      ...(candidates.length ? { candidates } : {}),
    });
  }
}
