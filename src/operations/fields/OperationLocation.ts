import { BpmnError } from '../../model/index.js';
import { RefusalWording, type Wording } from './RefusalWording.js';

export class OperationLocation {
  constructor(
    readonly index: number,
    readonly path: string,
  ) {}

  inside(step: string): OperationLocation {
    return new OperationLocation(this.index, `${this.path}.${step}`);
  }

  refusal(message: Wording, hint?: Wording, candidates: string[] = [], commandCode?: string): BpmnError {
    const wording = new RefusalWording(message, hint);
    const { batchHint } = wording;
    return BpmnError.usage(`${this.path}: ${wording.batchMessage}`, {
      op: this.index,
      ...(batchHint ? { hint: batchHint } : {}),
      ...(candidates.length ? { candidates } : {}),
      asCommand: wording.asCommand(commandCode),
    });
  }
}
