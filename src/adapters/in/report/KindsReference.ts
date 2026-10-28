import { LAYOUT_MODES } from '../../../domain/diagram/types.js';
import { Doc } from '../../../domain/document/Doc.js';
import { EditSession } from '../../../domain/document/EditSession.js';
import { DEFAULT_ID_CONVENTIONS } from '../../../domain/document/ids/IdConventions.js';
import { KINDS, TRIGGERS, type Family, type KindDef, type Trigger } from '../../../domain/document/Kinds.js';
import { SWATCHES } from '../../../domain/diagram/utils/colors.js';
import { OPS_SCHEMA } from './OpsSchemaBuilder.js';
import { opsExample } from '../../../domain/commands/utils/op-fields.js';
import { EditCommandDefinitions } from '../../../domain/commands/definitions/EditCommandDefinitions.js';
import { EXTENSION_STRUCTURE } from '../../../domain/editing/extensions/ExtensionStructure.js';
import { NESTED_SLOTS, NESTED_TYPES, type NestedSlot } from '../../../domain/document/utils/nested-slots.js';
import { SET_KEYS, SetKeyCatalog, type SetKeyDoc } from '../../../domain/editing/properties/SetKeyCatalog.js';
import { COMMAND_NAMES } from '../../../domain/commands/utils/command-names.js';
import { ZEEBE } from '../../../domain/document/vendor/ZeebeDescriptor.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import { ERROR_CATALOGUE, EXIT_CODE_DOCS, ID_CONVENTIONS, NESTED_SELECTORS, NON_INTERRUPTING_DOC, PLACEMENT_DOCS, PLACEMENT_NOTES, TRIGGER_OPTIONS } from './guide.js';
import { heading, table } from './utils/table.js';
import { NestedSlots } from '../../../domain/editing/properties/NestedSlots.js';

const FAMILY_LABELS: Record<Family, string> = {
  task: 'Tasks',
  subProcess: 'Sub-processes',
  callActivity: 'Call activity',
  gateway: 'Gateways',
  event: 'Events  (kind:trigger, e.g. startEvent:message, boundary:timer)',
  participant: 'Pools',
  lane: 'Lanes',
  data: 'Data',
  artifact: 'Artifacts',
};

export interface ZeebeElementDoc {
  type: string;
  /** kinds, nested slots (`loop.`, `definition.`) or `message`; for a child type its container */
  on: string[];
  attributes: string[];
  children?: string[];
  /** Camunda 8 reads one per element: a second one is merged by ext add */
  single: boolean;
}

/** `ext add` merges a second one of these into the first. */
const ZEEBE_SINGLE = [...EXTENSION_STRUCTURE.singleTop].filter((type) => type.startsWith('zeebe:'));

/** The sections of `bpmn kinds` by their JSON key. */
const SECTION_KEYS: Record<string, string[]> = {
  kinds: ['kinds'],
  triggers: ['triggers', 'nonInterrupting'],
  setKeys: ['setKeys'],
  nestedKeys: ['nestedKeys', 'nestedSelectors'],
  zeebeElements: ['zeebeElements'],
  placement: ['placement'],
  ops: ['ops', 'opsExample'],
  layoutModes: ['layoutModes'],
  ids: ['ids'],
  colors: ['colors'],
  errors: ['errors'],
  exitCodes: ['exitCodes'],
};

export const KINDS_SECTION_NAMES = Object.keys(SECTION_KEYS).join(', ');

export class KindsReference {
  text(): string {
    return [this.kindsSection(), this.triggersSection(), this.setKeysSection(), this.nestedKeysSection(), this.zeebeSection(), this.placementSection(), this.errorsSection()].join('\n') + '\n';
  }

  json(): Record<string, unknown> {
    return {
      kinds: KINDS.map((kind) => ({
        kind: kind.kind,
        type: kind.type,
        family: kind.family,
        aliases: kind.aliases,
        prefix: DEFAULT_ID_CONVENTIONS.prefixes[kind.type],
        ...(kind.triggers ? { triggers: kind.triggers } : {}),
        ...(kind.props ? { props: kind.props } : {}),
        description: kind.description,
      })),
      triggers: Object.fromEntries(
        TRIGGER_OPTIONS.map((trigger) => [
          trigger.trigger,
          {
            ...(trigger.trigger !== 'none' ? { type: TRIGGERS[trigger.trigger].definition } : {}),
            option: trigger.option,
            keys: trigger.keys,
            description: trigger.description,
            kinds: this.kindsWithTrigger(trigger.trigger),
            ...(trigger.alsoOn ? { alsoOn: trigger.alsoOn } : {}),
          },
        ]),
      ),
      nonInterrupting: NON_INTERRUPTING_DOC,
      setKeys: SetKeyCatalog.docs(),
      nestedKeys: this.nestedKeyTable(),
      nestedSelectors: NESTED_SELECTORS,
      zeebeElements: this.zeebeElementTable(),
      placement: {
        options: PLACEMENT_DOCS,
        notes: PLACEMENT_NOTES,
      },
      ops: OPS_SCHEMA,
      opsExample: opsExample(),
      layoutModes: [...LAYOUT_MODES],
      ids: ID_CONVENTIONS,
      colors: SWATCHES,
      errors: ERROR_CATALOGUE,
      exitCodes: Object.fromEntries(EXIT_CODE_DOCS.map((exitCode) => [String(exitCode.code), exitCode.meaning])),
    };
  }

