import { BpmnError, type ErrorDetails } from '../BpmnError.js';

export function usageError(message: string, details: ErrorDetails = {}): BpmnError {
  return new BpmnError('E_USAGE', message, 'usage', details);
}

export function modelError(code: string, message: string, details: ErrorDetails = {}): BpmnError {
  return new BpmnError(code, message, 'model', details);
}

export function ioError(code: string, message: string, details: ErrorDetails = {}): BpmnError {
  return new BpmnError(code, message, 'io', details);
}

export function isBpmnError(err: unknown): err is BpmnError {
  return err instanceof BpmnError;
}
