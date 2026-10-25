import { CliError } from '../../../shared/CliError.js';

export function parseOpsJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CliError('E_USAGE', `Ops are not valid JSON: ${(err as Error).message}`, 'usage');
  }
}