  /** Case and dashes are ignored: set-keys = setKeys. */
  sections(spec: string): string[] {
    const names = Object.keys(SECTION_KEYS);
    return spec
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((raw) => {
        const key = raw.toLowerCase().replace(/[\s_-]/g, '');
        const found = names.find((name) => name.toLowerCase() === key) ?? names.find((name) => name.toLowerCase() === key.replace(/s$/, '')) ?? names.find((name) => SECTION_KEYS[name]!.some((kind) => kind.toLowerCase() === key));
        if (!found) throw usageError(`Unknown kinds section "${raw}"`, { candidates: names, hint: `Sections: ${names.join(', ')} (several: --section ops,errors).` });
        return found;
      });
  }

  sectionText(sections: string[]): string {
    return sections.map((section) => this.section(section)).join('\n').replace(/^\n/, '') + '\n';
  }

  sectionJson(sections: string[]): Record<string, unknown> {
    const all = this.json();
    const out: Record<string, unknown> = {};
    for (const section of sections) for (const key of SECTION_KEYS[section]!) out[key] = all[key];
    return out;
  }

  placementSection(): string {
    return [heading('PLACEMENT  (add / move; ops JSON key in parentheses)'), table(PLACEMENT_DOCS.map((placement) => [placement.option, `(${placement.key})`, placement.rule])), ...PLACEMENT_NOTES.map((note) => `  ${note}`)].join('\n');
  }

  triggersSection(): string {
    const rows = TRIGGER_OPTIONS.map((trigger) => [trigger.trigger, trigger.option, trigger.description, `on: ${[...this.kindsWithTrigger(trigger.trigger), ...(trigger.alsoOn ?? [])].join(', ') || '-'}`]);
    return [heading('TRIGGERS  (event kind suffix + option; ops JSON keys = option names in lowerCamelCase)'), table(rows), `  ${NON_INTERRUPTING_DOC}`].join('\n');
  }

  opsSection(): string {
    const out: string[] = [heading('OPS JSON  (bpmn apply <file> ops.json; keys = CLI flags in lowerCamelCase; full schema: bpmn kinds --json -> ops)')];
    for (const commandName of COMMAND_NAMES) {
      const required = Object.entries(EditCommandDefinitions.of(commandName).fields).filter(([, spec]) => spec.required).map(([key]) => key);
      out.push(`  ${commandName.padEnd(8)} ${EditCommandDefinitions.of(commandName).description}`);
      out.push(`           keys: ${Object.keys(EditCommandDefinitions.of(commandName).fields).join(', ')}${required.length ? `  (required: ${required.join(', ')})` : ''}`);
    }
    out.push('\nBatch aliases: "as": "$name" on add / connect / split / split nodes ("flowAs" on add and split nodes: the flow into the');
    out.push('node, on a prepend before a join or a node without incoming flow the flow out of it; "outAs" on add: the one flow');
    out.push('the add creates out of the node, to the old successor on a splice, to the anchor on a prepend, else to "to"; E_USAGE');
    out.push('when it creates none or two; "joinAs" on split: the join;');
    out.push('"refAs" on add / connect / set / retype: the message, error, signal or escalation');
    out.push('the element references) names what the op creates; later ops use "$name" wherever an id goes (after, before,');
    out.push('flow, in, on, to, source, target, id, ids, set values default / source / target / lane, order flows / lanes / pools,');
    out.push('the format ops with their selectors path / via / branch). An unknown or later-defined alias fails before anything');
    out.push('runs (E_UNKNOWN_ALIAS, listing the aliases defined so far); the result lists alias -> final id ("aliases:" line,');
    out.push('`aliases` in --json) and the old -> new id of a flow it renamed after its new ends ("renamed:" with --summary, `renamed`).');
    out.push('An alias follows its element through a rename and a retype (also to another type: create, retype, then configure).');
    out.push('With --keep-flow-ids a flow the file had keeps its id through the whole batch unless an op removes it (the flows of a');
    out.push('removed node, the out-flow a bridge replaces: "removed:"), so later ops can use it; a move puts the moved node\'s');
    out.push('out-flow back at its new place, with its id, documentation and extensions (its name, condition and annotations stay');
    out.push('with the bridge, its change says which, and it is no longer a default flow; a node that is not bridged, or whose');
    out.push('bridge a later node of the move removed, drops name and condition, W_LABEL_DROPPED, W_CONDITION_DROPPED, unless the');
    out.push('flow is put back between its old ends; a "flowId" on a move that prepends names a new flow node -> anchor instead).');
    out.push('The result names the stale ones (W_FLOW_ID_STALE) instead. A flow the batch created still follows its ends: name it');
    out.push('where an op creates it, with "flowAs" on an add that appends or prepends and on split nodes, "outAs" on an add that');
    out.push('splices, prepends or has "to", or "as" on connect. On a splice "flowAs" names the kept flow into the node and "outAs"');
    out.push('the new flow node -> old successor, so the batch that splices a gateway in can set that flow\'s condition or make it');
    out.push('the default.');
    out.push('\nExample (after `bpmn new order.bpmn --name "Order handling" --target camunda8`, start -> "Check invoice" -> end):');
    out.push(JSON.stringify(opsExample(), null, 2));
    return out.join('\n');
  }

