import { CliError } from '../CliError.js';

/** The JSON of `bpmn apply` and applyToXml, before parseOps checks it. */
export function parseOpsJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CliError('E_USAGE', `Ops are not valid JSON: ${(err as Error).message}`, 'usage');
  }
}
