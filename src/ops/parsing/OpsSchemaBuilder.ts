import { ALIAS } from './utils/aliases.js';
import { OP_NAMES } from './utils/op-names.js';
import type { FieldSpec } from './utils/field-specs.js';
import { ADD_FIELDS, ALIGN_FIELDS, BRANCH_FIELDS, COLOR_FIELDS, COMPACT_FIELDS, CONNECT_FIELDS, EXT_FIELDS, LABEL_FIELDS, MOVE_FIELDS, NODE_FIELDS, OP_DESCRIPTIONS, ORDER_FIELDS, PLACE_FIELDS, PLACE_GROUPS, PLACEMENT_CONFLICTS, PLACEMENT_KEYS, REMOVE_FIELDS, RETYPE_FIELDS, ROUTE_FIELDS, SET_FIELDS, SPACE_FIELDS, SPLIT_FIELDS, TIDY_FIELDS } from './utils/op-fields.js';

const NAMED = { anyOf: ['ids', 'path', 'kind', 'branch'].map((key) => ({ required: [key] })) };

/** Builds the JSON Schema of the `bpmn apply` ops format from the op field specs. */
export class OpsSchemaBuilder {
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

  private groupRules(groups: string[][]): unknown[] {
    return [
      ...groups.flatMap((group) => group.flatMap((first, index) => group.slice(index + 1).map((second) => ({ not: { required: [first, second] } })))),
      { anyOf: groups.flat().map((key) => ({ required: [key] })) },
    ];
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

  private placementRules(): unknown[] {
    return PLACEMENT_CONFLICTS.map(([first, second]) => ({ not: { required: [first, second] } }));
  }
  private defaultRule(): unknown {
    return { not: { required: ['default', 'condition'], properties: { default: { const: true } } } };
  }

  build(): Record<string, unknown> {
    const opRefs = OP_NAMES.map((opName) => ({ $ref: `#/$defs/${opName}` }));
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
        op: { oneOf: opRefs },
        add: this.objectSchema(ADD_FIELDS, { op: 'add', description: OP_DESCRIPTIONS.add, allOf: [...this.placementRules(), this.defaultRule(), { if: { required: ['ifAbsent'], properties: { ifAbsent: { const: true } } }, then: { required: ['id'] } }] }),
        connect: this.objectSchema(CONNECT_FIELDS, { op: 'connect', description: OP_DESCRIPTIONS.connect, allOf: [this.defaultRule()] }),
        set: this.objectSchema(SET_FIELDS, { op: 'set', description: OP_DESCRIPTIONS.set, allOf: [{ anyOf: [{ required: ['values'] }, { required: ['unset'] }] }] }),
        remove: this.objectSchema(REMOVE_FIELDS, { op: 'remove', description: OP_DESCRIPTIONS.remove }),
        retype: this.objectSchema(RETYPE_FIELDS, { op: 'retype', description: OP_DESCRIPTIONS.retype }),
        move: this.objectSchema(MOVE_FIELDS, { op: 'move', description: OP_DESCRIPTIONS.move, allOf: [...this.placementRules(), this.defaultRule(), { anyOf: [...PLACEMENT_KEYS.map((key) => ({ required: [key] })), { required: ['lane'] }] }] }),
        order: this.objectSchema(ORDER_FIELDS, { op: 'order', description: OP_DESCRIPTIONS.order, allOf: [{ oneOf: [{ required: ['flows'] }, { required: ['lanes'] }, { required: ['pools'] }] }] }),
        ext: this.objectSchema(EXT_FIELDS, {
          op: 'ext',
          description: OP_DESCRIPTIONS.ext,
          allOf: [
            { if: { properties: { action: { const: 'add' } } }, then: { anyOf: [{ required: ['type'] }, { required: ['xml'] }], not: { required: ['index'] } } },
            { if: { properties: { action: { const: 'remove' } } }, then: { oneOf: [{ required: ['type'] }, { required: ['index'] }], not: { anyOf: [{ required: ['attrs'] }, { required: ['body'] }, { required: ['xml'] }, { required: ['replace'] }] } } },
          ],
        }),
        split: this.objectSchema(SPLIT_FIELDS, { op: 'split', description: OP_DESCRIPTIONS.split }),
        place: this.objectSchema(PLACE_FIELDS, { op: 'place', description: OP_DESCRIPTIONS.place, allOf: [NAMED, ...this.groupRules(PLACE_GROUPS)] }),
        align: this.objectSchema(ALIGN_FIELDS, { op: 'align', description: OP_DESCRIPTIONS.align, allOf: [NAMED, { anyOf: [{ required: ['to'] }, { properties: { ids: { minItems: 2 } } }, { required: ['path'] }, { required: ['kind'] }, { required: ['branch'] }] }] }),
        color: this.objectSchema(COLOR_FIELDS, { op: 'color', description: OP_DESCRIPTIONS.color, allOf: [NAMED] }),
        label: this.objectSchema(LABEL_FIELDS, { op: 'label', description: OP_DESCRIPTIONS.label }),
        route: this.objectSchema(ROUTE_FIELDS, { op: 'route', description: OP_DESCRIPTIONS.route }),
        space: this.objectSchema(SPACE_FIELDS, { op: 'space', description: OP_DESCRIPTIONS.space, allOf: [{ oneOf: [{ required: ['after'] }, { required: ['below'] }] }] }),
        tidy: this.objectSchema(TIDY_FIELDS, { op: 'tidy', description: OP_DESCRIPTIONS.tidy }),
        compact: this.objectSchema(COMPACT_FIELDS, { op: 'compact', description: OP_DESCRIPTIONS.compact }),
        branch: this.objectSchema(BRANCH_FIELDS, { description: 'One branch of a split: flow options of the gateway -> first node flow, then the nodes.', allOf: [this.defaultRule()] }),
        node: this.objectSchema(NODE_FIELDS, { description: 'A node inside a split branch: an add op without placement (it is chained after the previous node).', allOf: [this.defaultRule()] }),
      },
    };
  }
}

/** JSON Schema (draft 2020-12) of the ops format, generated from the field specs. */
export const OPS_SCHEMA: Record<string, unknown> = new OpsSchemaBuilder().build();
