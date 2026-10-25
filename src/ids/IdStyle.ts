import { camelSlug, cutAt, cutName, hasIdWords, idWords, isFiller, isValidId, MAX_ID, MAX_SLUG, nameWords, pascalSnakeSlug, slugify, snakeSlug, withSuffix } from './utils/slug.js';
import type { IdRegistry } from './IdRegistry.js';
import { FORM_JOIN, IdFitter, LEGACY_BASE } from './IdFitter.js';
import { caseLike, CONTEXT_WORDS, kindWord, PREFIXED, speakingStem, stemWords } from './utils/id-words.js';
import { CONNECTIONS, connectionRequest, kindRequest, typeRequest, type IdRequest } from './utils/requests.js';
import type { IdConventions } from './IdConventionsReader.js';
import { DeclaredConventions } from './DeclaredConventions.js';
import { DEFAULT_FLOW, LearnedStyle } from './LearnedStyle.js';
import { kindByName } from '../model/utils/kinds.js';
import type { El } from '../model/utils/moddle.js';

/** The case of the bodies of new ids. */
export type Body = 'pascal' | 'camel' | 'snake' | 'pascalSnake';
export type FlowForm = 'named' | 'stemTo' | 'idPair' | 'stemSnake' | 'idSnake' | 'scopedTo';

export interface FlowStyle {
  form: FlowForm;
  prefix: string;
  sep?: string;
  scope?: string;
  /** a declared prefix with its separator (`flow_`), which replaces `<prefix>_` */
  head?: string;
}

export interface IdStyleInfo {
  body: Body;
  sequenceFlow: FlowStyle;
  messageFlow: FlowStyle;
}

export type PrefixSource = 'lint' | 'file' | 'lint shape' | 'default';

export interface IdState {
  type: string;
  trigger?: string;
}

/**
 * Under declared conventions these keep bpmn-cli's own ids unless declared exactly: learning
 * them from declared-prefix ids would drift (process_supplier, then process_back_office).
 */
const FILE_LEVEL = new Set(['bpmn:Process', 'bpmn:Definitions']);

/** Their prefix says the kind, so an unnamed one's id leaves it out (Gateway_AfterCheck). */
const SPELLABLE = new Set([
  'task',
  'userTask',
  'serviceTask',
  'scriptTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'businessRuleTask',
  'subProcess',
  'adHocSubProcess',
  'transaction',
  'callActivity',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'complexGateway',
  'eventBasedGateway',
]);

/**
 * The id conventions of a document, so that new ids look like the ones it already has and every
 * new id says what it names (never a hash or a running number). Declared conventions from the
 * .bpmnlintrc fill the gaps; existing ids are never renamed for them.
 */
export class IdStyle {
  private constructor(
    private readonly l: LearnedStyle,
    private readonly d?: DeclaredConventions,
    /** with declared conventions `l` leaves out the ids a declared prefix covers; this does not */
    private readonly all: LearnedStyle = l,
  ) {}

  static readonly DEFAULT = new IdStyle(new LearnedStyle(undefined));

  static infer(defs: El, conventions?: IdConventions): IdStyle {
    const d = DeclaredConventions.of(conventions);
    if (!d) return new IdStyle(new LearnedStyle(defs));
    return new IdStyle(new LearnedStyle(defs, d), d, new LearnedStyle(defs));
  }

  static of(conventions?: IdConventions): IdStyle {
    const d = DeclaredConventions.of(conventions);
    return d ? new IdStyle(new LearnedStyle(undefined), d) : IdStyle.DEFAULT;
  }

  static keyRequest(key: string): IdRequest {
    const def = kindByName(key);
    return def ? kindRequest(def) : typeRequest(key);
  }

  get declared(): boolean {
    return this.d !== undefined;
  }

  /**
   * Only where the file has checked ids that do not follow the declared conventions is a new id
   * under a declared prefix one the file's own style would give otherwise.
   */
  get ownStyleDiffers(): boolean {
    return this.l.unconforming;
  }

  private processMemo: { prefix: string; body: Body } | null | undefined;

