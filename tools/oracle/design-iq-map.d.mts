export interface RecordedCall {
  function: string;
  refused?: { code: string; message: string };
}

export interface CallFacts {
  refused?: string;
  reason?: string;
  compared?: Record<string, unknown>;
  write?: Record<string, unknown>;
}

export function designIqCalls(): Array<{ id: string; call: RecordedCall }>;
export function recordedFacts(call: RecordedCall): CallFacts;
export function onRebuild(api: object, call: RecordedCall): Promise<CallFacts>;
export function recordedSchema(): { operations: string[]; drawing: string[] };
export function schemaFacts(schema: object): { operations: string[]; drawing: string[] };
