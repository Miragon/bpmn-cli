import type { OperationDefinition } from './fields/OperationDefinition.js';
import { SplitBranchDefinition } from './model/SplitBranchDefinition.js';
import { SplitNodeDefinition } from './model/SplitNodeDefinition.js';
import { OperationCatalog } from './OperationCatalog.js';

export type JsonSchema = Record<string, unknown>;

class OperationSchema {
  private static referencesTo(definitions: readonly OperationDefinition[]): JsonSchema {
    return { oneOf: definitions.map(({ name }) => ({ $ref: `#/$defs/${name}` })) };
  }

  private static entryOf(definition: OperationDefinition, operation: boolean): JsonSchema {
    const fields = Object.entries(definition.fields);
    const rules = definition.schemaRules;
    return {
      ...(operation ? { title: definition.name } : {}),
      type: 'object',
      description: definition.description,
      properties: {
        ...(operation ? { op: { const: definition.name } } : {}),
        ...Object.fromEntries(fields.map(([key, field]) => [key, field.jsonSchema()])),
      },
      required: [...(operation ? ['op'] : []), ...fields.filter(([, field]) => field.traits.required).map(([key]) => key)],
      additionalProperties: false,
      ...(rules.length ? { allOf: rules } : {}),
    };
  }

  write(): JsonSchema {
    const operationList = { type: 'array', minItems: 1, items: { $ref: '#/$defs/op' } };
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://bpmn-cli/schemas/ops.json',
      title: 'bpmn apply operations',
      description: 'A batch of edits for `bpmn apply <file> <ops.json>`: either an array of ops or {"ops": [...]}. The model ops run first, then the layout, then the diagram-only ops in batch order; a model op after a diagram-only op is refused. Keys are the CLI flags of the same command in lowerCamelCase.',
      oneOf: [operationList, { type: 'object', properties: { $schema: { type: 'string' }, ops: operationList }, required: ['ops'], additionalProperties: false }],
      $defs: {
        op: OperationSchema.referencesTo(OperationCatalog.ALL),
        drawingOp: OperationSchema.referencesTo(OperationCatalog.DRAWING),
        ...Object.fromEntries(OperationCatalog.ALL.map((definition) => [definition.name, OperationSchema.entryOf(definition, true)])),
        branch: OperationSchema.entryOf(new SplitBranchDefinition(), false),
        node: OperationSchema.entryOf(new SplitNodeDefinition(), false),
      },
    };
  }
}

export const OPS_SCHEMA: JsonSchema = new OperationSchema().write();
