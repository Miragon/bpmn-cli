/**
 * Declared id conventions (browser-safe): what a project's .bpmnlintrc says
 * about ids through @miragon/rules/element-id-naming, as plain data the core
 * takes (MutationOptions / EditOptions / NewDocOptions `conventions`;
 * src/idstyle.ts fills the gaps the file leaves with them), and the view of
 * the conventions new ids follow in a file (`bpmn show <file> --conventions`).
 *
 *   idConventionsFromLint(setting, naming, { source })  -> { conventions, notes }
 *   conventionsView(doc, conventions, opts)              -> ConventionsView (doc undefined: a new file)
 *   renderConventions(view)                              -> its text
 *
 * idConventionsFromLint reads the rule's options exactly as the rule does
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
 * its element (`<id>_di`, BPMNShape_<id>). Where none are declared the view
 * says why (Undeclared: --no-lint-config, no .bpmnlintrc, one that could
 * not be loaded, the rule off, no usable prefix).
 */
import type { BpmnlintRuleSetting, BpmnlintSeverity } from './bpmnlint.js';
import { closestKey } from './batch.js';
import type { Doc } from './document.js';
import { IdStyle, isUsablePrefix, kindRequest, typeRequest, type Body, type FlowForm, type IdRequest, type PrefixSource } from './idstyle.js';
import { KINDS, TRIGGER_TYPES } from './kinds.js';
import { createModdle } from './model.js';
import type { ValidatorFinding } from './validators.js';

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
const QUALIFIERS = ['off', 'optional', 'required'];

/** ` Did you mean X?` for a value close to one of `known` (closestKey: any case, - or _, a prefix, a small typo), else ''. */
function didYouMean(value: unknown, known: readonly string[]): string {
  const near = typeof value === 'string' && value ? closestKey(value, known) : undefined;
  return near ? ` Did you mean ${near}?` : '';
}

/**
 * The id conventions element-id-naming declares with its effective setting
 * (see the module header), and a W_CONFIG_IGNORED note for each value new
 * ids cannot follow; `source` names the .bpmnlintrc in the notes and the
 * results (default `.bpmnlintrc`). `conventions` is undefined where nothing
 * is declared (no setting, severity off, every prefix switched off).
 */