  private processStyle(): { prefix: string; body: Body } | undefined {
    if (this.processMemo === undefined) this.processMemo = this.l.processStyle(() => this.caseFor()) ?? null;
    return this.processMemo ?? undefined;
  }

  private fileLevel(req: IdRequest): boolean {
    return !!this.d && FILE_LEVEL.has(req.key) && this.declaredHead(req) === undefined && !(req.key === 'bpmn:Process' && this.processStyle());
  }

  private own: IdStyle | undefined;

  learnedOnly(): IdStyle {
    return this.d ? (this.own ??= new IdStyle(this.all)) : this;
  }

  info(): IdStyleInfo {
    const sequenceFlow = this.flowOf('bpmn:SequenceFlow');
    return { body: this.caseFor(), sequenceFlow, messageFlow: this.flowOf('bpmn:MessageFlow') };
  }

  /**
   * A declared prefix replaces the file's, with the `named` form under a declared case (the one
   * form whose body passes it). Message flows borrow the sequence flows' until they show a style.
   */
  private flowOf(type: string): FlowStyle {
    const d = this.d;
    if (!d) return this.l.flowOf(type);
    const borrowed = this.l.showsFlowStyle(type) ? undefined : d.borrowedHead(type);
    const learned = this.l.flowOf(borrowed === undefined ? type : 'bpmn:SequenceFlow');
    const head = d.prefixes[type] ?? borrowed;
    if (head === undefined) return learned;
    return { ...learned, form: d.case ? 'named' : learned.form, head };
  }

  private declaredHead(req: IdRequest): string | undefined {
    return this.d?.headFor(this.typeOf(req.key), req.trigger);
  }

  private declares(req: IdRequest): boolean {
    if (!this.d) return false;
    return CONNECTIONS.has(req.key) ? this.flowOf(req.key).head !== undefined : this.declaredHead(req) !== undefined;
  }

  private caseFor(req?: IdRequest): Body {
    const own = req?.key === 'bpmn:Process' && !this.declares(req) ? this.processStyle() : undefined;
    if (own) return own.body;
    if (!this.d) return this.l.body;
    if (req && this.declares(req)) return this.d.case ?? this.all.body;
    if (this.l.bodyVoted) return this.l.body;
    if (!this.d.case) return this.all.body;
    return this.l.otherShape(this.d) ? this.l.body : this.d.case;
  }

  /** No `_` in the body and a letter first: a glued suffix, `<id>Join`, a kind word first. */
  private lettersOnly(req: IdRequest): boolean {
    return this.declares(req) && (this.d!.case === 'camel' || this.d!.case === 'pascal');
  }

  private sepFor(req: IdRequest): string {
    return this.lettersOnly(req) ? '' : '_';
  }

  suffixSep(key: string): string {
    return this.sepFor(IdStyle.keyRequest(key));
  }

  /** '' only with `bare`: a named element's id can do without a prefix, an unnamed one cannot. */
  prefixFor(req: IdRequest, bare = true): string {
    return this.learnedPrefix(req, bare).prefix;
  }

  private learnedPrefix(req: IdRequest, bare = true): { prefix: string; source: PrefixSource } {
    const processes = req.key === 'bpmn:Process' ? this.processStyle() : undefined;
    if (processes) return { prefix: processes.prefix, source: 'file' };
    return this.l.prefixOf(req, bare, this.d);
  }

  private bodyOf(text: string | undefined, c: Body = this.l.body): string {
    switch (c) {
      case 'camel':
        return camelSlug(text);
      case 'snake':
        return snakeSlug(text);
      case 'pascalSnake':
        return pascalSnakeSlug(text);
      default:
        return slugify(text);
    }
  }

  /** Never snake_case: it would read as a prefix. */
  private bareBody(name: string | undefined): string {
    const body = this.l.bareBody === 'pascal' ? slugify(name) : camelSlug(name);
    return body && isValidId(body) && !PREFIXED.test(body) ? body : '';
  }

