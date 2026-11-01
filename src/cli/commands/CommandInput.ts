import type { Operation } from '../../api/index.js';
import { BpmnFile } from '../files/BpmnFile.js';

export interface SharedFlags {
  o?: string | undefined;
  dryRun?: boolean | undefined;
  force?: boolean | undefined;
  json?: boolean | undefined;
}

export class CommandInput {
  readonly output: string | undefined;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly json: boolean;

  constructor(
    readonly path: string,
    readonly operation: Operation,
    flags: SharedFlags,
  ) {
    this.output = flags.o;
    this.dryRun = flags.dryRun ?? false;
    this.force = flags.force ?? false;
    this.json = flags.json ?? false;
  }

  get toStandardOutput(): boolean {
    return this.output === BpmnFile.STANDARD_STREAM || (this.path === BpmnFile.STANDARD_STREAM && this.output === undefined);
  }

  get target(): string {
    return this.toStandardOutput ? BpmnFile.STANDARD_STREAM : (this.output ?? this.path);
  }
}
