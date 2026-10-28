import type { BpmnlintRuleSetting } from '../../../domain/document/ids/bpmnlint-rule-setting.js';
import type { IdConventions, QualifierMode } from '../../../domain/document/ids/IdConventions.js';
import { closestKey } from '../../../domain/document/utils/fuzzy.js';
import { isUsablePrefix } from '../../../domain/document/utils/slug.js';
import { KINDS, TRIGGERS } from '../../../domain/document/Kinds.js';
import { createModdle } from '../../../domain/document/utils/moddle.js';
import type { ValidatorFinding } from '../../../domain/document/Finding.js';

export const ID_NAMING_RULE = '@miragon/rules/element-id-naming';

/** The helpers of the plugin's `naming` namespace that element-id-naming runs. */
export interface IdNamingHelpers {
  DEFAULT_PREFIXES: Record<string, string | false | null>;
  resolvePrefix(element: unknown, prefixes: Record<string, string | false | null>): { type: string; prefix: string } | null;
  acceptedPrefixes(element: unknown, prefix: string, mode: QualifierMode): string[];
  resolveCase(caseName: string): { pattern: RegExp; label: string };
  resolveQualifierMode(mode: string | undefined): QualifierMode;
}

const CASES = ['camelCase', 'PascalCase', 'snake_case', 'any'];

/** A BPMNLabel is written without an id. */
const DI_WITH_IDS = ['bpmndi:BPMNDiagram', 'bpmndi:BPMNPlane', 'bpmndi:BPMNShape', 'bpmndi:BPMNEdge'];
const QUALIFIERS = ['off', 'optional', 'required'];

type Moddle = ReturnType<typeof createModdle>;
type Prefixes = Record<string, string | false | null>;

/**
 * Reads element-id-naming's options from a .bpmnlintrc exactly as the rule does, with its own
 * helpers injected (the core never imports the plugin). What new ids cannot follow is left out,
 * each with a W_CONFIG_IGNORED note.
 */
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
   * `conventions` is undefined for no setting, severity off or every prefix switched off.
   * Options are read as element-id-naming's factory reads them.
   */
  read(setting: BpmnlintRuleSetting | undefined): { conventions?: IdConventions; notes: ValidatorFinding[] } {
    const notes = this.notes;
    if (!setting || setting.severity === 'off') return { notes };
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

  private didYouMean(value: unknown, known: readonly string[]): string {
    const near = typeof value === 'string' && value ? closestKey(value, known) : undefined;
    return near ? ` Did you mean ${near}?` : '';
  }

  private caseOf(caseName: string): string {
    /**
     * An unknown case resolves to the rule's fallback, PascalCase. Plugins before 0.12.1 answer
     * `toString` or `__proto__` with the Object.prototype property, which has no label.
     */
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

  private typePrefixes(moddle: Moddle, prefixes: Prefixes, ignored: string[]): Record<string, string> {
    const table: Record<string, string> = {};
    const registry = (moddle as unknown as { registry: { packageMap: Record<string, { types: Array<{ name: string; isAbstract?: boolean }> }> } }).registry;
    for (const moddleType of registry.packageMap['bpmn']!.types) {
      if (moddleType.isAbstract) continue;
      const type = `bpmn:${moddleType.name}`;
      const hit = this.naming.resolvePrefix(moddle.create(type, { id: 'x' }), prefixes);
      if (hit && this.usable(hit)) table[type] = hit.prefix;
      else if (hit) ignored.push(type);
    }
    return table;
  }

  /** A required qualified prefix too long for new ids is ignored (noted once): those ids follow the learned style, which the rule reports. */
  private qualifiedPrefixes(moddle: Moddle, table: Record<string, string>, qualifier: QualifierMode, ignored: string[]): void {
    for (const def of KINDS) {
      const plain = table[def.type];
      if (plain === undefined || !def.triggers) continue;
      for (const trigger of def.triggers) {
        if (trigger === 'none') continue;
        const event = moddle.create(def.type, { id: 'x', eventDefinitions: [moddle.create(TRIGGERS[trigger].definition)] });
        const qualified = this.naming.acceptedPrefixes(event, plain, qualifier).find((candidate) => candidate !== plain);
        const key = `${def.type}:${trigger}`;
        if (isUsablePrefix(qualified)) table[key] = qualified;
        else if (qualified !== undefined && qualifier === 'required' && !this.noted.has(key)) {
          this.noted.add(key);
          ignored.push(key);
          this.note(`prefix of ${key}`, qualified, `is longer than 56 characters (the ${def.type} prefix qualified with the trigger): new ids of such events follow the learned id style, and the rule reports them`, `Shorten the ${def.type} prefix in the .bpmnlintrc, or set eventDefinitionQualifier to optional.`);
        }
      }
    }
  }

  /**
   * bpmn-cli names DI after its element, never after a declared prefix, and the rule checks DI ids
   * too, so a declared DI prefix gets a note.
   */
  private noteDiPrefixes(moddle: Moddle, prefixes: Prefixes): void {
    for (const type of DI_WITH_IDS) {
      const hit = this.naming.resolvePrefix(moddle.create(type, { id: 'x' }), prefixes);
      if (hit) this.note(`prefix of ${type}`, hit.prefix, 'is not followed: bpmn-cli names DI after its element (BPMNShape_<id>, <id>_di), and the rule reports new DI ids', 'Set it to false or remove it; bpmn-js names DI <id>_di too.');
    }
  }
}
