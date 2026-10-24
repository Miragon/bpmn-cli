/**
 * Declared id conventions (browser-safe): what a project's .bpmnlintrc says
 * about ids through @miragon/rules/element-id-naming, as plain data the core
 * takes (MutationOptions / EditOptions / NewDocOptions `conventions`;
 * src/ids/IdStyle.ts fills the gaps the file leaves with them).
 *
 * IdConventionsReader reads the rule's options exactly as the rule does
 * (`prefixes` merged over the plugin's DEFAULT_PREFIXES, `case` camelCase
 * and `eventDefinitionQualifier` optional by default), with the rule's own
 * helpers, injected (the core never imports the plugin): resolvePrefix on an
 * element of every concrete bpmn: type of the moddle registry gives the
 * type's prefix (the rule's fallback order included; a type switched off
 * with false or null has none), acceptedPrefixes on an event of every kind
 * and trigger the qualified one (`bpmn:StartEvent:timer`: timerStartEvent_;
 * none under the qualifier off), resolveCase and resolveQualifierMode the
 * case and the qualifier. No setting, or the severity off: nothing is
 * declared. What new ids cannot follow is left out, each with one
 * W_CONFIG_IGNORED note (a validator finding; the node layer adds it to the
 * project's bpmnlint validator, so a write only counts it, like
 * W_LINT_UNAVAILABLE): a prefix that is no string, cannot start an XML id or
 * leaves no room for a body (new ids of that type follow the file's style;
 * `ignored` names the type, which the view marks as checked), an unknown
 * case (new ids take the rule's fallback, PascalCase) or qualifier
 * (optional). DI types (bpmndi:) are out of scope: bpmn-cli names DI after
 * its element (`<id>_di`, BPMNShape_<id>), so a prefix declared for one it
 * writes ids for (not BPMNLabel; an unknown key no more than an unknown
 * bpmn: one) is a W_CONFIG_IGNORED too (the rule checks DI ids).
 */
import type { BpmnlintRuleSetting } from '../validate/bpmnlint-validator.js';
import { closestKey } from '../shared/utils/fuzzy.js';
import { isUsablePrefix } from './utils/slug.js';
import { KINDS, TRIGGER_TYPES } from '../model/utils/kinds.js';
import { createModdle } from '../model/utils/moddle.js';
import type { ValidatorFinding } from '../validate/validators.js';

/** The rule's name as a resolved .bpmnlintrc keys it (resolveBpmnlintConfig `rules`). */
export const ID_NAMING_RULE = '@miragon/rules/element-id-naming';

export type QualifierMode = 'off' | 'optional' | 'required';

/** The id conventions the core takes: plain data (idConventionsFromLint, or a host's own table). */
export interface IdConventions {
  /**
   * the prefix of new ids, with its separator, per BPMN type
   * ('bpmn:ServiceTask': 'serviceTask_'), and per event type and trigger the
   * qualified one ('bpmn:StartEvent:timer': 'timerStartEvent_'); a type
   * without an entry follows the file's id style
   */
  prefixes: Record<string, string>;
  /** element-id-naming's eventDefinitionQualifier: under `required` a new event with a trigger takes the qualified prefix, else the plain one (default optional) */
  qualifier?: QualifierMode;
  /** the case of the body after a declared prefix (element-id-naming's `case`); absent: any (the file's case) */
  case?: 'camelCase' | 'PascalCase' | 'snake_case';
  /** where they come from, for the results' `conventions:` line and W_ID_PREFIX_STALE (`.bpmnlintrc in models`) */
  source?: string;
  /**
   * the concrete types element-id-naming checks with a prefix new ids cannot
   * follow (W_CONFIG_IGNORED): they follow the file's style, and the rule
   * reports them; under the qualifier `required` also an event type and
   * trigger whose qualified prefix is too long (`bpmn:EndEvent:escalation`):
   * new ids of such events follow the file's style too
   */
  ignored?: string[];
}

/** The part of @miragon/bpmnlint-plugin-rules' `naming` namespace idConventionsFromLint uses (the helpers element-id-naming itself runs). */
export interface IdNamingHelpers {
  DEFAULT_PREFIXES: Record<string, string | false | null>;
  resolvePrefix(element: unknown, prefixes: Record<string, string | false | null>): { type: string; prefix: string } | null;
  acceptedPrefixes(element: unknown, prefix: string, mode: QualifierMode): string[];
  resolveCase(caseName: string): { pattern: RegExp; label: string };
  resolveQualifierMode(mode: string | undefined): QualifierMode;
}

