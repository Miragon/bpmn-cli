import { BpmnError } from '../../document/BpmnError.js';

export function parseOpsJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new BpmnError('E_USAGE', `Ops are not valid JSON: ${(err as Error).message}`, 'usage');
  }
}
