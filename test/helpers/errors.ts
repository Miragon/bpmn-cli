import { CliError } from '../../src/domain/document/CliError.js';

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

/** The CliError `fn` throws; any other error is thrown on. */
export function failure(fn: () => unknown): CliError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

/** The error `pending` rejects with; fails when it resolves. */
export async function rejected(pending: Promise<unknown>): Promise<CliError> {
  try {
    await pending;
  } catch (err) {
    return err as CliError;
  }
  throw new Error('expected a rejection');
}
