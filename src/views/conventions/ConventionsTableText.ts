import type { PrefixSource, QualifierMode, ValidatorFinding } from '../../model/index.js';

export interface ConventionsRow {
  pattern: string;
  source: PrefixSource;
  kinds: string[];
  note?: string | undefined;
}

export type Undeclared = 'no config' | 'not loaded' | 'off';

export interface ConventionsFacts {
  file?: string | undefined;
  exists: boolean;
  source?: string | undefined;
  rule?: { severity: string; case: string; qualifier: QualifierMode } | undefined;
  undeclared?: Undeclared | undefined;
  rows: ConventionsRow[];
  qualified?: { mode: 'optional' | 'required'; examples: string[] } | undefined;
  notes: ValidatorFinding[];
}

export class ConventionsTableText {
  private static readonly UNQUALIFIED_NOTE = /W_CONFIG_IGNORED\)$/;

  private static readonly SOURCE_WORDS: Readonly<Record<string, string>> = {
    lint: 'element-id-naming',
    default: "element-id-naming's defaults (nothing declared)",
    'bpmn-cli': "bpmn-cli's own prefix for a type element-id-naming does not check",
  };

  private static readonly UNDECLARED_WORDS: Readonly<Record<Undeclared, (where: string | undefined) => string>> = {
    'no config': () => 'no .bpmnlintrc applies here',
    'not loaded': (where) => `the ${where ?? '.bpmnlintrc'} could not be loaded (W_LINT_UNAVAILABLE below)`,
    off: (where) => `element-id-naming is off or not configured in the ${where ?? '.bpmnlintrc'}`,
  };

  constructor(private readonly result: ConventionsFacts) {}

  text(): string {
    const { file, exists, rows, notes } = this.result;
    const patternWidth = Math.max(...rows.map(({ pattern }) => pattern.length));
    const sourceWidth = Math.max(...rows.map(({ source }) => source.length));
    const used = [...new Set(rows.map(({ source }) => source))];
    return [
      `conventions of ${file ?? 'the model'}${exists ? '' : ' (no file yet: a new model)'}`,
      this.ruleLine(),
      ...rows.map(({ pattern, source, kinds, note }) => `  ${pattern.padEnd(patternWidth)}  ${source.padEnd(sourceWidth)}  ${kinds.join(' ')}${note ? ` (${note})` : ''}`),
      ...this.qualifiedLine(),
      `sources: ${used.map((source) => `${source} = ${ConventionsTableText.SOURCE_WORDS[source]}`).join('; ')}`,
      ...notes.map(({ code, message, hint }) => `warning ${code}: ${message}${hint ? `  (${hint})` : ''}`),
    ].join('\n');
  }

  private ruleLine(): string {
    const { rule, source, undeclared } = this.result;
    if (rule) {
      return `element-id-naming (${source ?? 'the host'}): ${rule.severity}, case ${rule.case}, eventDefinitionQualifier ${rule.qualifier}`;
    }
    const why = undeclared ? `no id conventions: ${ConventionsTableText.UNDECLARED_WORDS[undeclared](source)};` : 'no id conventions declared:';
    return `${why} new ids follow element-id-naming's defaults (case camelCase)`;
  }

  private qualifiedLine(): string[] {
    const { qualified, rows } = this.result;
    if (!qualified) {
      return [];
    }
    const except = rows.some(({ note }) => note && note.includes(':') && ConventionsTableText.UNQUALIFIED_NOTE.test(note)) ? ' (not the triggers marked above)' : '';
    const how = qualified.mode === 'required' ? `required, new ids take it${except}` : 'also accepted, new ids take the plain prefix';
    return [`  events with a trigger: <trigger><Prefix> (${qualified.examples.join(', ')}) ${how}`];
  }
}
