/**
 * The view of the conventions new ids follow in a file (`bpmn show <file>
 * --conventions`): the id conventions a project declares
 * (src/ids/IdConventionsReader.ts) over the file's own style. Where none are
 * declared the view says why (Undeclared: --no-lint-config, no .bpmnlintrc,
 * one that could not be loaded, the rule off, no usable prefix); its text is
 * src/ids/utils/conventions-text.ts renderConventions.
 */
import type { BpmnlintSeverity } from '../validate/bpmnlint-validator.js';
import type { Doc } from '../model/Doc.js';
import { KINDS } from '../model/kinds.js';
import type { ValidatorFinding } from '../validate/validators.js';
import { IdStyle, type Body, type FlowForm, type PrefixSource } from './IdStyle.js';
import type { IdConventions, QualifierMode } from './IdConventionsReader.js';
import { kindRequest, typeRequest, type IdRequest } from './utils/requests.js';
import { UNQUALIFIED_NOTE } from './utils/conventions-text.js';

/** One pattern of the view and the kinds that follow it. */
export interface ConventionsRow {
  /** the id pattern: `serviceTask_{name:camel}`, `<kind>_{name:camel}` for kinds whose prefix is their own name, `flow_{source}To{target}` */
  pattern: string;
  /** lint: element-id-naming; file: learned from the file's ids; lint shape: shaped like the declared prefixes (the file shows none); default: bpmn-cli's */
  source: PrefixSource;
  /** the kinds of `bpmn kinds`, and process, collaboration, message, sequenceFlow, messageFlow */
  kinds: string[];
  /**
   * what else to know (`not checked`: element-id-naming declares nothing for
   * it; `checked; prefix ignored (W_CONFIG_IGNORED)`: it checks them with a
   * prefix new ids cannot follow; `message, escalation: qualified prefix
   * ignored, ...`: under the qualifier `required` events with those
   * triggers, whose qualified prefix is too long, follow the file's style)
   */
  note?: string;
}

/**
 * Why no id conventions are declared: --no-lint-config, no .bpmnlintrc, one
 * that could not be loaded (W_LINT_UNAVAILABLE), element-id-naming off or
 * not configured in it, or no prefix new ids can follow.
 */
export type Undeclared = 'skipped' | 'no config' | 'not loaded' | 'off' | 'no prefixes';

/** `bpmn show <file> --conventions`: the conventions new ids follow in a file. */
export interface ConventionsView {
  file?: string;
  /** false: no file there yet (the ids `bpmn new` and the first changes give a new model) */
  exists: boolean;
  /** the .bpmnlintrc that applies (`.bpmnlintrc in models`), also where it declares none; absent: none */
  source?: string;
  /** element-id-naming's effective setting: severity, case, eventDefinitionQualifier */
  rule?: { severity: string; case: string; qualifier: QualifierMode };
  /** why none are declared (absent with `rule`, and where the caller does not say) */
  undeclared?: Undeclared;
  rows: ConventionsRow[];
  /** events with a trigger: the qualified prefixes (timerStartEvent_) element-id-naming also accepts (optional; new ids take the plain one) or requires (required) */
  qualified?: { mode: 'optional' | 'required'; examples: string[] };
  /** W_CONFIG_IGNORED: values of the rule's options new ids do not follow; W_LINT_UNAVAILABLE: what of the .bpmnlintrc is left out, or why it could not be loaded */
  notes: ValidatorFinding[];
}

const CASE_WORD: Record<Body, string> = { pascal: 'pascal', camel: 'camel', snake: 'snake', pascalSnake: 'pascalSnake' };

/** The note of a kind whose id element-id-naming checks with a prefix new ids cannot follow. */
const IGNORED_NOTE = 'checked; prefix ignored (W_CONFIG_IGNORED)';

export class ConventionsTable {
  private readonly style: IdStyle;
  private readonly declared: IdConventions | undefined;
  /** rows by pattern, source and note; a prefix that is the kind's own name is one row for all such kinds (<kind>_: serviceTask_, userTask_, ...) */
  private readonly groups: Array<ConventionsRow & { concrete: string }> = [];

  /** The conventions new ids follow in a document (undefined: a new file), with `conventions` declared over its own style (IdStyle.infer). */
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

  /**
   * One row per pattern and source, the kinds that follow it; `opts`: the
   * file, its rule setting, the notes, where the .bpmnlintrc is and why it
   * declares none, as the node layer found them.
   */
  view(opts: { file?: string; severity?: BpmnlintSeverity; notes?: ValidatorFinding[]; where?: string; undeclared?: Undeclared } = {}): ConventionsView {
    const declared = this.declared;
    const conventions = this.conventions;
    // a pattern of one kind reads as it is (Process_{name:pascal}, not <Kind>_)
    const rows: ConventionsRow[] = this.groups.map(({ concrete, ...row }) => (row.kinds.length === 1 ? { ...row, pattern: concrete } : row));
    const examples = ['bpmn:StartEvent:timer', 'bpmn:BoundaryEvent:message', 'bpmn:EndEvent:error'].map((k) => declared?.prefixes[k]).filter((p): p is string => !!p);
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
    const row = this.groups.find((r) => r.pattern === pattern && r.source === source && r.note === note);
    if (row) row.kinds.push(kind);
    else this.groups.push({ concrete, pattern, source, kinds: [kind], ...(note ? { note } : {}) });
  }

  private element(kind: string, type: string, req: IdRequest): void {
    const { head, source, body } = this.style.explain(req);
    const own = head.toLowerCase() === `${kind.toLowerCase()}_` ? (/^[a-z]/.test(head) ? '<kind>_' : '<Kind>_') : head;
    const tail = `{name:${CASE_WORD[body]}}`;
    this.add(kind, `${head}${tail}`, `${own}${tail}`, source, source !== 'lint' ? this.unnamed(type) : this.unqualified(type));
  }

  private flow(kind: 'sequenceFlow' | 'messageFlow', type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow'): void {
    const f = this.style.explainFlow(type);
    // message flows the rule does not name: they take the sequence flows' prefix, unchecked
    const borrowed = kind === 'messageFlow' && f.source === 'lint' && !this.declared?.prefixes['bpmn:MessageFlow'];
    const pattern = `${f.head}${this.flowTail(f.form, f.style.scope)}`;
    // a long head stays where the ends fit beside it: Flow_ elsewhere
    const notes = [borrowed || f.source !== 'lint' ? this.unnamed(type) : undefined, f.fallback ? `${f.fallback} where the ends do not fit` : undefined].filter((n): n is string => !!n);
    this.add(kind, pattern, pattern, borrowed ? 'lint shape' : f.source, notes.length ? notes.join('; ') : undefined);
  }

  /** A kind the rule does not name new ids after: unchecked, or checked with a prefix they cannot follow. */
  private unnamed(type: string): string | undefined {
    const declared = this.declared;
    return declared ? (declared.ignored?.includes(type) ? IGNORED_NOTE : 'not checked') : undefined;
  }

  /** The triggers of an event type whose qualified prefix the rule requires and new ids cannot have (`bpmn:EndEvent:message`). */
  private unqualified(type: string): string | undefined {
    const triggers = (this.declared?.ignored ?? []).filter((key) => key.startsWith(`${type}:`)).map((key) => key.slice(type.length + 1));
    return triggers.length ? `${triggers.join(', ')}: ${UNQUALIFIED_NOTE}` : undefined;
  }

  /** The tail of a flow pattern after its head, by form. */
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
