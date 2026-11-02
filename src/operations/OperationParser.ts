import { BpmnError, EditDistance } from '../model/index.js';
import { FieldRefusal, OperationLocation } from './fields/index.js';
import { OperationAliases } from './OperationAliases.js';
import { OperationCatalog, type DrawingOperation, type ModelOperation, type Operation } from './OperationCatalog.js';

export interface ParsedOperations {
  model: ModelOperation[];
  drawing: DrawingOperation[];
}

export class OperationParser {
  parse(input: unknown): ParsedOperations {
    const list = this.listOf(typeof input === 'string' ? this.json(input) : input);
    const operations = list.map((raw, index) => this.read(raw, index));
    this.assertModelFirst(operations);
    OperationAliases.assertBatch(operations);
    return {
      model: operations.filter((operation) => !OperationCatalog.isDrawing(operation)) as ModelOperation[],
      drawing: operations.filter((operation) => OperationCatalog.isDrawing(operation)),
    };
  }

  private json(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw BpmnError.usage(`Ops are not valid JSON: ${(error as Error).message}`);
    }
  }

  private listOf(input: unknown): unknown[] {
    const envelope = input as { ops?: unknown } | null;
    const list = Array.isArray(input) ? input : envelope?.ops;
    if (!Array.isArray(list)) {
      throw BpmnError.usage(`Expected an array of ops or an object {"ops": [...]}, got ${FieldRefusal.describe(input)}`, { hint: 'Run `bpmn guide ops` for the format; programs read OPS_SCHEMA.' });
    }
    const extra = Array.isArray(input) ? [] : Object.keys(input as object).filter((key) => key !== 'ops' && key !== '$schema');
    if (extra.length) {
      throw BpmnError.usage(`Unknown top-level key${extra.length > 1 ? 's' : ''} ${extra.map((key) => `"${key}"`).join(', ')}; expected only "ops"`, { hint: 'The ops file is {"ops": [...]} or a plain array of ops.' });
    }
    if (!list.length) {
      throw BpmnError.usage('The ops list is empty', { hint: 'Add at least one op, e.g. {"op": "add", "kind": "userTask", "name": "Check invoice", "after": "startEvent_orderReceived"}.' });
    }
    return list;
  }

  private read(raw: unknown, index: number): Operation {
    const location = new OperationLocation(index, `ops[${index}]`);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw location.refusal(`expected an op object, got ${FieldRefusal.describe(raw)}`, 'Every entry looks like {"op": "add", ...}.');
    }
    const name = (raw as { op?: unknown }).op;
    const names = OperationCatalog.names();
    if (name === undefined) {
      throw location.refusal(`missing "op"; one of: ${names.join(', ')}`);
    }
    const definition = typeof name === 'string' ? OperationCatalog.find(name) : undefined;
    if (!definition) {
      const alternative = typeof name === 'string' ? EditDistance.closestKey(name, names) : undefined;
      throw location.refusal(`unknown op ${JSON.stringify(name)}${alternative ? ` (did you mean "${alternative}"?)` : ''}; one of: ${names.join(', ')}`, undefined, alternative ? [alternative] : []);
    }
    const fields = definition.read(raw, new OperationLocation(index, `ops[${index}] (${name})`));
    return { op: name, ...fields } as Operation;
  }

  private assertModelFirst(operations: readonly Operation[]): void {
    const firstDrawing = operations.findIndex((operation) => OperationCatalog.isDrawing(operation));
    const lateModel = operations.findIndex((operation, index) => firstDrawing >= 0 && index > firstDrawing && !OperationCatalog.isDrawing(operation));
    if (lateModel >= 0) {
      throw BpmnError.usage(`ops[${lateModel}] (${operations[lateModel]!.op}): a model operation cannot follow the drawing operation ops[${firstDrawing}] (${operations[firstDrawing]!.op}) in one batch`, { op: lateModel, hint: 'Send two batches: the model operations first, then the drawing operations.' });
    }
  }
}
