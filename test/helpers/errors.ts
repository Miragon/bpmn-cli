import { BpmnError } from '../../src/domain/document/BpmnError.js';

/** The code, message and details of what `fn` throws; fails when it throws nothing. */
export function caught(fn: () => unknown): { code?: string; message: string; details: Record<string, unknown> } {
  try {
    fn();
  } catch (err) {
    const thrown = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: thrown.code, message: thrown.message, details: thrown.details ?? {} };
  }
  throw new Error('expected an error');
}

/** The BpmnError `fn` throws; any other error is thrown on. */
export function failure(fn: () => unknown): BpmnError {
  try {
    fn();
  } catch (err) {
    if (err instanceof BpmnError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

/** The error `pending` rejects with; fails when it resolves. */
export async function rejected(pending: Promise<unknown>): Promise<BpmnError> {
  try {
    await pending;
  } catch (err) {
    return err as BpmnError;
  }
  throw new Error('expected a rejection');
}
