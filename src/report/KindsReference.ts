import { LAYOUT_MODES } from '../pipeline/index.js';
import { Doc } from '../model/Doc.js';
import { KINDS, TRIGGER_TYPES, type Family, type KindDef, type Trigger } from '../model/kinds.js';
import { SWATCHES } from '../diagram/write.js';
import { OPS_SCHEMA } from '../ops/OpsSchemaBuilder.js';
import { OP_DESCRIPTIONS, OP_FIELDS, opsExample } from '../ops/utils/op-fields.js';
import { SINGLE_TOP } from '../ops/ext.js';
import { NESTED_SLOTS, NESTED_TYPES, nestedKeysOf, SET_KEYS, type NestedSlot, type SetKeyDoc } from '../ops/set.js';
import { OP_NAMES } from '../ops/utils/op-names.js';
import { ZEEBE } from '../platform/ZeebeDescriptor.js';
import { usageError } from '../shared/utils/errors.js';
import { ERROR_CATALOGUE, EXIT_CODE_DOCS, ID_CONVENTIONS, NESTED_SELECTORS, NON_INTERRUPTING_DOC, PLACEMENT_DOCS, PLACEMENT_NOTES, TRIGGER_OPTIONS } from './guide.js';
import { heading, table } from './utils/table.js';

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

/** One zeebe extension element type: where it goes (kinds, nested slots, containers), its attributes, whether it is single. */
export interface ZeebeElementDoc {
  type: string;
  /** element kinds (`bpmn kinds`), nested slots (`loop.` of activities, `definition.` of events) or `message`; for a child type its container */
  on: string[];
  attributes: string[];
  children?: string[];
  /** Camunda 8 reads one per element: a second one is merged by ext add */
  single: boolean;
}

/** The zeebe types `ext add` keeps single (merges a second one into the first; ops/ext.ts SINGLE_TOP). */
const ZEEBE_SINGLE = [...SINGLE_TOP].filter((t) => t.startsWith('zeebe:'));

/** The parts of `bpmn kinds` / `kinds --json` by their JSON key: the JSON keys of each (section renders its text). */
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

/** The section names `kinds --section` accepts (the JSON keys of `kinds --json`). */
export const KINDS_SECTION_NAMES = Object.keys(SECTION_KEYS).join(', ');

export class KindsReference {
  /** `bpmn kinds`: kinds, triggers, set keys, placement grammar and the error catalogue as text. */
  text(): string {
    return [this.kindsSection(), this.triggersSection(), this.setKeysSection(), this.nestedKeysSection(), this.zeebeSection(), this.placementSection(), this.errorsSection()].join('\n') + '\n';
  }

  /** `bpmn kinds --json`: the same as one object, plus the ops schema and example. */
  json(): Record<string, unknown> {
    return {
      kinds: KINDS.map((k) => ({
        kind: k.kind,
        type: k.type,
        family: k.family,
        aliases: k.aliases,
        prefix: k.prefix,
        ...(k.triggers ? { triggers: k.triggers } : {}),
        ...(k.props ? { props: k.props } : {}),
        description: k.description,
      })),
      triggers: Object.fromEntries(
        TRIGGER_OPTIONS.map((t) => [
          t.trigger,
          {
            ...(t.trigger !== 'none' ? { type: TRIGGER_TYPES[t.trigger] } : {}),
            option: t.option,
            keys: t.keys,
            description: t.description,
            kinds: this.kindsWithTrigger(t.trigger),
            ...(t.alsoOn ? { alsoOn: t.alsoOn } : {}),
          },
        ]),
      ),
      nonInterrupting: NON_INTERRUPTING_DOC,
      setKeys: SET_KEYS,
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
      exitCodes: Object.fromEntries(EXIT_CODE_DOCS.map((e) => [String(e.code), e.meaning])),
    };
  }

  /** Resolves `--section a,b` (case and dashes ignored: set-keys = setKeys); E_USAGE with the names for an unknown one. */
  sections(spec: string): string[] {
    const names = Object.keys(SECTION_KEYS);
    return spec
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((raw) => {
        const key = raw.toLowerCase().replace(/[\s_-]/g, '');
        const found = names.find((n) => n.toLowerCase() === key) ?? names.find((n) => n.toLowerCase() === key.replace(/s$/, '')) ?? names.find((n) => SECTION_KEYS[n]!.some((k) => k.toLowerCase() === key));
        if (!found) throw usageError(`Unknown kinds section "${raw}"`, { candidates: names, hint: `Sections: ${names.join(', ')} (several: --section ops,errors).` });
        return found;
      });
  }