const CASES = ['camelCase', 'PascalCase', 'snake_case', 'any'];

/** The DI types bpmn-cli writes ids for (BPMNShape_<id>, BPMNEdge_<id>, BPMNPlane_<id>, BPMNDiagram_<id>; a BPMNLabel has none). */
const DI_WITH_IDS = ['bpmndi:BPMNDiagram', 'bpmndi:BPMNPlane', 'bpmndi:BPMNShape', 'bpmndi:BPMNEdge'];
const QUALIFIERS = ['off', 'optional', 'required'];

type Moddle = ReturnType<typeof createModdle>;
type Prefixes = Record<string, string | false | null>;

export class IdConventionsReader {
  private readonly where: string;
  private readonly notes: ValidatorFinding[] = [];
  private readonly noted = new Set<string>();

  constructor(
    private readonly naming: IdNamingHelpers,
    private readonly source?: string,
  ) {
    this.where = source ?? '.bpmnlintrc';
  }

  /**
   * The id conventions element-id-naming declares with its effective setting
   * (see the module header), and a W_CONFIG_IGNORED note for each value new
   * ids cannot follow; `source` names the .bpmnlintrc in the notes and the
   * results (default `.bpmnlintrc`). `conventions` is undefined where nothing
   * is declared (no setting, severity off, every prefix switched off).
   */
  read(setting: BpmnlintRuleSetting | undefined): { conventions?: IdConventions; notes: ValidatorFinding[] } {
    const notes = this.notes;
    if (!setting || setting.severity === 'off') return { notes };
    // the rule's own reading of its options (element-id-naming's factory)
    const options = (setting.config ?? {}) as { prefixes?: Prefixes; case?: string; eventDefinitionQualifier?: string };
    const { prefixes: overrides = {}, case: caseName = 'camelCase' } = options;
    const prefixes = { ...this.naming.DEFAULT_PREFIXES, ...overrides };
    const label = this.caseOf(caseName);
    const qualifier = this.qualifierOf(options.eventDefinitionQualifier);
    const moddle = createModdle();
    const ignored: string[] = [];
    const table = this.typePrefixes(moddle, prefixes, ignored);
    if (qualifier !== 'off') this.qualifiedPrefixes(moddle, table, qualifier, ignored);
    this.noteDiPrefixes(moddle, prefixes);
    if (!Object.keys(table).length) return { notes };
    const conventions: IdConventions = {
      prefixes: table,
      qualifier,
      ...(label !== 'any' ? { case: label as NonNullable<IdConventions['case']> } : {}),
      ...(this.source ? { source: this.source } : {}),
      ...(ignored.length ? { ignored } : {}),
    };
    return { conventions, notes };
  }

  private note(key: string, value: unknown, problem: string, hint: string): void {
    const shown = JSON.stringify(value) ?? String(value);
    this.notes.push({ severity: 'warning', code: 'W_CONFIG_IGNORED', message: `${this.where}: ${ID_NAMING_RULE} ${key} ${shown} ${problem}`, hint, key: `config|${key}|${shown}` });
  }

  /** ` Did you mean X?` for a value close to one of `known` (closestKey: any case, - or _, a prefix, a small typo), else ''. */
  private didYouMean(value: unknown, known: readonly string[]): string {
    const near = typeof value === 'string' && value ? closestKey(value, known) : undefined;
    return near ? ` Did you mean ${near}?` : '';
  }

  private caseOf(caseName: string): string {
    // an unknown case resolves to the rule's fallback, PascalCase, which the rule checks (since 0.12.1 also `toString`);
    // injected helpers of a plugin before 0.12.1 answer a property name of Object.prototype with that property (a
    // function for `toString`, Object.prototype itself for `__proto__`), which has no label: new ids take the fallback,
    // and that plugin's rule cannot check the case (it reports `<prefix_undefined>` or throws), which the note says
    const resolved = (this.naming.resolveCase(caseName) as { label?: unknown } | undefined)?.label;
    const label = typeof resolved === 'string' && CASES.includes(resolved) ? resolved : 'PascalCase';
    const caseHint = `Write one of ${CASES.join(', ')} in the .bpmnlintrc.${this.didYouMean(caseName, CASES)}`;
    if (label !== resolved) this.note('case', caseName, 'is unknown, and the rule of a @miragon/bpmnlint-plugin-rules before 0.12.1 cannot check it: new ids take PascalCase, the fallback for an unknown case', caseHint);
    else if (label !== caseName) this.note('case', caseName, `is unknown: the rule checks ${label}, and new ids take it`, caseHint);
    return label;
  }

