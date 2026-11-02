import { type IdConventions, kindsJson, type QualifierMode, type ValidatorFinding } from '../../api/index.js';

interface NamingConvention {
  prefixOf(node: unknown): string | null;
  prefixesFor(node: unknown): string[];
  readonly case: { label: string };
  readonly qualifier: QualifierMode;
}

export interface NamingPlugin {
  naming: { ElementIdConvention: new (config?: unknown) => NamingConvention; DEFAULT_PREFIXES: Record<string, string> };
  configs: Record<string, { rules?: Record<string, unknown> } | undefined>;
}

export interface NamingOptions {
  prefixes?: Record<string, unknown>;
  case?: string;
  eventDefinitionQualifier?: string;
}

export class NamingTable {
  private static readonly RULE = '@miragon/rules/element-id-naming';
  private static readonly CASES = ['camelCase', 'PascalCase', 'snake_case', 'kebab-case', 'any'];
  private static readonly QUALIFIERS = ['off', 'optional', 'required'];
  private static readonly DI_TYPES = ['bpmndi:BPMNDiagram', 'bpmndi:BPMNPlane', 'bpmndi:BPMNShape', 'bpmndi:BPMNEdge'];
  private static readonly FAMILY_TYPES: Readonly<Record<string, string>> = { task: 'bpmn:Task', subProcess: 'bpmn:SubProcess', gateway: 'bpmn:Gateway', event: 'bpmn:Event' };
  private static readonly ABSTRACT_TYPE = 'bpmn:Gateway';
  private static readonly MAX_PREFIX = 56;

  private readonly convention: NamingConvention;
  private readonly notes: ValidatorFinding[] = [];
  private readonly ignored: string[] = [];

  constructor(
    private readonly naming: NamingPlugin['naming'],
    private readonly options: NamingOptions | undefined,
    private readonly where: string,
  ) {
    this.convention = new naming.ElementIdConvention(options);
  }

  private static isUsable(prefix: unknown): prefix is string {
    return typeof prefix === 'string' && prefix.length <= NamingTable.MAX_PREFIX && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(`${prefix}a`);
  }

  private static node(type: string, family: string | undefined, definition?: string): unknown {
    const ancestor = family === undefined ? undefined : NamingTable.FAMILY_TYPES[family];
    return { $type: type, id: 'x', $instanceOf: (asked: string) => asked === type || asked === ancestor, eventDefinitions: definition ? [{ $type: definition }] : [] };
  }

  read(): { conventions: IdConventions; notes: ValidatorFinding[] } {
    const label = this.caseOf(this.options?.case ?? 'camelCase', this.convention.case.label);
    const qualifier = this.qualifierOf(this.options?.eventDefinitionQualifier, this.convention.qualifier);
    this.noteUnusablePrefixes(this.options?.prefixes ?? {});
    const table = this.typePrefixes();
    if (qualifier !== 'off') {
      this.addQualifiedPrefixes(table, qualifier);
    }
    this.noteDiagramPrefixes();
    const conventions: IdConventions = {
      prefixes: table,
      qualifier,
      ...(label === 'any' ? {} : { case: label as NonNullable<IdConventions['case']> }),
      source: this.where,
      ...(this.ignored.length ? { ignored: this.ignored } : {}),
    };
    return { conventions, notes: this.notes };
  }

  private note(key: string, value: unknown, problem: string, hint: string): void {
    const shown = JSON.stringify(value) ?? String(value);
    this.notes.push({ severity: 'warning', code: 'W_CONFIG_IGNORED', message: `${this.where}: ${NamingTable.RULE} ${key} ${shown} ${problem}`, hint, key: `config|${key}|${shown}` });
  }

  private caseOf(configured: string, label: string): string {
    if (label !== configured) {
      this.note('case', configured, `is unknown: the rule checks ${label}, and new ids take it`, `Write one of ${NamingTable.CASES.join(', ')} in the .bpmnlintrc.`);
    }
    return label;
  }

