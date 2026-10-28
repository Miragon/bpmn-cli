import type { BpmnlintSeverity } from './bpmnlint-rule-setting.js';
import type { Doc } from '../Doc.js';
import { KINDS } from '../Kinds.js';
import type { ValidatorFinding } from '../Finding.js';
import { IdStyle, type PrefixSource } from './IdStyle.js';
import { DEFAULT_ID_CONVENTIONS, type IdConventions, type QualifierMode } from './IdConventions.js';
import { kindRequest, typeRequest, type IdRequest } from '../utils/requests.js';

/**
 * Notes event triggers whose required qualified prefix new ids cannot have:
 * they take the plain prefix.
 */
export const UNQUALIFIED_NOTE = 'qualified prefix ignored, new ids take the plain one (W_CONFIG_IGNORED)';

export interface ConventionsRow {
  /** `serviceTask_{name:camel}`; `<kind>_{name:camel}` for kinds whose prefix is their own name */
  pattern: string;
  source: PrefixSource;
  kinds: string[];
  note?: string;
}

/** Why no id conventions are declared. */
export type Undeclared = 'skipped' | 'no config' | 'not loaded' | 'off';

/** Options of `conventionsXml`: the conventions to show and where they come from. */
export interface ConventionsXmlOptions {
  conventions?: IdConventions;
  file?: string;
  severity?: BpmnlintSeverity;
  notes?: ValidatorFinding[];
  where?: string;
  undeclared?: Undeclared;
}

export interface ConventionsView {
  file?: string;
  /** false: a new model, no file yet */
  exists: boolean;
  source?: string;
  rule?: { severity: string; case: string; qualifier: QualifierMode };
  undeclared?: Undeclared;
  rows: ConventionsRow[];
  /** the qualified prefixes (timerStartEvent_) element-id-naming accepts or requires */
  qualified?: { mode: 'optional' | 'required'; examples: string[] };
  notes: ValidatorFinding[];
}

const IGNORED_NOTE = 'checked; prefix ignored (W_CONFIG_IGNORED)';

/**
 * The conventions new ids follow in a file (`bpmn show <file> --conventions`):
 * the declared id conventions, else element-id-naming's defaults and why nothing is declared.
 */
export class ConventionsTable {
  private readonly style: IdStyle;
  /** a prefix that is the kind's own name is one row for all such kinds (<kind>_) */
  private readonly groups: Array<ConventionsRow & { concrete: string }> = [];

  constructor(
    private readonly doc: Doc | undefined,
    private readonly conventions: IdConventions | undefined,
  ) {
    this.style = IdStyle.of(conventions);
    for (const def of KINDS) this.element(def.kind, def.type, kindRequest(def));
    for (const type of ['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Message']) this.element(type.charAt(5).toLowerCase() + type.slice(6), type, typeRequest(type));
    for (const [kind, type] of [['sequenceFlow', 'bpmn:SequenceFlow'], ['messageFlow', 'bpmn:MessageFlow']] as const) this.flow(kind, type);
  }

  /** A row of one kind shows its concrete pattern (process_{name:camel}, not <kind>_). */
  view(opts: { file?: string; severity?: BpmnlintSeverity; notes?: ValidatorFinding[]; where?: string; undeclared?: Undeclared } = {}): ConventionsView {
    const declared = this.conventions;
    const followed = declared ?? DEFAULT_ID_CONVENTIONS;
    const rows: ConventionsRow[] = this.groups.map(({ concrete, ...row }) => (row.kinds.length === 1 ? { ...row, pattern: concrete } : row));
    const examples = ['bpmn:StartEvent:timer', 'bpmn:BoundaryEvent:message', 'bpmn:EndEvent:error'].map((key) => followed.prefixes[key]).filter((prefix): prefix is string => !!prefix);
    const mode = followed.qualifier ?? 'optional';
    const source = declared?.source ?? opts.where;
    const undeclared = declared ? undefined : opts.undeclared;
    return {
      ...(opts.file !== undefined ? { file: opts.file } : {}),
      exists: !!this.doc,
      ...(source ? { source } : {}),
      ...(declared ? { rule: { severity: opts.severity ?? 'warn', case: declared.case ?? 'any', qualifier: mode } } : {}),
      ...(undeclared ? { undeclared } : {}),
      rows,
      ...(mode !== 'off' && examples.length ? { qualified: { mode, examples } } : {}),
      notes: opts.notes ?? [],
    };
  }

  private add(kind: string, concrete: string, pattern: string, source: PrefixSource, note?: string): void {
    const row = this.groups.find((candidate) => candidate.pattern === pattern && candidate.source === source && candidate.note === note);
    if (row) row.kinds.push(kind);
    else this.groups.push({ concrete, pattern, source, kinds: [kind], ...(note ? { note } : {}) });
  }

  private element(kind: string, type: string, req: IdRequest): void {
    const { head, source, body } = this.style.explain(req);
    const own = head.toLowerCase() === `${kind.toLowerCase()}_` ? (/^[a-z]/.test(head) ? '<kind>_' : '<Kind>_') : head;
    const tail = `{name:${body}}`;
    const note = source === 'bpmn-cli' ? this.unchecked(type, head) : this.unqualified(type);
    this.add(kind, `${head}${tail}`, `${own}${tail}`, source, note);
  }

  private flow(kind: 'sequenceFlow' | 'messageFlow', type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow'): void {
    const { head, source, body } = this.style.explain(typeRequest(type));
    const join = body === 'snake' ? '_to_' : body === 'kebab' ? '-to-' : 'To';
    const pattern = `${head}{source}${join}{target}`;
    this.add(kind, pattern, pattern, source, source === 'bpmn-cli' ? this.unchecked(type, head) : undefined);
  }

  /** A named process takes its name alone, an unnamed one Process_1. */
  private unchecked(type: string, head: string): string {
    const checked = this.conventions?.ignored?.includes(type) ? IGNORED_NOTE : 'not checked';
    return head === '' ? `${checked}; unnamed: Process_1` : checked;
  }

  private unqualified(type: string): string | undefined {
    const triggers = (this.conventions?.ignored ?? []).filter((key) => key.startsWith(`${type}:`)).map((key) => key.slice(type.length + 1));
    return triggers.length ? `${triggers.join(', ')}: ${UNQUALIFIED_NOTE}` : undefined;
  }
}
