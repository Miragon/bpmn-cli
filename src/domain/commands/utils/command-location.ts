import { usageError } from '../../document/utils/errors.js';
import type { BpmnError } from '../../document/BpmnError.js';

export interface CommandLocation {
  index: number;
  /** e.g. `ops[2] (split) branches[0].nodes[1]` */
  path: string;
}

export function commandUsageError(location: CommandLocation, message: string, hint?: string, candidates?: string[]): BpmnError {
  return usageError(`${location.path}: ${message}`, {
    op: location.index,
    ...(hint ? { hint } : {}),
    ...(candidates?.length ? { candidates } : {}),
  });
}