  private qualifierOf(configured: string | undefined, qualifier: QualifierMode): QualifierMode {
    if (configured !== undefined && configured !== qualifier) {
      this.note('eventDefinitionQualifier', configured, `is unknown: the rule and new ids take ${qualifier}`, `Write one of ${NamingTable.QUALIFIERS.join(', ')} in the .bpmnlintrc.`);
    }
    return qualifier;
  }

  private noteUnusablePrefixes(prefixes: Record<string, unknown>): void {
    for (const [type, prefix] of Object.entries(prefixes)) {
      if (prefix && !NamingTable.isUsable(prefix)) {
        const problem = typeof prefix === 'string' && /[^\x00-\x7f]/.test(prefix) ? 'has a character outside ASCII, which bpmn-cli does not write in ids' : 'cannot start an id (a letter or _ first, then letters, digits, _ . -, at most 56 characters)';
        this.note(`prefix of ${type}`, prefix, `${problem}: new ids of the type take bpmn-cli's own prefix, and the rule reports them`, `Fix the prefix in the .bpmnlintrc, or set it to false to switch ${type} off.`);
      }
    }
  }

  private typePrefixes(): Record<string, string> {
    const families = new Map<string, string>(kindsJson().kinds.map(({ type, family }) => [type, family]));
    const configured = [...Object.keys(this.naming.DEFAULT_PREFIXES), ...Object.keys(this.options?.prefixes ?? {})];
    const types = new Set([...families.keys(), ...configured.filter((type) => type.startsWith('bpmn:') && type !== NamingTable.ABSTRACT_TYPE)]);
    const table: Record<string, string> = {};
    for (const type of types) {
      const prefix = this.convention.prefixOf(NamingTable.node(type, families.get(type)));
      if (NamingTable.isUsable(prefix)) {
        table[type] = prefix;
      } else if (prefix !== null) {
        this.ignored.push(type);
      }
    }
    return table;
  }

  private addQualifiedPrefixes(table: Record<string, string>, qualifier: QualifierMode): void {
    const { kinds, triggers } = kindsJson();
    const definitions = new Map(triggers.map(({ trigger, type }) => [trigger, type]));
    for (const { type, family, triggers: ofKind = [] } of kinds) {
      const plain = table[type];
      for (const trigger of plain === undefined ? [] : ofKind.filter((candidate) => candidate !== 'none')) {
        const event = NamingTable.node(type, family, definitions.get(trigger));
        const qualified = this.convention.prefixesFor(event).find((candidate) => candidate !== plain);
        this.addQualified(table, `${type}:${trigger}`, qualified, qualifier);
      }
    }
  }

  private addQualified(table: Record<string, string>, key: string, qualified: string | undefined, qualifier: QualifierMode): void {
    if (NamingTable.isUsable(qualified)) {
      table[key] = qualified;
    } else if (qualified !== undefined && qualifier === 'required' && !this.ignored.includes(key)) {
      const type = key.slice(0, key.lastIndexOf(':'));
      this.ignored.push(key);
      this.note(`prefix of ${key}`, qualified, `is longer than 56 characters (the ${type} prefix qualified with the trigger): new ids of such events take the plain prefix, and the rule reports them`, `Shorten the ${type} prefix in the .bpmnlintrc, or set eventDefinitionQualifier to optional.`);
    }
  }

  private noteDiagramPrefixes(): void {
    for (const type of NamingTable.DI_TYPES) {
      const prefix = this.convention.prefixOf(NamingTable.node(type, undefined));
      if (prefix !== null) {
        this.note(`prefix of ${type}`, prefix, 'is not followed: bpmn-cli names DI after its element (BPMNShape_<id>, <id>_di), and the rule reports new DI ids', 'Set it to false or remove it; bpmn-js names DI <id>_di too.');
      }
    }
  }
}