  /**
   * A kind word and the context (`Timer On Review`); `spelled` adds the kind word a gateway's or
   * activity's prefix otherwise says (`Parallel After Check invoice`).
   */
  private unnamedText(req: IdRequest, spelled = false, head?: string): string {
    const context = nameWords(req.context).length ? req.context! : '';
    const word = kindWord(req.key, req.trigger, !!context && !spelled);
    return `${head === undefined ? word : this.unsaid(word, head)} ${context}`.trim();
  }

  /** `qualified`: the context ends with the anchor's kind, which a cut leaves in place. */
  private derived(req: IdRequest, spelled = false, qualified = false, max = MAX_ID): string {
    const named = hasIdWords(req.name);
    const c = this.caseFor(req);
    const head = this.declaredHead(req);
    if (head !== undefined) {
      const room = max - head.length;
      const body = this.declaredBody(named ? req.name! : this.unnamedText(req, spelled, head), req, head, c);
      if (qualified && !named && req.anchorKind) return `${head}${this.withWord(body, req.anchorKind, Math.min(room, MAX_SLUG), c)}`;
      if (req.tailWord) return `${head}${this.withWord(body, req.tailWord, room, c)}`;
      return `${head}${this.cutBody(body, room, c)}`;
    }
    const prefix = this.prefixFor(req);
    if (prefix === '' && named) {
      const bare = this.bareBody(req.name);
      if (bare) return req.tailWord ? this.withWord(bare, req.tailWord, max, this.l.bareBody) : this.cutBody(bare, max, this.l.bareBody);
    }
    // an unnamed element keeps a prefix in a file whose named ids have none
    let p = prefix === '' ? this.prefixFor(req, false) : prefix;
    const body = this.bodyOf(named ? req.name : this.unnamedText(req, spelled), c) || this.bodyOf(kindWord(req.key, req.trigger), c);
    /**
     * A prefix that leaves under 8 characters beside `_99` stays where the body's lead fits beside
     * it whole, else the bpmn-cli prefix takes its place (activity_auftrag).
     */
    if (MAX_ID - p.length - 1 - 3 < 8 && this.leadOf(body, !named).length > max - p.length - 1) p = caseLike(req.prefix, /^[a-z]/.test(p));
    const room = max - p.length - 1;
    if (qualified && !named && req.anchorKind) return `${p}_${this.withWord(body, req.anchorKind, Math.min(room, MAX_SLUG), c)}`;
    if (req.tailWord) return `${p}_${this.withWord(body, req.tailWord, room, c)}`;
    return `${p}_${this.cutBody(body, room, c)}`;
  }

  /**
   * A body that would begin with a number under camelCase / PascalCase begins with the kind word,
   * minus what the prefix says (startEvent_timer1stOfMonth, scriptTask_scriptTask4Augen).
   */
  private declaredBody(text: string, req: IdRequest, head: string, c: Body): string {
    const body = this.bodyOf(text, c);
    if (body && !(this.lettersOnly(req) && /^[0-9]/.test(body))) return body;
    const word = kindWord(req.key, req.trigger);
    return this.bodyOf(`${this.unsaid(word, head) || word} ${text}`, c);
  }

  /** The body is cut so the word stays; under 8 characters left, both are cut as one. */
  private withWord(body: string, word: string, max: number, c: Body): string {
    const tail = c === 'snake' ? `_${snakeSlug(word)}` : c === 'pascalSnake' ? `_${pascalSnakeSlug(word)}` : slugify(word);
    return max - tail.length >= 8 ? `${cutName(body, max - tail.length)}${tail}` : cutName(`${body}${tail}`, max);
  }

  /** A taken unnamed gateway or activity spells its kind (Gateway_ParallelAfterCheck). */
  private spelledBase(req: IdRequest): string | undefined {
    if (!SPELLABLE.has(req.key) || hasIdWords(req.name) || !nameWords(req.context).length) return undefined;
    const word = kindWord(req.key, req.trigger).toLowerCase();
    const prefix = (this.declaredHead(req) ?? (this.prefixFor(req) || this.prefixFor(req, false))).toLowerCase();
    if (prefix.includes(word)) return undefined;
    return this.derived(req, true);
  }

  /** An id that repeats its unnamed anchor's names the anchor's kind (Task_AfterCheckGateway). */
  private qualifiedBase(req: IdRequest): string | undefined {
    if (!req.anchorKind || hasIdWords(req.name) || !nameWords(req.context).length) return undefined;
    return this.derived(req, false, true);
  }

