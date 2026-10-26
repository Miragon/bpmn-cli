import { usageError } from '../../document/utils/errors.js';
import type { CliError } from '../../document/CliError.js';

export interface CommandLocation {
  index: number;
  /** e.g. `ops[2] (split) branches[0].nodes[1]` */
  path: string;
}

export function commandUsageError(location: CommandLocation, message: string, hint?: string, candidates?: string[]): CliError {
  return usageError(`${location.path}: ${message}`, {
    op: location.index,
    ...(hint ? { hint } : {}),
    ...(candidates?.length ? { candidates } : {}),
  });
}