export function idConventionsFromLint(setting: BpmnlintRuleSetting | undefined, naming: IdNamingHelpers, opts: { source?: string } = {}): { conventions?: IdConventions; notes: ValidatorFinding[] } {
  const notes: ValidatorFinding[] = [];
  if (!setting || setting.severity === 'off') return { notes };
  const where = opts.source ?? '.bpmnlintrc';
  const note = (key: string, value: unknown, problem: string, hint: string): void => {
    const shown = JSON.stringify(value) ?? String(value);
    notes.push({ severity: 'warning', code: 'W_CONFIG_IGNORED', message: `${where}: ${ID_NAMING_RULE} ${key} ${shown} ${problem}`, hint, key: `config|${key}|${shown}` });
  };
  // the rule's own reading of its options (element-id-naming's factory)
  const options = (setting.config ?? {}) as { prefixes?: Record<string, string | false | null>; case?: string; eventDefinitionQualifier?: string };
  const { prefixes: overrides = {}, case: caseName = 'camelCase' } = options;
  const prefixes = { ...naming.DEFAULT_PREFIXES, ...overrides };
  // a name of JavaScript's Object (`toString`) reaches no case of the rule's table but a function without a label
  const resolved = (naming.resolveCase(caseName) as { label?: unknown } | undefined)?.label;
  const label = typeof resolved === 'string' && CASES.includes(resolved) ? resolved : 'PascalCase';
  const qualifier = naming.resolveQualifierMode(options.eventDefinitionQualifier);
  const caseHint = `Write one of ${CASES.join(', ')} in the .bpmnlintrc.${didYouMean(caseName, CASES)}`;
  if (label !== resolved) note('case', caseName, 'is unknown and the rule cannot check it: new ids take PascalCase, the fallback for an unknown case', caseHint);
  else if (label !== caseName) note('case', caseName, `is unknown: the rule checks ${label}, and new ids take it`, caseHint);
  if (options.eventDefinitionQualifier !== undefined && options.eventDefinitionQualifier !== qualifier) {
    note('eventDefinitionQualifier', options.eventDefinitionQualifier, `is unknown: the rule and new ids take ${qualifier}`, `Write one of ${QUALIFIERS.join(', ')} in the .bpmnlintrc.${didYouMean(options.eventDefinitionQualifier, QUALIFIERS)}`);
  }
  const moddle = createModdle();
  const table: Record<string, string> = {};
  const ignored: string[] = [];
  const noted = new Set<string>();
  const usable = (hit: { type: string; prefix: unknown }): boolean => {
    if (isUsablePrefix(hit.prefix)) return true;
    if (!noted.has(hit.type)) {
      noted.add(hit.type);
      const problem =
        typeof hit.prefix === 'string' && /[^\x00-\x7f]/.test(hit.prefix)
          ? 'has a character outside ASCII, which bpmn-cli does not write in ids'
          : 'cannot start an id (a letter or _ first, then letters, digits, _ . -, at most 56 characters)';
      note(`prefix of ${hit.type}`, hit.prefix, `${problem}: new ids of the type follow the learned id style, and the rule reports them`, `Fix the prefix in the .bpmnlintrc, or set it to false to switch ${hit.type} off.`);
    }
    return false;
  };
  // every concrete bpmn: type, as the rule resolves it (exact type, else its fallback order)
  const registry = (moddle as unknown as { registry: { packageMap: Record<string, { types: Array<{ name: string; isAbstract?: boolean }> }> } }).registry;
  for (const t of registry.packageMap['bpmn']!.types) {
    if (t.isAbstract) continue;
    const type = `bpmn:${t.name}`;
    const hit = naming.resolvePrefix(moddle.create(type, { id: 'x' }), prefixes);
    if (hit && usable(hit)) table[type] = hit.prefix;
    else if (hit) ignored.push(type);
  }
  // the qualified prefix of each event kind and trigger (timerStartEvent_), as the rule accepts it
  if (qualifier !== 'off') {
    for (const def of KINDS) {
      const plain = table[def.type];
      if (plain === undefined || !def.triggers) continue;
      for (const trigger of def.triggers) {
        if (trigger === 'none') continue;
        const event = moddle.create(def.type, { id: 'x', eventDefinitions: [moddle.create(TRIGGER_TYPES[trigger])] });
        const qualified = naming.acceptedPrefixes(event, plain, qualifier).find((p) => p !== plain);
        const key = `${def.type}:${trigger}`;
        if (isUsablePrefix(qualified)) table[key] = qualified;
        else if (qualified !== undefined && qualifier === 'required' && !noted.has(key)) {
          // the rule requires a qualified prefix new ids cannot have (too long): they follow the learned style, which it reports
          noted.add(key);
          ignored.push(key);
          note(`prefix of ${key}`, qualified, `is longer than 56 characters (the ${def.type} prefix qualified with the trigger): new ids of such events follow the learned id style, and the rule reports them`, `Shorten the ${def.type} prefix in the .bpmnlintrc, or set eventDefinitionQualifier to optional.`);
        }
      }
    }
  }
  if (!Object.keys(table).length) return { notes };
  const conventions: IdConventions = {
    prefixes: table,
    qualifier,
    ...(label !== 'any' ? { case: label as NonNullable<IdConventions['case']> } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    ...(ignored.length ? { ignored } : {}),
  };
  return { conventions, notes };
}

/* ------------------------------------------------------------------ */
/* the view                                                             */
/* ------------------------------------------------------------------ */

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

/** The note of an event kind, after the triggers whose qualified prefix the rule requires and new ids cannot have: they follow the file's style. */
const UNQUALIFIED_NOTE = "qualified prefix ignored, the file's style (W_CONFIG_IGNORED)";

/** The tail of a flow pattern after its head, by form. */
function flowTail(form: FlowForm, scope: string | undefined): string {
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

/**
 * The conventions new ids follow in a document (undefined: a new file),
 * with `conventions` declared over its own style (IdStyle.infer): one row
 * per pattern and source, the kinds that follow it; `opts`: the file, its
 * rule setting, the notes, where the .bpmnlintrc is and why it declares
 * none, as the node layer found them.
 */
export function conventionsView(
  doc: Doc | undefined,
  conventions: IdConventions | undefined,
  opts: { file?: string; severity?: BpmnlintSeverity; notes?: ValidatorFinding[]; where?: string; undeclared?: Undeclared } = {},
): ConventionsView {
  const style = doc ? IdStyle.infer(doc.definitions, conventions) : IdStyle.of(conventions);
  const declared = style.declared ? conventions : undefined;
  // a kind the rule does not name new ids after: unchecked, or checked with a prefix they cannot follow
  const unnamed = (type: string): string | undefined => (declared ? (declared.ignored?.includes(type) ? IGNORED_NOTE : 'not checked') : undefined);
  // the triggers of an event type whose qualified prefix the rule requires and new ids cannot have (`bpmn:EndEvent:message`)
  const unqualified = (type: string): string | undefined => {
    const triggers = (declared?.ignored ?? []).filter((key) => key.startsWith(`${type}:`)).map((key) => key.slice(type.length + 1));
    return triggers.length ? `${triggers.join(', ')}: ${UNQUALIFIED_NOTE}` : undefined;
  };
  // rows by pattern, source and note; a prefix that is the kind's own name is one row for all such kinds (<kind>_: serviceTask_, userTask_, ...)
  const groups: Array<ConventionsRow & { concrete: string }> = [];
  const add = (kind: string, concrete: string, pattern: string, source: PrefixSource, note?: string): void => {
    const row = groups.find((r) => r.pattern === pattern && r.source === source && r.note === note);
    if (row) row.kinds.push(kind);
    else groups.push({ concrete, pattern, source, kinds: [kind], ...(note ? { note } : {}) });
  };
  const element = (kind: string, type: string, req: IdRequest): void => {
    const { head, source, body } = style.explain(req);
    const own = head.toLowerCase() === `${kind.toLowerCase()}_` ? (/^[a-z]/.test(head) ? '<kind>_' : '<Kind>_') : head;
    const tail = `{name:${CASE_WORD[body]}}`;
    add(kind, `${head}${tail}`, `${own}${tail}`, source, source !== 'lint' ? unnamed(type) : unqualified(type));
  };
  for (const def of KINDS) element(def.kind, def.type, kindRequest(def));
  for (const type of ['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Message']) element(type.charAt(5).toLowerCase() + type.slice(6), type, typeRequest(type));
  for (const [kind, type] of [['sequenceFlow', 'bpmn:SequenceFlow'], ['messageFlow', 'bpmn:MessageFlow']] as const) {
    const f = style.explainFlow(type);
    // message flows the rule does not name: they take the sequence flows' prefix, unchecked
    const borrowed = kind === 'messageFlow' && f.source === 'lint' && !declared?.prefixes['bpmn:MessageFlow'];
    const pattern = `${f.head}${flowTail(f.form, f.style.scope)}`;
    add(kind, pattern, pattern, borrowed ? 'lint shape' : f.source, borrowed || f.source !== 'lint' ? unnamed(type) : undefined);
  }
  // a pattern of one kind reads as it is (Process_{name:pascal}, not <Kind>_)
  const rows: ConventionsRow[] = groups.map(({ concrete, ...row }) => (row.kinds.length === 1 ? { ...row, pattern: concrete } : row));
  const examples = ['bpmn:StartEvent:timer', 'bpmn:BoundaryEvent:message', 'bpmn:EndEvent:error'].map((k) => declared?.prefixes[k]).filter((p): p is string => !!p);
  const mode = declared?.qualifier ?? 'optional';
  const source = conventions?.source ?? opts.where;
  const undeclared = declared ? undefined : (opts.undeclared ?? (conventions ? 'no prefixes' : undefined));
  return {
    ...(opts.file !== undefined ? { file: opts.file } : {}),
    exists: !!doc,
    ...(source ? { source } : {}),
    ...(declared ? { rule: { severity: opts.severity ?? 'warn', case: declared.case ?? 'any', qualifier: mode } } : {}),
    ...(undeclared ? { undeclared } : {}),
    rows,
    ...(declared && mode !== 'off' && examples.length ? { qualified: { mode, examples } } : {}),
    notes: opts.notes ?? [],
  };
}

const SOURCE_WORDS: Record<PrefixSource, string> = {
  lint: 'element-id-naming',
  file: "the file's ids",
  'lint shape': 'shaped like the declared prefixes (the file shows none)',
  default: "bpmn-cli's default",
};

/** Why none are declared, as the second line says it (`where`: the .bpmnlintrc, or the host's conventions). */
const UNDECLARED_WORDS: Record<Undeclared, (where: string | undefined) => string> = {
  skipped: () => '--no-lint-config leaves the .bpmnlintrc out',
  'no config': () => 'no .bpmnlintrc applies here',
  'not loaded': (where) => `the ${where ?? '.bpmnlintrc'} could not be loaded (W_LINT_UNAVAILABLE below)`,
  off: (where) => `element-id-naming is off or not configured in the ${where ?? '.bpmnlintrc'}`,
  'no prefixes': (where) => `element-id-naming (${where ?? 'the host'}) declares no prefix new ids can follow`,
};

/** The text of `bpmn show <file> --conventions`. */
export function renderConventions(view: ConventionsView): string {
  const lines: string[] = [];
  lines.push(`conventions of ${view.file ?? 'the model'}${view.exists ? '' : ' (no file yet: a new model)'}`);
  if (view.rule) lines.push(`element-id-naming (${view.source ?? 'the host'}): ${view.rule.severity}, case ${view.rule.case}, eventDefinitionQualifier ${view.rule.qualifier}`);
  else if (view.undeclared) lines.push(`no id conventions: ${UNDECLARED_WORDS[view.undeclared](view.source)}; new ids follow the file's id style`);
  else lines.push("no id conventions declared: new ids follow the file's id style");
  const width = Math.max(...view.rows.map((r) => r.pattern.length));
  const sourceWidth = Math.max(...view.rows.map((r) => r.source.length));
  for (const r of view.rows) lines.push(`  ${r.pattern.padEnd(width)}  ${r.source.padEnd(sourceWidth)}  ${r.kinds.join(' ')}${r.note ? ` (${r.note})` : ''}`);
  if (view.qualified) {
    const except = view.rows.some((r) => r.note?.endsWith(UNQUALIFIED_NOTE)) ? ' (not the triggers marked above)' : '';
    const how = view.qualified.mode === 'required' ? `required, new ids take it${except}` : 'also accepted, new ids take the plain prefix';
    lines.push(`  events with a trigger: <trigger><Prefix> (${view.qualified.examples.join(', ')}) ${how}`);
  }
  const used = [...new Set(view.rows.map((r) => r.source))];
  lines.push(`sources: ${used.map((s) => `${s} = ${SOURCE_WORDS[s]}`).join('; ')}`);
  for (const n of view.notes) lines.push(`warning ${n.code}: ${n.message}${n.hint ? `  (${n.hint})` : ''}`);
  return lines.join('\n');
}
