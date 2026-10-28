import { BpmnError } from '../BpmnError.js';
import { ModelError } from '../ModelError.js';

/** A ModelError as the BpmnError the pipeline throws (`E_<code>`); anything else as it is. */
export function toBpmnError(err: unknown): unknown {
  if (err instanceof ModelError) {
    const category = err.code.startsWith('LAYOUT') ? 'layout' : err.code === 'PARSE_ERROR' ? 'io' : 'model';
    return new BpmnError(`E_${err.code}`, err.message, category, err.details);
  }
  return err;
}