  derivedBase(req: IdRequest): string {
    return this.wanted(req).base;
  }

  /**
   * Every id the request may have been given before (uncut, cut for a suffix, as 0.6 cut it, in
   * every other flow style the file shows), so a flow named earlier still names its ends.
   * `id` limits this to the styles it can belong to.
   */
  derivedBases(req: IdRequest, id?: string): string[] {
    const own = this.basesOf(req, id);
    return this.d ? [...new Set([...own, ...this.learnedOnly().basesOf(req, id)])] : own;
  }

  private basesOf(req: IdRequest, id?: string): string[] {
    if (!this.isConnection(req)) {
      const uncut = this.wanted(req, Infinity).base;
      return uncut.length <= MAX_ID - 4 ? [uncut] : [...new Set([...[0, 1, 2, 3, 4].map((suffix) => this.wanted(req, MAX_ID - suffix).base), uncut])];
    }
    const style = this.flowOf(req.key);
    const bases = this.connectionBases(req, style);
    if (style.head === undefined) for (const other of this.l.otherFlowStyles(req.key)) if (id === undefined || this.mayBeOf(id, other)) bases.push(...this.connectionBases(req, other));
    return [...new Set(bases)];
  }

  private connectionBases(req: IdRequest, style: FlowStyle): string[] {
    const at = (max: number, legacy = false): string => this.connectionBase(req, max, legacy, style).base;
    const uncut = at(Infinity);
    const legacy = at(LEGACY_BASE, true);
    return [...(uncut.length <= MAX_ID - 4 ? [] : [0, 1, 2, 3, 4].map((suffix) => at(MAX_ID - suffix))), legacy, cutAt(legacy, MAX_ID - 4, true), at(Infinity, true), uncut];
  }

  private wanted(req: IdRequest, max = MAX_ID): { base: string; sep: string } {
    if (this.isConnection(req)) return this.connectionBase(req, max);
    if (this.fileLevel(req)) return IdStyle.DEFAULT.wanted(req, max);
    return { base: this.derived(req, false, false, max), sep: this.sepFor(req) };
  }

  explain(req: IdRequest): { head: string; source: PrefixSource; body: Body } {
    const head = this.declaredHead(req);
    if (head !== undefined) return { head, source: 'lint', body: this.caseFor(req) };
    if (this.fileLevel(req)) return IdStyle.DEFAULT.explain(req);
    const { prefix, source } = this.learnedPrefix(req);
    return { head: prefix ? `${prefix}_` : '', source, body: this.caseFor(req) };
  }

  /** `fallback`: Flow_ where a long head leaves the ends too little room. */
  explainFlow(type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow'): { style: FlowStyle; head: string; form: FlowForm; fallback?: string; source: PrefixSource; body: Body } {
    const style = this.flowOf(type);
    const source: PrefixSource = style.head !== undefined ? 'lint' : this.l.hasFlows(type) ? 'file' : 'default';
    const body = this.caseFor(connectionRequest(type, '', ''));
    return { style, ...this.effectiveHead(style, body), source, body };
  }

  /**
   * W_ID_PREFIX_STALE: a retype or trigger change kept an id whose prefix the declared conventions
   * no longer accept. Suggests the new prefix with the rest of the id where that passed the rule,
   * else the id `now` wants (never the old kind's words). Ids are never renamed for this.
   */
  stalePrefix(id: string, from: IdState, to: IdState, now?: IdRequest): { was?: string; heads: string[]; suggested: string } | undefined {
    const d = this.d;
    if (!d) return undefined;
    const heads = d.headsOf(to);
    if (!heads.length || d.acceptsId(id, to)) return undefined;
    const was = d.headOf(id, from);
    if (was === undefined && d.headsOf(from).length) return undefined;
    // userTask_checkOrder under the prefix `user` starts with it by accident (Task_ completes it)
    const rest = was === undefined ? undefined : id.slice(was.length);
    const own = rest !== undefined && /[A-Za-z0-9]$/.test(was!) ? PREFIXED.exec(rest) : null;
    const accidental = own && `${was}${own[1]}`.toLowerCase() === from.type.slice(from.type.indexOf(':') + 1).toLowerCase() ? own : null;
    if (now && (rest === undefined || accidental || !d.inDeclaredCase(id, from))) {
      const words = rest === undefined ? (speakingStem(id) ?? '') : accidental ? accidental[2]! : rest;
      const suggested = this.derivedBase(hasIdWords(now.name) ? now : { ...now, context: stemWords(words).join(' ') });
      return isValidId(suggested) ? { ...(was !== undefined ? { was } : {}), heads, suggested } : undefined;
    }
    if (was === undefined) return undefined;
    const head = d.headFor(to.type, to.trigger)!;
    const suggested = `${head}${id.slice(was.length)}`;
    return isValidId(suggested) ? { was, heads, suggested } : undefined;
  }

