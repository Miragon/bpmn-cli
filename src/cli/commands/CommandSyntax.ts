import { BpmnError, OPS_SCHEMA, type Operation } from '../../api/index.js';
import { CommandInput, type SharedFlags } from './CommandInput.js';

interface FieldSchema {
  type?: string;
  enum?: string[];
  description?: string;
  'x-batch-only'?: boolean;
}

interface OperationSchema {
  description: string;
  properties: Record<string, FieldSchema>;
}

interface Word {
  usage: string;
  field: string;
}

interface Shape {
  operation: string;
  words: readonly Word[];
  action?: string;
  notFlags?: readonly string[];
}

export interface Flag {
  usage: string;
  help: string;
  field: string;
  choices?: readonly string[] | undefined;
  repeated?: boolean;
}

export interface OperationWords {
  command: string[];
  rest: string[];
}

export class CommandSyntax {
  static readonly SHARED_FLAGS: readonly Omit<Flag, 'field'>[] = [
    { usage: '-o <file>', help: 'write to another file, - for stdout' },
    { usage: '--dry-run', help: 'run everything, write nothing' },
    { usage: '--force', help: 'write despite a lossy import, new errors or content a retype deletes' },
    { usage: '--json', help: 'print the result as JSON' },
  ];

  private static readonly PAIRS = '[key=value...]';
  private static readonly KEY_WORD = /^[A-Za-z_][\w:.-]*=/;
  private static readonly INDEX_SELECTOR = /^(?:(definition|loop|condition)\.)?(\d+)$/;
  private static readonly WHOLE_NUMBER = /^\s*-?\d+\s*$/;
  private static readonly PLACEHOLDERS: Readonly<Record<string, string>> = { flowName: 'text', condition: 'expr', language: 'lang', xml: 'snippet', by: 'amount' };
  private static readonly REPEATED: ReadonlySet<string> = new Set(['unset']);
  private static readonly EXTENSION_ONLY = ['action', 'attrs', 'body'];
  private static readonly IDS: Word = { usage: '<ids...>', field: 'ids' };
  private static readonly OPTIONAL_IDS: Word = { usage: '[ids...]', field: 'ids' };
  private static readonly ID: Word = { usage: '<id>', field: 'id' };
  private static readonly KIND: Word = { usage: '<kind>', field: 'kind' };
  private static readonly SET: Word = { usage: CommandSyntax.PAIRS, field: 'set' };

  private static readonly SHAPES: Readonly<Record<string, Shape>> = {
    add: { operation: 'add', words: [CommandSyntax.KIND, { usage: '[name]', field: 'name' }, CommandSyntax.SET] },
    connect: { operation: 'connect', words: [{ usage: '<sourceId>', field: 'source' }, { usage: '<targetId>', field: 'target' }, CommandSyntax.SET] },
    set: { operation: 'set', words: [CommandSyntax.ID, CommandSyntax.SET] },
    remove: { operation: 'remove', words: [CommandSyntax.IDS] },
    retype: { operation: 'retype', words: [CommandSyntax.ID, CommandSyntax.KIND, CommandSyntax.SET] },
    move: { operation: 'move', words: [CommandSyntax.IDS] },
    order: { operation: 'order', words: [CommandSyntax.ID, { usage: '<ids...>', field: 'flows' }] },
    'ext add': { operation: 'ext', action: 'add', words: [CommandSyntax.ID, { usage: '[type]', field: 'type' }, { usage: CommandSyntax.PAIRS, field: 'attrs' }], notFlags: CommandSyntax.EXTENSION_ONLY },
    'ext remove': { operation: 'ext', action: 'remove', words: [CommandSyntax.ID, { usage: '<selector>', field: 'type' }], notFlags: [...CommandSyntax.EXTENSION_ONLY, 'xml', 'replace'] },
    layout: { operation: 'layout', words: [] },
    tidy: { operation: 'tidy', words: [CommandSyntax.OPTIONAL_IDS] },
    compact: { operation: 'compact', words: [CommandSyntax.OPTIONAL_IDS] },
    place: { operation: 'place', words: [CommandSyntax.OPTIONAL_IDS] },
    color: { operation: 'color', words: [CommandSyntax.OPTIONAL_IDS] },
    label: { operation: 'label', words: [CommandSyntax.ID] },
    route: { operation: 'route', words: [{ usage: '<flowId>', field: 'id' }] },
    space: { operation: 'space', words: [] },
  };

  private constructor(
    readonly name: string,
    private readonly shape: Shape,
  ) {}

  static editCommands(): CommandSyntax[] {
    return Object.entries(CommandSyntax.SHAPES).map(([name, shape]) => new CommandSyntax(name, shape));
  }

  static ofOperation({ op, action }: { op: string; action?: unknown }): CommandSyntax | undefined {
    return CommandSyntax.editCommands().find(({ shape }) => shape.operation === op && shape.action === action);
  }

  private static kebab(field: string): string {
    return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  }

  private static placeholder(field: string, schema: FieldSchema): string {
    if (schema.type === 'boolean') {
      return '';
    }
    if (schema.type === 'array') {
      return CommandSyntax.REPEATED.has(field) ? ' <key>' : ' <ids...>';
    }
    return ` <${schema.enum ? 'value' : (CommandSyntax.PLACEHOLDERS[field] ?? 'id')}>`;
  }

