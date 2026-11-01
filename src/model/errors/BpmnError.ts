import { ModelError } from './ModelError.js';

export type ErrorCategory = 'usage' | 'model' | 'layout' | 'io' | 'internal';

export interface ErrorDetails {
  element?: string;
  related?: string[];
  candidates?: string[];
  hint?: string;
  op?: number;
  [key: string]: unknown;
}

export class BpmnError extends Error {
  static readonly EXIT_CODES: Readonly<Record<ErrorCategory, number>> = {
    usage: 1,
    model: 2,
    layout: 3,
    io: 4,
    internal: 70,
  };

  constructor(
    public readonly code: string,
    message: string,
    public readonly category: ErrorCategory = 'model',
    public readonly details: ErrorDetails = {},
  ) {
    super(message);
    this.name = 'CliError';
  }

  static usage(message: string, details: ErrorDetails = {}): BpmnError {
    return new BpmnError('E_USAGE', message, 'usage', details);
  }

  static model(code: string, message: string, details: ErrorDetails = {}): BpmnError {
    return new BpmnError(code, message, 'model', details);
  }

  static io(code: string, message: string, details: ErrorDetails = {}): BpmnError {
    return new BpmnError(code, message, 'io', details);
  }

  static from(error: unknown): unknown {
    if (error instanceof ModelError) {
      return new BpmnError(`E_${error.code}`, error.message, BpmnError.categoryOf(error.code), error.details);
    }
    return error;
  }

  static firstLine(error: unknown): string {
    return String((error as Error)?.message ?? error).split('\n')[0]!;
  }

  private static categoryOf(code: string): ErrorCategory {
    if (code.startsWith('LAYOUT')) {
      return 'layout';
    }
    return code === 'PARSE_ERROR' ? 'io' : 'model';
  }

  get exitCode(): number {
    return BpmnError.EXIT_CODES[this.category];
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, ...this.details };
  }
}