  /**
   * The id of a split's join gateway (`<id>_join`, `<id>Join`). A split id outside the declared
   * conventions gives the declared prefix with its label (Gateway_Check -> gateway_checkJoin).
   */
  joinId(gatewayId: string, key = 'exclusiveGateway', label = speakingStem(gatewayId) ?? gatewayId): string {
    const req = IdStyle.keyRequest(key);
    const head = this.declaredHead(req);
    const state = { type: this.typeOf(key) };
    if (head !== undefined && !this.d!.inDeclaredCase(gatewayId, state)) {
      const c = this.caseFor(req);
      const own = this.d!.headOf(gatewayId, state);
      const body = own === undefined ? '' : stemWords(gatewayId.slice(own.length)).join(' ');
      return `${head}${this.withWord(this.declaredBody(hasIdWords(body) ? body : label, req, head, c), 'Join', MAX_ID - head.length, c)}`;
    }
    const base = cutAt(gatewayId, MAX_ID - '_join'.length);
    if (head !== undefined && this.d!.case) return this.d!.case === 'snake' ? `${base}_join` : `${base}Join`;
    if (!gatewayId.includes('_') && this.l.hasBareNodes) return `${base}Join`;
    switch (this.caseFor(req)) {
      case 'camel':
        return `${base}Join`;
      case 'pascalSnake':
        return `${base}_Join`;
      default:
        return `${base}_join`;
    }
  }

  /**
   * A free id (not claimed) and the id it wanted. A taken unnamed gateway or activity first
   * spells its kind, then names its anchor's kind, before a collision suffix; the same request
   * on the same document always gives the same id.
   */
  next(req: IdRequest, ids: IdRegistry): { id: string; base: string } {
    const wanted = this.wanted(req);
    const { sep } = wanted;
    let { base } = wanted;
    const qualified = CONNECTIONS.has(req.key) ? undefined : this.qualifiedBase(req);
    const others = CONNECTIONS.has(req.key) ? [] : [this.spelledBase(req), qualified].filter((x): x is string => !!x && x !== base);
    const clash = (id: string): boolean => ids.has(id) || ids.bodyTaken(id);
    if (others.length && clash(base)) {
      const pick = others.find((x) => !clash(x)) ?? others.find((x) => !ids.has(x));
      if (pick) return { id: pick, base: pick };
      // the base is taken only by its body: suffix the form that names the anchor
      if (qualified && !ids.has(base)) base = qualified;
    }
    let id = base;
    const recut = (max: number): { base: string; sep: string } => (base === qualified ? { base: this.derived(req, false, true, max), sep } : this.wanted(req, max));
    const suffixed = (n: number): string => {
      let given: { base: string; sep: string } | undefined;
      const out = withSuffix(base, sep, n, (max) => {
        const c = recut(max);
        if (c.sep !== sep) given ??= c;
        return c.base;
      });
      if (!given) return out;
      // a long head that gives way to Flow_ in the cut for the suffix: the whole id takes that form
      const suffix = `${given.sep}${n}`;
      const room = recut(MAX_ID - suffix.length);
      return `${room.sep === given.sep ? room.base : given.base}${suffix}`;
    };
    for (let n = 2; ids.has(id); n++) id = suffixed(n);
    return { id, base };
  }