  /** `bpmn kinds --section <names>` as text. */
  sectionText(sections: string[]): string {
    return sections.map((s) => this.section(s)).join('\n').replace(/^\n/, '') + '\n';
  }

  /** `bpmn kinds --section <names> --json`: only those keys of json(). */
  sectionJson(sections: string[]): Record<string, unknown> {
    const all = this.json();
    const out: Record<string, unknown> = {};
    for (const s of sections) for (const k of SECTION_KEYS[s]!) out[k] = all[k];
    return out;
  }

  placementSection(): string {
    return [heading('PLACEMENT  (add / move; ops JSON key in parentheses)'), table(PLACEMENT_DOCS.map((p) => [p.option, `(${p.key})`, p.rule])), ...PLACEMENT_NOTES.map((n) => `  ${n}`)].join('\n');
  }

  triggersSection(): string {
    const rows = TRIGGER_OPTIONS.map((t) => [t.trigger, t.option, t.description, `on: ${[...this.kindsWithTrigger(t.trigger), ...(t.alsoOn ?? [])].join(', ') || '-'}`]);
    return [heading('TRIGGERS  (event kind suffix + option; ops JSON keys = option names in lowerCamelCase)'), table(rows), `  ${NON_INTERRUPTING_DOC}`].join('\n');
  }

