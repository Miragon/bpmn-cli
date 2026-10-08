/**
 * Error model shared by every layer.
 *
 * Exit codes (documented in README and `bpmn guide`):
 *   0  success (warnings allowed)
 *   1  usage error (unknown command/option, bad DSL or ops syntax)
 *   2  model error (unknown reference, invalid mutation, validation failure)
 *   3  layout error
 *   4  I/O or parse error (missing file, malformed XML, lossy import)
 *   70 internal error
 */
export type ErrorCategory = 'usage' | 'model' | 'layout' | 'io' | 'internal';

export const EXIT_CODES: Record<ErrorCategory, number> = {
  usage: 1,
  model: 2,
  layout: 3,
  io: 4,
  internal: 70,
};

export interface ErrorDetails {
  /** element the error is about */
  element?: string;
  /** other involved elements */
  related?: string[];
  /** alternative ids when a reference could not be resolved uniquely */
  candidates?: string[];
  /** how to fix it */
  hint?: string;
  /** index of the failing operation in a batch / DSL chain */
  op?: number;
  [key: string]: unknown;
}

export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly category: ErrorCategory = 'model',
    public readonly details: ErrorDetails = {},
  ) {
    super(message);
    this.name = 'CliError';
  }

  get exitCode(): number {
    return EXIT_CODES[this.category];
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, ...this.details };
  }
}

export function usageError(message: string, details: ErrorDetails = {}): CliError {
  return new CliError('E_USAGE', message, 'usage', details);
}

export function modelError(code: string, message: string, details: ErrorDetails = {}): CliError {
  return new CliError(code, message, 'model', details);
}

export function ioError(code: string, message: string, details: ErrorDetails = {}): CliError {
  return new CliError(code, message, 'io', details);
}

export function layoutError(code: string, message: string, details: ErrorDetails = {}): CliError {
  return new CliError(code, message, 'layout', details);
}

export function isCliError(err: unknown): err is CliError {
  return err instanceof CliError;
}

/** A non-fatal finding attached to a result. */
export interface Warning {
  code: string;
  message: string;
  element?: string;
  related?: string[];
  hint?: string;
}