  exitCodesSection(): string {
    return [heading('EXIT CODES'), table(EXIT_CODE_DOCS.map((exitCode) => [String(exitCode.code), exitCode.meaning]))].join('\n');
  }

  private kindsSection(): string {
    const out: string[] = [heading('KINDS  (bpmn add <file> <kind[:trigger]> [name] ...; aliases in parentheses; id prefix without a .bpmnlintrc in the 2nd column)')];
    const families = [...new Set(KINDS.map((kind) => kind.family))];
    for (const family of families) {
      out.push(`\n${FAMILY_LABELS[family]}`);
      const rows: string[][] = [];
      for (const def of KINDS.filter((kind) => kind.family === family)) {
        rows.push([this.kindLabelWithAliases(def), DEFAULT_ID_CONVENTIONS.prefixes[def.type]!, def.description]);
        if (def.triggers) rows.push(['', '', `triggers: ${def.triggers.join(', ')}`]);
      }
      out.push(table(rows));
    }
    return out.join('\n');
  }

  private setKeysSection(): string {
    const out: string[] = [heading('SET KEYS  (bpmn set <file> <id> key=value ...; key= or --unset key removes; also usable as `set` in add ops)')];
    if (!SET_KEYS.length) {
      out.push('  (no set keys registered)');
      return out.join('\n');
    }
    for (const [appliesTo, keys] of this.groupSetKeys(SET_KEYS)) {
      out.push(`\n${appliesTo}`);
      out.push(table(keys.map((key) => [key.key, key.description])));
    }
    return out.join('\n');
  }

  private nestedKeysSection(): string {
    const out: string[] = [heading('NESTED KEYS  (set keys of nested elements without an id: definition. = event definition, loop. = loop characteristics, condition. = condition expression; every slot also takes <slot>.id)')];
    const keyTable = this.nestedKeyTable();
    const rows: string[][] = [];
    for (const slot of NESTED_SLOTS) {
      for (const [type, keys] of Object.entries(keyTable[slot])) {
        const shown = keys.filter((key) => key !== `${slot}.id`);
        if (shown.length) rows.push([type.replace('bpmn:', ''), shown.join(', ')]);
      }
    }
    out.push(table(rows));
    out.push('  A camunda attribute that belongs on a nested element is refused on its parent (E_WRONG_HOST, the hint names the key).');
    for (const [selector, text] of Object.entries(NESTED_SELECTORS)) out.push(`  ${selector}: ${text}`);
    out.push('  Extension elements of a nested element: the same prefix on the ext type, e.g. `bpmn ext add <file> <id> loop.camunda:failedJobRetryTimeCycle --body R3/PT5M`.');
    return out.join('\n');
  }

  private zeebeSection(): string {
    const out: string[] = [heading('CAMUNDA 8  (zeebe extension elements: bpmn ext add <file> <id> <type> attr=value; FEEL values start with =, write attr==<expression>; from the Zeebe descriptor)')];
    for (const zeebeRow of this.zeebeElementTable()) {
      out.push(`  ${zeebeRow.type.padEnd(28)} ${[zeebeRow.attributes.join(' '), zeebeRow.children ? `children: ${zeebeRow.children.join(', ')}` : ''].filter(Boolean).join('; ') || '(no attributes)'}${zeebeRow.single ? '  (one per element)' : ''}`);
      out.push(`      on: ${zeebeRow.on.join(', ') || 'see the descriptor'}`);
    }
    out.push('  Child types go into their container (zeebe:input -> zeebe:ioMapping), a single element is merged, a keyed item (zeebe:input by target,');
    out.push('  zeebe:header by key, zeebe:property by name) is replaced. A zeebe attribute set on the element itself is refused (E_WRONG_HOST).');
    return out.join('\n');
  }

