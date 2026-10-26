import { CliError, type ErrorDetails } from '../CliError.js';

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
