import type { EditCommand } from './types.js';
import type { AliasTable } from './AliasTable.js';
import { isAlias } from './utils/aliases.js';
import { NODE_FIELDS } from './utils/op-fields.js';
import { EditCommandDefinitions } from './definitions/EditCommandDefinitions.js';
import type { EditCommandDefinition } from './definitions/EditCommandDefinition.js';

/** `set` keys whose value is an element id. */
const SET_REF_KEYS: readonly string[] = ['default', 'source', 'target', 'lane'];

const NODE_DEF_KEYS = Object.keys(NODE_FIELDS).filter((key) => NODE_FIELDS[key as keyof typeof NODE_FIELDS].alias);

type Raw = Record<string, unknown>;

type Slot = { key: string; get: () => unknown; put: (slotValue: unknown) => void; holder: Raw; name: string };

/**
 * Batch aliases (`"as": "$check"`): later ops of an `apply` batch use them wherever an element
 * id goes, so generated ids need not be guessed. `$` cannot occur in a BPMN id; `${...}`
 * expressions are not ids.
 */
export class CommandAliases {
  constructor(private readonly command: EditCommand) {}

  /** The aliases the op defines (a split: also its branch nodes'). */
  defined(): string[] {
    const raw = this.command as unknown as Raw;
    const definition = EditCommandDefinitions.find(this.command.op);
    const definingKeys = definition ? Object.keys(definition.fields).filter((key) => definition.fields[key]!.alias) : [];
    const out = definingKeys.map((defKey) => raw[defKey]).filter((definedId): definedId is string => typeof definedId === 'string');
    this.eachBranchNode(definition, raw, (node) => {
      for (const defKey of NODE_DEF_KEYS) if (typeof node[defKey] === 'string') out.push(node[defKey] as string);
    });
    return out;
  }

  referencedIds(): string[] {
    const out: string[] = [];
    for (const slot of this.slots(this.command)) {
      const slotValue = slot.get();
      if (typeof slotValue === 'string') out.push(slotValue);
      else if (Array.isArray(slotValue)) for (const entry of slotValue) if (typeof entry === 'string') out.push(entry);
    }
    return out;
  }

  /** Every alias the op refers to, with the key it stands in (`ids[1]`, `values.default`). */
  references(): Array<{ key: string; alias: string }> {
    const out: Array<{ key: string; alias: string }> = [];
    for (const slot of this.slots(this.command)) {
      const slotValue = slot.get();
      if (isAlias(slotValue)) out.push({ key: slot.key, alias: slotValue });
      else if (Array.isArray(slotValue)) slotValue.forEach((entry, index) => isAlias(entry) && out.push({ key: `${slot.key}[${index}]`, alias: entry }));
    }
    return out;
  }

  resolve(table: AliasTable, index: number): EditCommand {
    const command = this.command;
    if (!this.references().length) return command;
    const copy = JSON.parse(JSON.stringify(command)) as EditCommand;
    const id = (alias: string, key: string): string => table.idOf(alias, index, command, key);
    for (const slot of this.slots(copy)) {
      const slotValue = slot.get();
      if (isAlias(slotValue)) slot.put(id(slotValue, slot.key));
      else if (Array.isArray(slotValue)) slot.put(slotValue.map((entry, entryIndex) => (isAlias(entry) ? id(entry, `${slot.key}[${entryIndex}]`) : entry)));
    }
    return copy;
  }

  private slots(command: EditCommand): Slot[] {
    const out: Slot[] = [];
    const slot = (holder: Raw, name: string, key: string): void => {
      out.push({ key, holder, name, get: () => holder[name], put: (slotValue) => (holder[name] = slotValue) });
    };
    const raw = command as unknown as Raw;
    const definition = EditCommandDefinitions.find(command.op);
    for (const key of definition?.referenceKeys ?? []) slot(raw, key, key);
    const map = (holder: Raw, name: string, path: string): void => {
      const member = holder[name];
      if (member && typeof member === 'object') for (const refKey of SET_REF_KEYS) slot(member as Raw, refKey, `${path}.${refKey}`);
    };
    if (definition?.propertyMapKey) map(raw, definition.propertyMapKey, definition.propertyMapKey);
    this.eachBranchNode(definition, raw, (node, path) => {
      slot(node, 'lane', `${path}.lane`);
      map(node, 'set', `${path}.set`);
    });
    return out;
  }

  private eachBranchNode(definition: EditCommandDefinition | undefined, raw: Raw, fn: (node: Raw, path: string) => void): void {
    if (!definition) return;
    for (const [key, spec] of Object.entries(definition.fields)) {
      if (spec.type !== 'branches') continue;
      this.eachObject(raw[key], (branch, branchIndex) => this.eachObject(branch['nodes'], (node, nodeIndex) => fn(node, `${key}[${branchIndex}].nodes[${nodeIndex}]`)));
    }
  }

  /** Typed library ops skip parsing: a malformed split list must reach splitFlow's own check. */
  private eachObject(list: unknown, fn: (item: Raw, index: number) => void): void {
    if (Array.isArray(list)) list.forEach((item, index) => item && typeof item === 'object' && fn(item as Raw, index));
  }
}