  private static pairs(words: readonly string[]): Record<string, string> {
    const pairs: Record<string, string> = {};
    for (const word of words) {
      const separator = word.indexOf('=');
      if (separator <= 0) {
        throw BpmnError.usage(`Expected key=value, got "${word}"`, { hint: 'Quote a value with spaces: name="Check order".' });
      }
      pairs[word.slice(0, separator).trim()] = word.slice(separator + 1);
    }
    return pairs;
  }

  private static flagValue(field: string, value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.flatMap((item: string) => item.split(',')).map((item) => item.trim()).filter(Boolean);
    }
    return field === 'by' && typeof value === 'string' && CommandSyntax.WHOLE_NUMBER.test(value) ? Number(value) : value;
  }

  private static extensionRemoval(selector: string): Record<string, unknown> {
    const indexed = CommandSyntax.INDEX_SELECTOR.exec(selector.trim());
    return indexed ? { index: Number(indexed[2]), ...(indexed[1] ? { slot: indexed[1] } : {}) } : { type: selector };
  }

  private static extensionAttributes(words: readonly string[]): Record<string, unknown> {
    const { body, ...attrs } = CommandSyntax.pairs(words);
    return { ...(Object.keys(attrs).length ? { attrs } : {}), ...(body === undefined ? {} : { body }) };
  }

  get group(): string | undefined {
    return this.name.includes(' ') ? this.name.split(' ')[0] : undefined;
  }

  get word(): string {
    return this.name.split(' ').at(-1)!;
  }

  get help(): string {
    return this.schema.description;
  }

  positionals(): string[] {
    return ['<file>', ...this.shape.words.map(({ usage }) => usage)];
  }

  flags(): Flag[] {
    const positional = this.shape.words.map(({ field }) => field);
    const fields = Object.entries(this.schema.properties).filter(([field, schema]) => field !== 'op' && !schema['x-batch-only'] && !positional.includes(field) && !this.shape.notFlags?.includes(field));
    return fields.map(([field, schema]) => ({
      usage: `--${CommandSyntax.kebab(field)}${CommandSyntax.placeholder(field, schema)}`,
      help: schema.description ?? '',
      field,
      choices: schema.enum,
      repeated: CommandSyntax.REPEATED.has(field),
    }));
  }

  wordFor(field: string): string {
    const flag = this.flags().find((candidate) => candidate.field === field);
    return flag?.usage.split(' ')[0] ?? this.shape.words.find((word) => word.field === field)?.usage ?? field;
  }

  parse(words: readonly unknown[]): CommandInput {
    const [path, ...values] = words as [string, ...unknown[]];
    const flags = words.at(-2) as SharedFlags & Record<string, unknown>;
    const operation: Operation = { op: this.shape.operation, ...(this.shape.action ? { action: this.shape.action } : {}), ...this.positionalFields(values) };
    for (const { field } of this.flags()) {
      if (flags[field] !== undefined) {
        operation[field] = CommandSyntax.flagValue(field, flags[field]);
      }
    }
    return new CommandInput(path, operation, flags);
  }

  wordsOf(operation: Record<string, unknown>): OperationWords | undefined {
    const { op: _op, action: _action, ...fields } = operation;
    const rest = this.shape.words.flatMap(({ field }) => this.positionalWords(field, fields));
    for (const { field, usage } of this.flags()) {
      rest.push(...CommandSyntax.flagWords(usage, fields[field], CommandSyntax.REPEATED.has(field)));
      delete fields[field];
    }
    return Object.keys(fields).length ? undefined : { command: this.name.split(' '), rest };
  }

  private static flagWords(usage: string, value: unknown, repeated: boolean): string[] {
    if (value === undefined || value === false) {
      return [];
    }
    const flag = usage.split(' ')[0]!;
    if (repeated) {
      return [value].flat().flatMap((item) => [flag, String(item)]);
    }
    return [flag, ...(value === true ? [] : [value].flat().map(String))];
  }

  private positionalWords(field: string, fields: Record<string, unknown>): string[] {
    const value = fields[field];
    delete fields[field];
    if (value === undefined) {
      return [];
    }
    return typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as object).map(([key, item]) => `${key}=${String(item)}`) : [value].flat().map(String);
  }

  private get schema(): OperationSchema {
    return (OPS_SCHEMA as { $defs: Record<string, OperationSchema> }).$defs[this.shape.operation]!;
  }

  private positionalFields(values: readonly unknown[]): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    this.shape.words.forEach(({ field }, index) => {
      const value = values[index];
      const isGiven = Array.isArray(value) ? value.length > 0 : value !== undefined;
      if (isGiven && field !== 'set' && field !== 'attrs') {
        fields[field] = value;
      }
    });
    const pairs = values[this.shape.words.findIndex(({ usage }) => usage === CommandSyntax.PAIRS)];
    return this.withInputsOfTheirOwn(fields, (pairs ?? []) as string[]);
  }

  private withInputsOfTheirOwn({ name, type, ...fields }: Record<string, unknown>, pairs: readonly string[]): Record<string, unknown> {
    if (this.name === 'ext remove') {
      return { ...fields, ...CommandSyntax.extensionRemoval(type as string) };
    }
    if (this.name === 'ext add') {
      return { ...fields, ...(type === undefined ? {} : { type }), ...CommandSyntax.extensionAttributes(pairs) };
    }
    const nameIsKey = typeof name === 'string' && CommandSyntax.KEY_WORD.test(name);
    const set = CommandSyntax.pairs(nameIsKey ? [name, ...pairs] : pairs);
    return { ...fields, ...(name === undefined || nameIsKey ? {} : { name }), ...(Object.keys(set).length ? { set } : {}) };
  }
}
