import type { BpmnlintSeverity } from './bpmnlint-rule-setting.js';
import type { Doc } from '../Doc.js';
import { KINDS } from '../utils/kinds.js';
import type { ValidatorFinding } from '../validator-finding.js';
import { IdStyle, type FlowForm, type PrefixSource } from './IdStyle.js';
import type { IdConventions, QualifierMode } from './IdConventionsReader.js';
import { kindRequest, typeRequest, type IdRequest } from '../utils/requests.js';
import { UNQUALIFIED_NOTE } from '../utils/conventions-text.js';

export interface ConventionsRow {
  /** `serviceTask_{name:camel}`; `<kind>_{name:camel}` for kinds whose prefix is their own name */
  pattern: string;
  source: PrefixSource;
  kinds: string[];
  note?: string;
}

/** Why no id conventions are declared. */
export type Undeclared = 'skipped' | 'no config' | 'not loaded' | 'off' | 'no prefixes';

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
 * the declared id conventions over the file's own style, or why none are declared.
 */
export class ConventionsTable {
  private readonly style: IdStyle;
  private readonly declared: IdConventions | undefined;
  /** a prefix that is the kind's own name is one row for all such kinds (<kind>_) */
  private readonly groups: Array<ConventionsRow & { concrete: string }> = [];

  constructor(
    private readonly doc: Doc | undefined,
    private readonly conventions: IdConventions | undefined,
  ) {
    this.style = doc ? IdStyle.infer(doc.definitions, conventions) : IdStyle.of(conventions);
    this.declared = this.style.declared ? conventions : undefined;
    for (const def of KINDS) this.element(def.kind, def.type, kindRequest(def));
    for (const type of ['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Message']) this.element(type.charAt(5).toLowerCase() + type.slice(6), type, typeRequest(type));
    for (const [kind, type] of [['sequenceFlow', 'bpmn:SequenceFlow'], ['messageFlow', 'bpmn:MessageFlow']] as const) this.flow(kind, type);
  }

  /** A row of one kind shows its concrete pattern (Process_{name:pascal}, not <Kind>_). */
  view(opts: { file?: string; severity?: BpmnlintSeverity; notes?: ValidatorFinding[]; where?: string; undeclared?: Undeclared } = {}): ConventionsView {
    const declared = this.declared;
    const conventions = this.conventions;
    const rows: ConventionsRow[] = this.groups.map(({ concrete, ...row }) => (row.kinds.length === 1 ? { ...row, pattern: concrete } : row));
    const examples = ['bpmn:StartEvent:timer', 'bpmn:BoundaryEvent:message', 'bpmn:EndEvent:error'].map((key) => declared?.prefixes[key]).filter((prefix): prefix is string => !!prefix);
    const mode = declared?.qualifier ?? 'optional';
    const source = conventions?.source ?? opts.where;
    const undeclared = declared ? undefined : (opts.undeclared ?? (conventions ? 'no prefixes' : undefined));
    return {
      ...(opts.file !== undefined ? { file: opts.file } : {}),
      exists: !!this.doc,
      ...(source ? { source } : {}),
      ...(declared ? { rule: { severity: opts.severity ?? 'warn', case: declared.case ?? 'any', qualifier: mode } } : {}),
      ...(undeclared ? { undeclared } : {}),
      rows,
      ...(declared && mode !== 'off' && examples.length ? { qualified: { mode, examples } } : {}),
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
    this.add(kind, `${head}${tail}`, `${own}${tail}`, source, source !== 'lint' ? this.unnamed(type) : this.unqualified(type));
  }

  /**
   * Message flows the rule does not name take the sequence flows' prefix, unchecked. A long head
   * is noted with its fallback (Flow_) where the ends do not fit beside it.
   */
  private flow(kind: 'sequenceFlow' | 'messageFlow', type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow'): void {
    const flowExplanation = this.style.explainFlow(type);
    const borrowed = kind === 'messageFlow' && flowExplanation.source === 'lint' && !this.declared?.prefixes['bpmn:MessageFlow'];
    const pattern = `${flowExplanation.head}${this.flowTail(flowExplanation.form, flowExplanation.style.scope)}`;
    const notes = [borrowed || flowExplanation.source !== 'lint' ? this.unnamed(type) : undefined, flowExplanation.fallback ? `${flowExplanation.fallback} where the ends do not fit` : undefined].filter((note): note is string => !!note);
    this.add(kind, pattern, pattern, borrowed ? 'lint shape' : flowExplanation.source, notes.length ? notes.join('; ') : undefined);
  }

  private unnamed(type: string): string | undefined {
    const declared = this.declared;
    return declared ? (declared.ignored?.includes(type) ? IGNORED_NOTE : 'not checked') : undefined;
  }

  private unqualified(type: string): string | undefined {
    const triggers = (this.declared?.ignored ?? []).filter((key) => key.startsWith(`${type}:`)).map((key) => key.slice(type.length + 1));
    return triggers.length ? `${triggers.join(', ')}: ${UNQUALIFIED_NOTE}` : undefined;
  }

  private flowTail(form: FlowForm, scope: string | undefined): string {
    switch (form) {
      case 'idPair':
        return '{sourceId}_{targetId}';
      case 'idSnake':
        return '{sourceId}_to_{targetId}';
      case 'stemTo':
        return '{sourceStem}To{TargetStem}';
      case 'stemSnake':
        return '{source_stem}_to_{target_stem}';
      case 'scopedTo':
        return `${scope}_{SourceWord}To{TargetWord}`;
      default:
        return '{source}To{target}';
    }
  }
}