  private qualifierOf(mode: string | undefined): QualifierMode {
    const qualifier = this.naming.resolveQualifierMode(mode);
    if (mode !== undefined && mode !== qualifier) {
      this.note('eventDefinitionQualifier', mode, `is unknown: the rule and new ids take ${qualifier}`, `Write one of ${QUALIFIERS.join(', ')} in the .bpmnlintrc.${this.didYouMean(mode, QUALIFIERS)}`);
    }
    return qualifier;
  }

  private usable(hit: { type: string; prefix: unknown }): boolean {
    if (isUsablePrefix(hit.prefix)) return true;
    if (!this.noted.has(hit.type)) {
      this.noted.add(hit.type);
      const problem =
        typeof hit.prefix === 'string' && /[^\x00-\x7f]/.test(hit.prefix)
          ? 'has a character outside ASCII, which bpmn-cli does not write in ids'
          : 'cannot start an id (a letter or _ first, then letters, digits, _ . -, at most 56 characters)';
      this.note(`prefix of ${hit.type}`, hit.prefix, `${problem}: new ids of the type follow the learned id style, and the rule reports them`, `Fix the prefix in the .bpmnlintrc, or set it to false to switch ${hit.type} off.`);
    }
    return false;
  }

  /** Every concrete bpmn: type, as the rule resolves it (exact type, else its fallback order). */
  private typePrefixes(moddle: Moddle, prefixes: Prefixes, ignored: string[]): Record<string, string> {
    const table: Record<string, string> = {};
    const registry = (moddle as unknown as { registry: { packageMap: Record<string, { types: Array<{ name: string; isAbstract?: boolean }> }> } }).registry;
    for (const t of registry.packageMap['bpmn']!.types) {
      if (t.isAbstract) continue;
      const type = `bpmn:${t.name}`;
      const hit = this.naming.resolvePrefix(moddle.create(type, { id: 'x' }), prefixes);
      if (hit && this.usable(hit)) table[type] = hit.prefix;
      else if (hit) ignored.push(type);
    }
    return table;
  }

  /** The qualified prefix of each event kind and trigger (timerStartEvent_), as the rule accepts it. */
  private qualifiedPrefixes(moddle: Moddle, table: Record<string, string>, qualifier: QualifierMode, ignored: string[]): void {
    for (const def of KINDS) {
      const plain = table[def.type];
      if (plain === undefined || !def.triggers) continue;
      for (const trigger of def.triggers) {
        if (trigger === 'none') continue;
        const event = moddle.create(def.type, { id: 'x', eventDefinitions: [moddle.create(TRIGGER_TYPES[trigger])] });
        const qualified = this.naming.acceptedPrefixes(event, plain, qualifier).find((p) => p !== plain);
        const key = `${def.type}:${trigger}`;
        if (isUsablePrefix(qualified)) table[key] = qualified;
        else if (qualified !== undefined && qualifier === 'required' && !this.noted.has(key)) {
          // the rule requires a qualified prefix new ids cannot have (too long): they follow the learned style, which it reports
          this.noted.add(key);
          ignored.push(key);
          this.note(`prefix of ${key}`, qualified, `is longer than 56 characters (the ${def.type} prefix qualified with the trigger): new ids of such events follow the learned id style, and the rule reports them`, `Shorten the ${def.type} prefix in the .bpmnlintrc, or set eventDefinitionQualifier to optional.`);
        }
      }
    }
  }

  /**
   * A DI type bpmn-cli writes ids for (DI_WITH_IDS), as the rule resolves it (its exact entry): bpmn-cli names DI after
   * its element, never after a declared prefix, and the rule checks DI ids too (bpmnlint walks the diagrams), so it
   * reports the new ones; not BPMNLabel (written without an id, which the rule skips), nor a key that names no type.
   */
  private noteDiPrefixes(moddle: Moddle, prefixes: Prefixes): void {
    for (const type of DI_WITH_IDS) {
      const hit = this.naming.resolvePrefix(moddle.create(type, { id: 'x' }), prefixes);
      if (hit) this.note(`prefix of ${type}`, hit.prefix, 'is not followed: bpmn-cli names DI after its element (BPMNShape_<id>, <id>_di), and the rule reports new DI ids', 'Set it to false or remove it; bpmn-js names DI <id>_di too.');
    }
  }
}
