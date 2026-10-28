import type { BpmnlintRuleSetting } from '../../../domain/document/ids/bpmnlint-rule-setting.js';
import type { IdConventions, QualifierMode } from '../../../domain/document/ids/IdConventions.js';
import { closestKey } from '../../../domain/document/utils/fuzzy.js';
import { isUsablePrefix } from '../../../domain/document/utils/slug.js';
import { KINDS, TRIGGERS } from '../../../domain/document/Kinds.js';
import { createModdle } from '../../../domain/document/utils/moddle.js';
import type { ValidatorFinding } from '../../../domain/document/Finding.js';

export const ID_NAMING_RULE = '@miragon/rules/element-id-naming';

/** The resolution element-id-naming runs, as the plugin exports it from 0.19 on. */
interface ElementIdConvention {
  /** null: the type is not checked (no prefix, or switched off) */
  prefixOf(node: unknown): string | null;
  /** the plain prefix and the qualified ones the qualifier mode allows */
  prefixesFor(node: unknown): string[];
  readonly case: { label: string; pattern: RegExp };
  readonly qualifier: QualifierMode;
}

/** What bpmn-cli uses of the plugin's `naming` namespace. */
export interface IdNamingHelpers {
  ElementIdConvention: new (config?: unknown) => ElementIdConvention;
}

const CASES = ['camelCase', 'PascalCase', 'snake_case', 'kebab-case', 'any'];

/** A BPMNLabel is written without an id. */
const DI_WITH_IDS = ['bpmndi:BPMNDiagram', 'bpmndi:BPMNPlane', 'bpmndi:BPMNShape', 'bpmndi:BPMNEdge'];
const QUALIFIERS = ['off', 'optional', 'required'];

type Moddle = ReturnType<typeof createModdle>;

/**
 * Reads element-id-naming's options from a .bpmnlintrc through the rule's own resolution,
 * injected (the core never imports the plugin). What new ids cannot follow is left out, each
 * with a W_CONFIG_IGNORED note.
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

  /** `conventions` is undefined for no setting or severity off. */
  read(setting: BpmnlintRuleSetting | undefined): { conventions?: IdConventions; notes: ValidatorFinding[] } {
    const notes = this.notes;
    if (!setting || setting.severity === 'off') return { notes };
    const options = (setting.config ?? {}) as { prefixes?: Record<string, unknown>; case?: string; eventDefinitionQualifier?: string };
    const convention = new this.naming.ElementIdConvention(setting.config);
    const label = this.caseOf(options.case ?? 'camelCase', convention.case.label);
    const qualifier = this.qualifierOf(options.eventDefinitionQualifier, convention.qualifier);
    const moddle = createModdle();
    const ignored: string[] = [];
    this.noteUnusablePrefixes(options.prefixes ?? {});
    const table = this.typePrefixes(moddle, convention, ignored);
    if (qualifier !== 'off') this.qualifiedPrefixes(moddle, convention, table, qualifier, ignored);
    this.noteDiPrefixes(moddle, convention);
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

  /** An unknown case resolves to the rule's fallback, PascalCase. */
  private caseOf(configured: string, label: string): string {
    if (label !== configured) this.note('case', configured, `is unknown: the rule checks ${label}, and new ids take it`, `Write one of ${CASES.join(', ')} in the .bpmnlintrc.${this.didYouMean(configured, CASES)}`);
    return label;
  }

  private qualifierOf(configured: string | undefined, qualifier: QualifierMode): QualifierMode {
    if (configured !== undefined && configured !== qualifier) {
      this.note('eventDefinitionQualifier', configured, `is unknown: the rule and new ids take ${qualifier}`, `Write one of ${QUALIFIERS.join(', ')} in the .bpmnlintrc.${this.didYouMean(configured, QUALIFIERS)}`);
    }
    return qualifier;
  }

  /** Noted once per configured key: a supertype's prefix (bpmn:Gateway) covers several types. */
  private noteUnusablePrefixes(prefixes: Record<string, unknown>): void {
    for (const [type, prefix] of Object.entries(prefixes)) {
      if (!prefix || isUsablePrefix(prefix)) continue;
      const problem =
        typeof prefix === 'string' && /[^\x00-\x7f]/.test(prefix)
          ? 'has a character outside ASCII, which bpmn-cli does not write in ids'
          : 'cannot start an id (a letter or _ first, then letters, digits, _ . -, at most 56 characters)';
      this.note(`prefix of ${type}`, prefix, `${problem}: new ids of the type take bpmn-cli's own prefix, and the rule reports them`, `Fix the prefix in the .bpmnlintrc, or set it to false to switch ${type} off.`);
    }
  }

  private typePrefixes(moddle: Moddle, convention: ElementIdConvention, ignored: string[]): Record<string, string> {
    const table: Record<string, string> = {};
    const registry = (moddle as unknown as { registry: { packageMap: Record<string, { types: Array<{ name: string; isAbstract?: boolean }> }> } }).registry;
    for (const moddleType of registry.packageMap['bpmn']!.types) {
      if (moddleType.isAbstract) continue;
      const type = `bpmn:${moddleType.name}`;
      const prefix = convention.prefixOf(moddle.create(type, { id: 'x' }));
      if (prefix === null) continue;
      if (isUsablePrefix(prefix)) table[type] = prefix;
      else ignored.push(type);
    }
    return table;
  }

  /** A required qualified prefix too long for new ids is ignored (noted once): those ids take the plain prefix, which the rule reports. */
  private qualifiedPrefixes(moddle: Moddle, convention: ElementIdConvention, table: Record<string, string>, qualifier: QualifierMode, ignored: string[]): void {
    for (const def of KINDS) {
      const plain = table[def.type];
      if (plain === undefined || !def.triggers) continue;
      for (const trigger of def.triggers) {
        if (trigger === 'none') continue;
        const event = moddle.create(def.type, { id: 'x', eventDefinitions: [moddle.create(TRIGGERS[trigger].definition)] });
        const qualified = convention.prefixesFor(event).find((candidate) => candidate !== plain);
        const key = `${def.type}:${trigger}`;
        if (isUsablePrefix(qualified)) table[key] = qualified;
        else if (qualified !== undefined && qualifier === 'required' && !this.noted.has(key)) {
          this.noted.add(key);
          ignored.push(key);
          this.note(`prefix of ${key}`, qualified, `is longer than 56 characters (the ${def.type} prefix qualified with the trigger): new ids of such events take the plain prefix, and the rule reports them`, `Shorten the ${def.type} prefix in the .bpmnlintrc, or set eventDefinitionQualifier to optional.`);
        }
      }
    }
  }

  /**
   * bpmn-cli names DI after its element, never after a declared prefix, and the rule checks DI ids
   * too, so a declared DI prefix gets a note.
   */
  private noteDiPrefixes(moddle: Moddle, convention: ElementIdConvention): void {
    for (const type of DI_WITH_IDS) {
      const prefix = convention.prefixOf(moddle.create(type, { id: 'x' }));
      if (prefix !== null) this.note(`prefix of ${type}`, prefix, 'is not followed: bpmn-cli names DI after its element (BPMNShape_<id>, <id>_di), and the rule reports new DI ids', 'Set it to false or remove it; bpmn-js names DI <id>_di too.');
    }
  }
}