  opsSection(): string {
    const out: string[] = [heading('OPS JSON  (bpmn apply <file> ops.json; keys = CLI flags in lowerCamelCase; full schema: bpmn kinds --json -> ops)')];
    for (const n of OP_NAMES) {
      const required = Object.entries(OP_FIELDS[n]).filter(([, s]) => s.required).map(([k]) => k);
      out.push(`  ${n.padEnd(8)} ${OP_DESCRIPTIONS[n]}`);
      out.push(`           keys: ${Object.keys(OP_FIELDS[n]).join(', ')}${required.length ? `  (required: ${required.join(', ')})` : ''}`);
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
    return [heading('EXIT CODES'), table(EXIT_CODE_DOCS.map((e) => [String(e.code), e.meaning]))].join('\n');
  }

  private kindsSection(): string {
    const out: string[] = [heading('KINDS  (bpmn add <file> <kind[:trigger]> [name] ...; aliases in parentheses; id prefix in the 2nd column)')];
    const families = [...new Set(KINDS.map((k) => k.family))];
    for (const family of families) {
      out.push(`\n${FAMILY_LABELS[family]}`);
      const rows: string[][] = [];
      for (const def of KINDS.filter((k) => k.family === family)) {
        rows.push([this.kindLabelWithAliases(def), `${def.prefix}_`, def.description]);
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
      out.push(table(keys.map((k) => [k.key, k.description])));
    }
    return out.join('\n');
  }

  private nestedKeysSection(): string {
    const out: string[] = [heading('NESTED KEYS  (set keys of nested elements without an id: definition. = event definition, loop. = loop characteristics, condition. = condition expression; every slot also takes <slot>.id)')];
    const keyTable = this.nestedKeyTable();
    const rows: string[][] = [];
    for (const slot of NESTED_SLOTS) {
      for (const [type, keys] of Object.entries(keyTable[slot])) {
        const shown = keys.filter((k) => k !== `${slot}.id`);
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
    for (const z of this.zeebeElementTable()) {
      out.push(`  ${z.type.padEnd(28)} ${[z.attributes.join(' '), z.children ? `children: ${z.children.join(', ')}` : ''].filter(Boolean).join('; ') || '(no attributes)'}${z.single ? '  (one per element)' : ''}`);
      out.push(`      on: ${z.on.join(', ') || 'see the descriptor'}`);
    }
    out.push('  Child types go into their container (zeebe:input -> zeebe:ioMapping), a single element is merged, a keyed item (zeebe:input by target,');
    out.push('  zeebe:header by key, zeebe:property by name) is replaced. A zeebe attribute set on the element itself is refused (E_WRONG_HOST).');
    return out.join('\n');
  }

  private errorsSection(): string {
    const out: string[] = [heading('ERRORS AND WARNINGS')];
    for (const e of ERROR_CATALOGUE) out.push(`  ${e.code}\n      ${e.meaning}\n      fix: ${e.fix}`);
    return out.join('\n');
  }

  private kindLabelWithAliases(def: KindDef): string {
    return def.aliases.length ? `${def.kind} (${def.aliases.join(', ')})` : def.kind;
  }

  private groupSetKeys(keys: SetKeyDoc[]): Map<string, SetKeyDoc[]> {
    const groups = new Map<string, SetKeyDoc[]>();
    for (const k of keys) {
      const list = groups.get(k.appliesTo) ?? [];
      list.push(k);
      groups.set(k.appliesTo, list);
    }
    return groups;
  }

  /** Per slot and nested BPMN type, the `<slot>.<key>` keys `set` accepts (id, BPMN attributes, camunda attributes of the descriptor). */
  private nestedKeyTable(): Record<NestedSlot, Record<string, string[]>> {
    const doc = Doc.create();
    const table = {} as Record<NestedSlot, Record<string, string[]>>;
    for (const slot of NESTED_SLOTS) {
      table[slot] = {};
      for (const type of NESTED_TYPES[slot]) table[slot][type] = nestedKeysOf(doc, slot, doc.moddle.create(type));
    }
    return table;
  }

  /** Where each zeebe extension element goes, by the Zeebe descriptor (`bpmn kinds` section CAMUNDA 8, `kinds --json` -> zeebeElements). */
  private zeebeElementTable(): ZeebeElementDoc[] {
    const out: ZeebeElementDoc[] = [];
    for (const name of ZEEBE.typeNames()) {
      const t = ZEEBE.type(name)!;
      const on: string[] = [];
      if (ZEEBE.nestedOnly(name)) on.push(...ZEEBE.containersOf(name).map((c) => `in ${c}`));
      else {
        if (ZEEBE.allowedOn(name, 'bpmn:Process') === true) on.push('process');
        // a whole family (all events, all tasks, ...) is named once
        const families = new Map<string, KindDef[]>();
        for (const k of KINDS) families.set(k.family, [...(families.get(k.family) ?? []), k]);
        for (const [family, kinds] of families) {
          const allowed = kinds.filter((k) => ZEEBE.allowedOn(name, k.type) === true);
          if (allowed.length && allowed.length === kinds.length && kinds.length > 1) on.push(`${family === 'subProcess' ? 'sub-processe' : family}s`);
          else on.push(...allowed.map((k) => k.kind));
        }
        if (ZEEBE.allowedOn(name, 'bpmn:Message') === true && ZEEBE.allowedOn(name, 'bpmn:Task') !== true) on.push('message');
        if (ZEEBE.allowedOn(name, 'bpmn:MultiInstanceLoopCharacteristics') === true) on.push('loop. (multi-instance activities)');
        const defs = ['Message', 'Conditional'].filter((d) => ZEEBE.allowedOn(name, `bpmn:${d}EventDefinition`) === true);
        for (const d of defs) on.push(`definition. (${d.toLowerCase()} events)`);
        if (ZEEBE.allowedOn(name, 'bpmn:Lane') === true && ZEEBE.allowedOn(name, 'bpmn:Message') === true) on.splice(0, on.length, 'any element');
        for (const c of ZEEBE.containersOf(name)) on.push(`in ${c}`);
      }
      out.push({ type: name, on, attributes: t.attributes.map((a) => a.name), ...(t.children.length ? { children: t.children } : {}), single: ZEEBE_SINGLE.includes(name) });
    }
    return out;
  }

  /** Event kinds that allow a trigger. */
  private kindsWithTrigger(trigger: Trigger): string[] {
    return KINDS.filter((k) => k.triggers?.includes(trigger)).map((k) => k.kind);
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
      layoutModes: () => this.simpleRows('LAYOUT MODES', LAYOUT_MODES.map((m) => [m])),
      ids: () => [heading('IDS'), JSON.stringify(ID_CONVENTIONS, null, 2)].join('\n'),
      colors: () => this.simpleRows('COLORS', Object.entries(SWATCHES).map(([name, c]) => [name, JSON.stringify(c)])),
      errors: () => this.errorsSection(),
      exitCodes: () => this.exitCodesSection(),
    };
    return texts[name]!();
  }
}