  private errorsSection(): string {
    const out: string[] = [heading('ERRORS AND WARNINGS')];
    for (const error of ERROR_CATALOGUE) out.push(`  ${error.code}\n      ${error.meaning}\n      fix: ${error.fix}`);
    return out.join('\n');
  }

  private kindLabelWithAliases(def: KindDef): string {
    return def.aliases.length ? `${def.kind} (${def.aliases.join(', ')})` : def.kind;
  }

  private groupSetKeys(keys: SetKeyDoc[]): Map<string, SetKeyDoc[]> {
    const groups = new Map<string, SetKeyDoc[]>();
    for (const key of keys) {
      const list = groups.get(key.appliesTo) ?? [];
      list.push(key);
      groups.set(key.appliesTo, list);
    }
    return groups;
  }

  private nestedKeyTable(): Record<NestedSlot, Record<string, string[]>> {
    const doc = Doc.create();
    const edit = new EditSession(doc);
    const table = {} as Record<NestedSlot, Record<string, string[]>>;
    for (const slot of NESTED_SLOTS) {
      table[slot] = {};
      for (const type of NESTED_TYPES[slot]) table[slot][type] = new NestedSlots(edit).keysOf(slot, doc.moddle.create(type));
    }
    return table;
  }

  /** A whole family (all events, all tasks, ...) an element is allowed on is named once. */
  private zeebeElementTable(): ZeebeElementDoc[] {
    const out: ZeebeElementDoc[] = [];
    for (const name of ZEEBE.typeNames()) {
      const zeebeType = ZEEBE.type(name)!;
      const on: string[] = [];
      if (ZEEBE.nestedOnly(name)) on.push(...ZEEBE.containersOf(name).map((container) => `in ${container}`));
      else {
        if (ZEEBE.allowedOn(name, 'bpmn:Process') === true) on.push('process');
        const families = new Map<string, KindDef[]>();
        for (const kind of KINDS) families.set(kind.family, [...(families.get(kind.family) ?? []), kind]);
        for (const [family, kinds] of families) {
          const allowed = kinds.filter((kind) => ZEEBE.allowedOn(name, kind.type) === true);
          if (allowed.length && allowed.length === kinds.length && kinds.length > 1) on.push(`${family === 'subProcess' ? 'sub-processe' : family}s`);
          else on.push(...allowed.map((kind) => kind.kind));
        }
        if (ZEEBE.allowedOn(name, 'bpmn:Message') === true && ZEEBE.allowedOn(name, 'bpmn:Task') !== true) on.push('message');
        if (ZEEBE.allowedOn(name, 'bpmn:MultiInstanceLoopCharacteristics') === true) on.push('loop. (multi-instance activities)');
        const defs = ['Message', 'Conditional'].filter((definition) => ZEEBE.allowedOn(name, `bpmn:${definition}EventDefinition`) === true);
        for (const definition of defs) on.push(`definition. (${definition.toLowerCase()} events)`);
        if (ZEEBE.allowedOn(name, 'bpmn:Lane') === true && ZEEBE.allowedOn(name, 'bpmn:Message') === true) on.splice(0, on.length, 'any element');
        for (const container of ZEEBE.containersOf(name)) on.push(`in ${container}`);
      }
      out.push({ type: name, on, attributes: zeebeType.attributes.map((attribute) => attribute.name), ...(zeebeType.children.length ? { children: zeebeType.children } : {}), single: ZEEBE_SINGLE.includes(name) });
    }
    return out;
  }

  private kindsWithTrigger(trigger: Trigger): string[] {
    return KINDS.filter((kind) => kind.triggers?.includes(trigger)).map((kind) => kind.kind);
  }

  private simpleRows(title: string, rows: string[][]): string {
    return [heading(title), table(rows)].join('\n');
  }

  private section(name: string): string {
    const texts: Record<string, () => string> = {
      kinds: () => this.kindsSection(),
      triggers: () => this.triggersSection(),
      setKeys: () => this.setKeysSection(),
      nestedKeys: () => this.nestedKeysSection(),
      zeebeElements: () => this.zeebeSection(),
      placement: () => this.placementSection(),
      ops: () => this.opsSection(),
      layoutModes: () => this.simpleRows('LAYOUT MODES', LAYOUT_MODES.map((mode) => [mode])),
      ids: () => [heading('IDS'), JSON.stringify(ID_CONVENTIONS, null, 2)].join('\n'),
      colors: () => this.simpleRows('COLORS', Object.entries(SWATCHES).map(([name, swatch]) => [name, JSON.stringify(swatch)])),
      errors: () => this.errorsSection(),
      exitCodes: () => this.exitCodesSection(),
    };
    return texts[name]!();
  }
}
