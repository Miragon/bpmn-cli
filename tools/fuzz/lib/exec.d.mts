export interface StepResult {
  status: string;
  code?: string;
  message?: string;
  xml?: string;
  result?: unknown;
  readBack?: string;
  ms?: number;
}

export interface Executor {
  label: string;
  run(xml: string, ops: unknown[]): StepResult | Promise<StepResult>;
}

export interface WritingLibrary {
  applyToXml(xml: string, ops: never[]): Promise<{ xml: string }>;
  BpmnError: abstract new (...args: never[]) => Error;
}

export function libExecutor(api: WritingLibrary, options?: { label?: string }): Executor;
