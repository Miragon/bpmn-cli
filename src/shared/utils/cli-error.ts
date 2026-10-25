import { CliError } from '../CliError.js';
import { ModelError } from '../../model/ModelError.js';

/** A ModelError as the CliError the pipeline throws (`E_<code>`); anything else as it is. */
export function toCliError(err: unknown): unknown {
  if (err instanceof ModelError) {
    const category = err.code.startsWith('LAYOUT') ? 'layout' : err.code === 'PARSE_ERROR' ? 'io' : 'model';
    return new CliError(err.code.startsWith('LAYOUT') ? `E_${err.code}` : `E_${err.code}`, err.message, category, err.details);
  }
  return err;
}