  /**
   * A head that leaves the ends under 16 characters stays per flow where they fit beside it at
   * whole words, else gives way to Flow_, so one file can hold both forms (0.6 kept the head).
   */
  private connectionBase(req: IdRequest, max: number, legacy = false, style = this.flowOf(req.key)): { base: string; sep: string } {
    const { form, prefix, sep, scope, head } = style;
    if (head !== undefined) return this.declaredFlowBase(req, max, form, head, legacy);
    if (form === 'named') return { base: this.namedBase(req, max, prefix, sep, legacy), sep: '_' };
    const long = (head: string, join: string): boolean => !legacy && MAX_ID - head.length - join.length < 16;
    if (form === 'scopedTo') {
      const s = req.source!;
      const t = req.target!;
      const own = this.scopeOf(req, scope!);
      const head = `${prefix}_${own}_`;
      const fitter = new IdFitter({ legacy, suffixSep: '' });
      const [a, b] = [fitter.endWord(s, own, 'Start'), fitter.endWord(t, own, 'End')];
      if (legacy) return { base: cutAt(`${head}${a}To${b}`, max, true), sep: '' };
      const base = long(head, 'To') ? fitter.whole(head, a, 'To', b, max) : fitter.pair(head, a, 'To', b, max);
      return base !== undefined ? { base, sep: '' } : { base: this.namedBase({ ...req, sourceLabel: a, targetLabel: b }, max, DEFAULT_FLOW.prefix, undefined, false), sep: '_' };
    }
    const own = form === 'stemTo' ? '' : '_';
    const fitter = new IdFitter({ legacy });
    if (!long(`${prefix}_`, FORM_JOIN[form])) return { base: fitter.idForm(form, `${prefix}_`, req, max), sep: own };
    const base = fitter.wholeIdForm(form, `${prefix}_`, req, max);
    return base !== undefined ? { base, sep: own } : { base: this.namedBase(req, max, DEFAULT_FLOW.prefix, undefined, false), sep: '_' };
  }

  /** The scope an end names in its id (KotO in serviceTask_KotO_Validate), else the most used. */
  private scopeOf(req: IdRequest, scope: string): string {
    const scopes = this.l.scopesOf(req.key) ?? [scope];
    return scopes.find((x) => req.source!.split('_').includes(x) || req.target!.split('_').includes(x)) ?? scope;
  }

  /**
   * A declared head never gives way to Flow_. The ends leave out the file's scope segment, and
   * one that begins with a number is written `From...` where the case wants a letter first.
   */
  private declaredFlowBase(req: IdRequest, max: number, form: FlowForm, head: string, legacy: boolean): { base: string; sep: string } {
    const sep = this.sepFor(req);
    if (form === 'named') {
      const c = this.caseFor(req);
      const scopes = this.l.scopesOf(req.key) ?? [];
      const label = (id: string, given: string | undefined): string => {
        const text = given && nameWords(given).length ? given : (speakingStem(id) ?? id);
        return (scopes.length && text.split('_').filter((x) => !scopes.includes(x)).join('_')) || text;
      };
      const source = label(req.source!, req.sourceLabel);
      const target = label(req.target!, req.targetLabel);
      const fitter = new IdFitter({ body: c, legacy, suffixSep: sep, ...(c === 'camel' ? { names: nameWords(source) } : {}) });
      let [a, join, b] = fitter.ends(source, target, false);
      if (this.lettersOnly(req) && /^[0-9]/.test(a)) a = fitter.ends(`From ${source}`, target, false)[0];
      return { base: fitter.pair(head, a, join, b, max), sep };
    }
    if (form === 'scopedTo') {
      const own = this.scopeOf(req, this.flowOf(req.key).scope!);
      const fitter = new IdFitter({ legacy, suffixSep: sep });
      const [a, b] = [fitter.endWord(req.source!, own, 'Start'), fitter.endWord(req.target!, own, 'End')];
      return { base: legacy ? cutAt(`${head}${own}_${a}To${b}`, max, true) : fitter.pair(`${head}${own}_`, a, 'To', b, max), sep };
    }
    return { base: new IdFitter({ legacy }).idForm(form, head, req, max), sep };
  }

