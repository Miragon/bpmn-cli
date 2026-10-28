import { ALIAS } from '../../../domain/commands/utils/aliases.js';
import { COMMAND_NAMES } from '../../../domain/commands/utils/command-names.js';
import type { FieldSpec } from '../../../domain/commands/utils/field-specs.js';
import { BRANCH_FIELDS, NODE_FIELDS } from '../../../domain/commands/utils/op-fields.js';
import { defaultRule } from '../../../domain/commands/utils/schema-rules.js';
import { EditCommandDefinitions } from '../../../domain/commands/definitions/EditCommandDefinitions.js';

/** Builds the JSON Schema of the `bpmn apply` ops format from the op field specs. */
class OpsSchemaBuilder {
  private fieldSchema(spec: FieldSpec): Record<string, unknown> {
    const described = { description: spec.description };
    switch (spec.type) {
      case 'string':
        return { type: 'string', ...(spec.ref ? { minLength: 1 } : {}), ...(spec.alias ? { pattern: ALIAS.source } : {}), ...(spec.values ? { enum: [...spec.values] } : {}), ...described };
      case 'boolean':
        return { type: 'boolean', ...described };
      case 'integer':
        return { type: 'integer', minimum: 0, ...described };
      case 'string[]':
        return { type: 'array', items: { type: 'string', minLength: 1 }, ...(spec.minItems ? { minItems: spec.minItems } : {}), ...described };
      case 'map':
        return { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, ...described };
      case 'branches':
        return { type: 'array', minItems: spec.minItems ?? 1, items: { $ref: '#/$defs/branch' }, ...described };
      case 'nodes':
        return { type: 'array', items: { $ref: '#/$defs/node' }, ...described };
      case 'size':
        return { oneOf: [{ type: 'string', pattern: '^\\s*-?\\s*(\\d*\\s*(cols?|columns?|rows?)|[1-9]\\d*\\s*px|0*[1-9]\\d*)\\s*$' }, { type: 'integer', not: { const: 0 } }], ...described };
    }
  }

  private objectSchema(fields: Record<string, FieldSpec>, opts: { op?: string; description: string; allOf?: unknown[] }): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    if (opts.op) properties['op'] = { const: opts.op };
    for (const [key, spec] of Object.entries(fields)) properties[key] = this.fieldSchema(spec);
    const required = [...(opts.op ? ['op'] : []), ...Object.entries(fields).filter(([, fieldSpec]) => fieldSpec.required).map(([fieldName]) => fieldName)];
    return {
      type: 'object',
      description: opts.description,
      properties,
      required,
      additionalProperties: false,
      ...(opts.allOf?.length ? { allOf: opts.allOf } : {}),
    };
  }

  build(): Record<string, unknown> {
    const commandRefs = COMMAND_NAMES.map((commandName) => ({ $ref: `#/$defs/${commandName}` }));
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://bpmn-cli/schemas/ops.json',
      title: 'bpmn apply operations',
      description: 'A batch of edits for `bpmn apply <file> <ops.json>`: either an array of ops or {"ops": [...]}. Semantic ops run first, then the layout, then the diagram-only format ops (place, align, color, label, route, space, tidy) in batch order. Keys are the CLI flags of the same command in lowerCamelCase.',
      oneOf: [
        { type: 'array', minItems: 1, items: { $ref: '#/$defs/op' } },
        { type: 'object', properties: { $schema: { type: 'string' }, ops: { type: 'array', minItems: 1, items: { $ref: '#/$defs/op' } } }, required: ['ops'], additionalProperties: false },
      ],
      $defs: {
        op: { oneOf: commandRefs },
        ...Object.fromEntries(EditCommandDefinitions.all().map((definition) => [definition.name, this.objectSchema(definition.fields, { op: definition.name, description: definition.description, allOf: definition.schemaRules() })])),
        branch: this.objectSchema(BRANCH_FIELDS, { description: 'One branch of a split: flow options of the gateway -> first node flow, then the nodes.', allOf: [defaultRule()] }),
        node: this.objectSchema(NODE_FIELDS, { description: 'A node inside a split branch: an add op without placement (it is chained after the previous node).', allOf: [defaultRule()] }),
      },
    };
  }
}

/** JSON Schema (draft 2020-12) of the ops format, generated from the field specs. */
export const OPS_SCHEMA: Record<string, unknown> = new OpsSchemaBuilder().build();
