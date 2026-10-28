import type { Finding } from './Finding.js';

export type ErrorCategory = 'usage' | 'model' | 'layout' | 'io' | 'internal';

export const EXIT_CODES: Record<ErrorCategory, number> = {
  usage: 1,
  model: 2,
  layout: 3,
  io: 4,
  internal: 70,
};

export interface ErrorDetails {
  element?: string;
  related?: string[];
  /** alternative ids when a reference could not be resolved uniquely */
  candidates?: string[];
  hint?: string;
  /** index of the failing operation in a batch / DSL chain */
  op?: number;
  [key: string]: unknown;
}

/** An error with a stable code; its category decides the exit code (warnings still exit 0). */
export class BpmnError extends Error {
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

/** A non-fatal finding attached to a result. */
export type Warning = Finding;