  private namedBase(req: IdRequest, max: number, prefix: string, sep: string | undefined, legacy: boolean): string {
    const label = (id: string, given: string | undefined): string => (given && nameWords(given).length ? given : (speakingStem(id) ?? id));
    const c = this.caseFor(req);
    const { head, glued, long } = new IdFitter({ body: c, legacy }).namedHead(prefix, sep);
    const source = label(req.source!, req.sourceLabel);
    const fitter = new IdFitter({ body: c, legacy, ...(c === 'camel' && !glued ? { names: nameWords(source) } : {}) });
    const [a, join, b] = fitter.ends(source, label(req.target!, req.targetLabel), glued);
    if (!long) return fitter.pair(head, a, join, b, max);
    return fitter.whole(head, a, join, b, max) ?? this.namedBase(req, max, DEFAULT_FLOW.prefix, undefined, legacy);
  }

  private isConnection(req: IdRequest): boolean {
    return CONNECTIONS.has(req.key) && req.source !== undefined && req.target !== undefined;
  }

  /**
   * A cheap filter: a cut never reaches past the head's first 32 characters, and a head from
   * 40 characters may have given way to Flow_.
   */
  private mayBeOf(id: string, style: FlowStyle): boolean {
    const head = style.form === 'scopedTo' && style.scope !== undefined ? `${style.prefix}_${style.scope}_` : style.prefix;
    return id.startsWith(head.slice(0, 32)) || (style.prefix.length + (style.scope?.length ?? 0) >= 40 && id.startsWith(`${DEFAULT_FLOW.prefix}_`));
  }

  private typeOf(key: string): string {
    return kindByName(key)?.type ?? key;
  }

  /** `TimerStart` after `startEvent_`: Timer. */
  private unsaid(word: string, head: string): string {
    const said = new Set(stemWords(head).map((w) => w.toLowerCase()));
    return stemWords(word)
      .filter((w) => !said.has(w.toLowerCase()))
      .join('');
  }

  private effectiveHead(style: FlowStyle, c: Body): { head: string; form: FlowForm; fallback?: string } {
    const { form, prefix, sep, scope, head } = style;
    if (head !== undefined) return { head, form };
    const fitter = new IdFitter({ body: c });
    const fallback = fitter.namedHead(DEFAULT_FLOW.prefix, undefined).head;
    if (form === 'named') {
      const own = fitter.namedHead(prefix, sep);
      if (!own.long) return { head: own.head, form };
      return MAX_ID - own.head.length - (c === 'snake' || c === 'pascalSnake' ? 4 : 2) < 2 ? { head: fallback, form } : { head: own.head, form, fallback };
    }
    const room = form === 'scopedTo' ? MAX_ID - `${prefix}_${scope}_`.length - 'To'.length : MAX_ID - prefix.length - 1 - FORM_JOIN[form].length;
    if (room >= 16) return { head: `${prefix}_`, form };
    return room < 2 ? { head: fallback, form: 'named' } : { head: `${prefix}_`, form, fallback };
  }

  /** A camelCase body that lost its leading number to the cut begins in lower case (`rechnung`). */
  private cutBody(body: string, max: number, c: Body): string {
    const cut = cutName(body, max);
    return c === 'camel' && /^[0-9]/.test(body) && /^[A-Z]/.test(cut) ? cut.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (m) => m.toLowerCase()) : cut;
  }

  /**
   * The words up to the first with a letter that is no filler (`10202422024Rechnung`); an unnamed
   * element's after its context word, so its id still names the anchor (`afterCheck`).
   */
  private leadOf(body: string, unnamed = false): string {
    const words = idWords(body);
    const from = unnamed ? words.slice(0, 3).findIndex((w) => CONTEXT_WORDS.has(w.replace(/^[_.-]+/, '').toLowerCase())) + 1 : 0;
    const at = words.findIndex((w, i) => i >= from && /[A-Za-z]/.test(w) && !isFiller(w));
    return (at === -1 ? words : words.slice(0, at + 1)).join('');
  }
}
