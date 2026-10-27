import { camelSlug, cutAt, cutName, hasIdWords, idWords, isFiller, isValidId, MAX_ID, MAX_SLUG, nameWords, pascalSnakeSlug, slugify, snakeSlug, withSuffix } from '../utils/slug.js';
import type { IdRegistry } from './IdRegistry.js';
import { FORM_JOIN, IdFitter } from './IdFitter.js';
import { caseLike, CONTEXT_WORDS, kindWord, PREFIXED, speakingStem, stemWords } from '../utils/id-words.js';
import { CONNECTIONS, connectionRequest, kindRequest, typeRequest, type IdRequest } from '../utils/requests.js';
import type { IdConventions } from './IdConventionsReader.js';
import { DeclaredConventions } from './DeclaredConventions.js';
import { DEFAULT_FLOW, LearnedStyle } from './LearnedStyle.js';
import { kindByName } from '../utils/kinds.js';
import type { El } from '../utils/moddle.js';

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
    private readonly learned: LearnedStyle,
    private readonly declaredConventions?: DeclaredConventions,
    /** with declared conventions `learned` leaves out the ids a declared prefix covers; this does not */
    private readonly all: LearnedStyle = learned,
  ) {}

  static readonly DEFAULT = new IdStyle(new LearnedStyle(undefined));

  static infer(defs: El, conventions?: IdConventions): IdStyle {
    const declared = DeclaredConventions.of(conventions);
    if (!declared) return new IdStyle(new LearnedStyle(defs));
    return new IdStyle(new LearnedStyle(defs, declared), declared, new LearnedStyle(defs));
  }

  static of(conventions?: IdConventions): IdStyle {
    const declared = DeclaredConventions.of(conventions);
    return declared ? new IdStyle(new LearnedStyle(undefined), declared) : IdStyle.DEFAULT;
  }

  static keyRequest(key: string): IdRequest {
    const def = kindByName(key);
    return def ? kindRequest(def) : typeRequest(key);
  }

  get declared(): boolean {
    return this.declaredConventions !== undefined;
  }

  /**
   * Only where the file has checked ids that do not follow the declared conventions is a new id
   * under a declared prefix one the file's own style would give otherwise.
   */
  get ownStyleDiffers(): boolean {
    return this.learned.unconforming;
  }

  private processMemo: { prefix: string; body: Body } | null | undefined;

  private processStyle(): { prefix: string; body: Body } | undefined {
    if (this.processMemo === undefined) this.processMemo = this.learned.processStyle(() => this.caseFor()) ?? null;
    return this.processMemo ?? undefined;
  }

  private fileLevel(req: IdRequest): boolean {
    return !!this.declaredConventions && FILE_LEVEL.has(req.key) && this.declaredHead(req) === undefined && !(req.key === 'bpmn:Process' && this.processStyle());
  }

  private own: IdStyle | undefined;

  learnedOnly(): IdStyle {
    return this.declaredConventions ? (this.own ??= new IdStyle(this.all)) : this;
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
    const declared = this.declaredConventions;
    if (!declared) return this.learned.flowOf(type);
    const borrowed = this.learned.showsFlowStyle(type) ? undefined : declared.borrowedHead(type);
    const learned = this.learned.flowOf(borrowed === undefined ? type : 'bpmn:SequenceFlow');
    const head = declared.prefixes[type] ?? borrowed;
    if (head === undefined) return learned;
    return { ...learned, form: declared.case ? 'named' : learned.form, head };
  }

  private declaredHead(req: IdRequest): string | undefined {
    return this.declaredConventions?.headFor(this.typeOf(req.key), req.trigger);
  }

  private declares(req: IdRequest): boolean {
    if (!this.declaredConventions) return false;
    return CONNECTIONS.has(req.key) ? this.flowOf(req.key).head !== undefined : this.declaredHead(req) !== undefined;
  }

  private caseFor(req?: IdRequest): Body {
    const own = req?.key === 'bpmn:Process' && !this.declares(req) ? this.processStyle() : undefined;
    if (own) return own.body;
    if (!this.declaredConventions) return this.learned.body;
    if (req && this.declares(req)) return this.declaredConventions.case ?? this.all.body;
    if (this.learned.bodyVoted) return this.learned.body;
    if (!this.declaredConventions.case) return this.all.body;
    return this.learned.otherShape(this.declaredConventions) ? this.learned.body : this.declaredConventions.case;
  }

  /** No `_` in the body and a letter first: a glued suffix, `<id>Join`, a kind word first. */
  private lettersOnly(req: IdRequest): boolean {
    return this.declares(req) && (this.declaredConventions!.case === 'camel' || this.declaredConventions!.case === 'pascal');
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
    return this.learned.prefixOf(req, bare, this.declaredConventions);
  }

  private bodyOf(text: string | undefined, bodyCase: Body = this.learned.body): string {
    switch (bodyCase) {
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
    const body = this.learned.bareBody === 'pascal' ? slugify(name) : camelSlug(name);
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

  /**
   * `qualified`: the context ends with the anchor's kind, which a cut leaves in place.
   * An unnamed element keeps a prefix in a file whose named ids have none.
   */
  private derived(req: IdRequest, spelled = false, qualified = false, max = MAX_ID): string {
    const named = hasIdWords(req.name);
    const bodyCase = this.caseFor(req);
    const head = this.declaredHead(req);
    if (head !== undefined) {
      const room = max - head.length;
      const body = this.declaredBody(named ? req.name! : this.unnamedText(req, spelled, head), req, head, bodyCase);
      if (qualified && !named && req.anchorKind) return `${head}${this.withWord(body, req.anchorKind, Math.min(room, MAX_SLUG), bodyCase)}`;
      if (req.tailWord) return `${head}${this.withWord(body, req.tailWord, room, bodyCase)}`;
      return `${head}${this.cutBody(body, room, bodyCase)}`;
    }
    const prefix = this.prefixFor(req);
    if (prefix === '' && named) {
      const bare = this.bareBody(req.name);
      if (bare) return req.tailWord ? this.withWord(bare, req.tailWord, max, this.learned.bareBody) : this.cutBody(bare, max, this.learned.bareBody);
    }
    let chosenPrefix = prefix === '' ? this.prefixFor(req, false) : prefix;
    const body = this.bodyOf(named ? req.name : this.unnamedText(req, spelled), bodyCase) || this.bodyOf(kindWord(req.key, req.trigger), bodyCase);
    /**
     * A prefix that leaves under 8 characters beside `_99` stays where the body's lead fits beside
     * it whole, else the bpmn-cli prefix takes its place (activity_auftrag).
     */
    if (MAX_ID - chosenPrefix.length - 1 - 3 < 8 && this.leadOf(body, !named).length > max - chosenPrefix.length - 1) chosenPrefix = caseLike(req.prefix, /^[a-z]/.test(chosenPrefix));
    const room = max - chosenPrefix.length - 1;
    if (qualified && !named && req.anchorKind) return `${chosenPrefix}_${this.withWord(body, req.anchorKind, Math.min(room, MAX_SLUG), bodyCase)}`;
    if (req.tailWord) return `${chosenPrefix}_${this.withWord(body, req.tailWord, room, bodyCase)}`;
    return `${chosenPrefix}_${this.cutBody(body, room, bodyCase)}`;
  }

  /**
   * A body that would begin with a number under camelCase / PascalCase begins with the kind word,
   * minus what the prefix says (startEvent_timer1stOfMonth, scriptTask_scriptTask4Augen).
   */
  private declaredBody(text: string, req: IdRequest, head: string, bodyCase: Body): string {
    const body = this.bodyOf(text, bodyCase);
    if (body && !(this.lettersOnly(req) && /^[0-9]/.test(body))) return body;
    const word = kindWord(req.key, req.trigger);
    return this.bodyOf(`${this.unsaid(word, head) || word} ${text}`, bodyCase);
  }

  /** The body is cut so the word stays; under 8 characters left, both are cut as one. */
  private withWord(body: string, word: string, max: number, bodyCase: Body): string {
    const tail = bodyCase === 'snake' ? `_${snakeSlug(word)}` : bodyCase === 'pascalSnake' ? `_${pascalSnakeSlug(word)}` : slugify(word);
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
   * Every id the request may have been given before (uncut, cut for a suffix, in every other
   * flow style the file shows), so a flow named earlier still names its ends.
   * `id` limits this to the styles it can belong to.
   */
  derivedBases(req: IdRequest, id?: string): string[] {
    const own = this.basesOf(req, id);
    return this.declaredConventions ? [...new Set([...own, ...this.learnedOnly().basesOf(req, id)])] : own;
  }

  private basesOf(req: IdRequest, id?: string): string[] {
    if (!this.isConnection(req)) {
      const uncut = this.wanted(req, Infinity).base;
      return uncut.length <= MAX_ID - 4 ? [uncut] : [...new Set([...[0, 1, 2, 3, 4].map((suffix) => this.wanted(req, MAX_ID - suffix).base), uncut])];
    }
    const style = this.flowOf(req.key);
    const bases = this.connectionBases(req, style);
    if (style.head === undefined) for (const other of this.learned.otherFlowStyles(req.key)) if (id === undefined || this.mayBeOf(id, other)) bases.push(...this.connectionBases(req, other));
    return [...new Set(bases)];
  }

  private connectionBases(req: IdRequest, style: FlowStyle): string[] {
    const at = (max: number): string => this.connectionBase(req, max, style).base;
    const uncut = at(Infinity);
    return [...(uncut.length <= MAX_ID - 4 ? [] : [0, 1, 2, 3, 4].map((suffix) => at(MAX_ID - suffix))), uncut];
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
    const source: PrefixSource = style.head !== undefined ? 'lint' : this.learned.hasFlows(type) ? 'file' : 'default';
    const body = this.caseFor(connectionRequest(type, '', ''));
    return { style, ...this.effectiveHead(style, body), source, body };
  }

  /**
   * W_ID_PREFIX_STALE: a retype or trigger change kept an id whose prefix the declared conventions
   * no longer accept. Suggests the new prefix with the rest of the id where that passed the rule,
   * else the id `now` wants (never the old kind's words). Ids are never renamed for this. An id
   * that starts with the prefix by accident (userTask_checkOrder under `user`, Task_ completing the
   * type name) is suggested from the words after the type name.
   */
  stalePrefix(id: string, from: IdState, to: IdState, now?: IdRequest): { was?: string; heads: string[]; suggested: string } | undefined {
    const declared = this.declaredConventions;
    if (!declared) return undefined;
    const heads = declared.headsOf(to);
    if (!heads.length || declared.acceptsId(id, to)) return undefined;
    const was = declared.headOf(id, from);
    if (was === undefined && declared.headsOf(from).length) return undefined;
    const rest = was === undefined ? undefined : id.slice(was.length);
    const own = rest !== undefined && /[A-Za-z0-9]$/.test(was!) ? PREFIXED.exec(rest) : null;
    const accidental = own && `${was}${own[1]}`.toLowerCase() === from.type.slice(from.type.indexOf(':') + 1).toLowerCase() ? own : null;
    if (now && (rest === undefined || accidental || !declared.inDeclaredCase(id, from))) {
      const words = rest === undefined ? (speakingStem(id) ?? '') : accidental ? accidental[2]! : rest;
      const suggested = this.derivedBase(hasIdWords(now.name) ? now : { ...now, context: stemWords(words).join(' ') });
      return isValidId(suggested) ? { ...(was !== undefined ? { was } : {}), heads, suggested } : undefined;
    }
    if (was === undefined) return undefined;
    const head = declared.headFor(to.type, to.trigger)!;
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
    if (head !== undefined && !this.declaredConventions!.inDeclaredCase(gatewayId, state)) {
      const bodyCase = this.caseFor(req);
      const own = this.declaredConventions!.headOf(gatewayId, state);
      const body = own === undefined ? '' : stemWords(gatewayId.slice(own.length)).join(' ');
      return `${head}${this.withWord(this.declaredBody(hasIdWords(body) ? body : label, req, head, bodyCase), 'Join', MAX_ID - head.length, bodyCase)}`;
    }
    const base = cutAt(gatewayId, MAX_ID - '_join'.length);
    if (head !== undefined && this.declaredConventions!.case) return this.declaredConventions!.case === 'snake' ? `${base}_join` : `${base}Join`;
    if (!gatewayId.includes('_') && this.learned.hasBareNodes) return `${base}Join`;
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
   * on the same document always gives the same id. When the base is taken only by its body, the
   * form that names the anchor is suffixed; when a long head gives way to Flow_ in the cut for the
   * suffix, the whole id takes that form.
   */
  next(req: IdRequest, ids: IdRegistry): { id: string; base: string } {
    const wanted = this.wanted(req);
    const { sep } = wanted;
    let { base } = wanted;
    const qualified = CONNECTIONS.has(req.key) ? undefined : this.qualifiedBase(req);
    const others = CONNECTIONS.has(req.key) ? [] : [this.spelledBase(req), qualified].filter((candidate): candidate is string => !!candidate && candidate !== base);
    const clash = (id: string): boolean => ids.has(id) || ids.bodyTaken(id);
    if (others.length && clash(base)) {
      const pick = others.find((candidate) => !clash(candidate)) ?? others.find((candidate) => !ids.has(candidate));
      if (pick) return { id: pick, base: pick };
      if (qualified && !ids.has(base)) base = qualified;
    }
    let id = base;
    const recut = (max: number): { base: string; sep: string } => (base === qualified ? { base: this.derived(req, false, true, max), sep } : this.wanted(req, max));
    const suffixed = (suffixNumber: number): string => {
      let given: { base: string; sep: string } | undefined;
      const out = withSuffix(base, sep, suffixNumber, (max) => {
        const recutBase = recut(max);
        if (recutBase.sep !== sep) given ??= recutBase;
        return recutBase.base;
      });
      if (!given) return out;
      const suffix = `${given.sep}${suffixNumber}`;
      const room = recut(MAX_ID - suffix.length);
      return `${room.sep === given.sep ? room.base : given.base}${suffix}`;
    };
    for (let suffixNumber = 2; ids.has(id); suffixNumber++) id = suffixed(suffixNumber);
    return { id, base };
  }

  /**
   * A head that leaves the ends under 16 characters stays per flow where they fit beside it at
   * whole words, else gives way to Flow_, so one file can hold both forms.
   */
  private connectionBase(req: IdRequest, max: number, style = this.flowOf(req.key)): { base: string; sep: string } {
    const { form, prefix, sep, scope, head } = style;
    if (head !== undefined) return this.declaredFlowBase(req, max, form, head);
    if (form === 'named') return { base: this.namedBase(req, max, prefix, sep), sep: '_' };
    const long = (head: string, join: string): boolean => MAX_ID - head.length - join.length < 16;
    if (form === 'scopedTo') {
      const sourceId = req.source!;
      const targetId = req.target!;
      const own = this.scopeOf(req, scope!);
      const head = `${prefix}_${own}_`;
      const fitter = new IdFitter({ suffixSep: '' });
      const [sourceWord, targetWord] = [fitter.endWord(sourceId, own, 'Start'), fitter.endWord(targetId, own, 'End')];
      const base = long(head, 'To') ? fitter.whole(head, sourceWord, 'To', targetWord, max) : fitter.pair(head, sourceWord, 'To', targetWord, max);
      return base !== undefined ? { base, sep: '' } : { base: this.namedBase({ ...req, sourceLabel: sourceWord, targetLabel: targetWord }, max, DEFAULT_FLOW.prefix, undefined), sep: '_' };
    }
    const own = form === 'stemTo' ? '' : '_';
    const fitter = new IdFitter();
    if (!long(`${prefix}_`, FORM_JOIN[form])) return { base: fitter.idForm(form, `${prefix}_`, req, max), sep: own };
    const base = fitter.wholeIdForm(form, `${prefix}_`, req, max);
    return base !== undefined ? { base, sep: own } : { base: this.namedBase(req, max, DEFAULT_FLOW.prefix, undefined), sep: '_' };
  }

  /** The scope an end names in its id (KotO in serviceTask_KotO_Validate), else the most used. */
  private scopeOf(req: IdRequest, scope: string): string {
    const scopes = this.learned.scopesOf(req.key) ?? [scope];
    return scopes.find((candidateScope) => req.source!.split('_').includes(candidateScope) || req.target!.split('_').includes(candidateScope)) ?? scope;
  }

  /**
   * A declared head never gives way to Flow_. The ends leave out the file's scope segment, and
   * one that begins with a number is written `From...` where the case wants a letter first.
   */
  private declaredFlowBase(req: IdRequest, max: number, form: FlowForm, head: string): { base: string; sep: string } {
    const sep = this.sepFor(req);
    if (form === 'named') {
      const bodyCase = this.caseFor(req);
      const scopes = this.learned.scopesOf(req.key) ?? [];
      const label = (id: string, given: string | undefined): string => {
        const text = given && nameWords(given).length ? given : (speakingStem(id) ?? id);
        return (scopes.length && text.split('_').filter((segment) => !scopes.includes(segment)).join('_')) || text;
      };
      const source = label(req.source!, req.sourceLabel);
      const target = label(req.target!, req.targetLabel);
      const fitter = new IdFitter({ body: bodyCase, suffixSep: sep, ...(bodyCase === 'camel' ? { names: nameWords(source) } : {}) });
      let [sourceEnd, join, targetEnd] = fitter.ends(source, target, false);
      if (this.lettersOnly(req) && /^[0-9]/.test(sourceEnd)) sourceEnd = fitter.ends(`From ${source}`, target, false)[0];
      return { base: fitter.pair(head, sourceEnd, join, targetEnd, max), sep };
    }
    if (form === 'scopedTo') {
      const own = this.scopeOf(req, this.flowOf(req.key).scope!);
      const fitter = new IdFitter({ suffixSep: sep });
      const [sourceWord, targetWord] = [fitter.endWord(req.source!, own, 'Start'), fitter.endWord(req.target!, own, 'End')];
      return { base: fitter.pair(`${head}${own}_`, sourceWord, 'To', targetWord, max), sep };
    }
    return { base: new IdFitter().idForm(form, head, req, max), sep };
  }

  private namedBase(req: IdRequest, max: number, prefix: string, sep: string | undefined): string {
    const label = (id: string, given: string | undefined): string => (given && nameWords(given).length ? given : (speakingStem(id) ?? id));
    const bodyCase = this.caseFor(req);
    const { head, glued, long } = new IdFitter({ body: bodyCase }).namedHead(prefix, sep);
    const source = label(req.source!, req.sourceLabel);
    const fitter = new IdFitter({ body: bodyCase, ...(bodyCase === 'camel' && !glued ? { names: nameWords(source) } : {}) });
    const [sourceEnd, join, targetEnd] = fitter.ends(source, label(req.target!, req.targetLabel), glued);
    if (!long) return fitter.pair(head, sourceEnd, join, targetEnd, max);
    return fitter.whole(head, sourceEnd, join, targetEnd, max) ?? this.namedBase(req, max, DEFAULT_FLOW.prefix, undefined);
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
    const said = new Set(stemWords(head).map((word) => word.toLowerCase()));
    return stemWords(word)
      .filter((word) => !said.has(word.toLowerCase()))
      .join('');
  }

  private effectiveHead(style: FlowStyle, bodyCase: Body): { head: string; form: FlowForm; fallback?: string } {
    const { form, prefix, sep, scope, head } = style;
    if (head !== undefined) return { head, form };
    const fitter = new IdFitter({ body: bodyCase });
    const fallback = fitter.namedHead(DEFAULT_FLOW.prefix, undefined).head;
    if (form === 'named') {
      const own = fitter.namedHead(prefix, sep);
      if (!own.long) return { head: own.head, form };
      return MAX_ID - own.head.length - (bodyCase === 'snake' || bodyCase === 'pascalSnake' ? 4 : 2) < 2 ? { head: fallback, form } : { head: own.head, form, fallback };
    }
    const room = form === 'scopedTo' ? MAX_ID - `${prefix}_${scope}_`.length - 'To'.length : MAX_ID - prefix.length - 1 - FORM_JOIN[form].length;
    if (room >= 16) return { head: `${prefix}_`, form };
    return room < 2 ? { head: fallback, form: 'named' } : { head: `${prefix}_`, form, fallback };
  }

  /** A camelCase body that lost its leading number to the cut begins in lower case (`rechnung`). */
  private cutBody(body: string, max: number, bodyCase: Body): string {
    const cut = cutName(body, max);
    return bodyCase === 'camel' && /^[0-9]/.test(body) && /^[A-Z]/.test(cut) ? cut.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (capitals) => capitals.toLowerCase()) : cut;
  }

  /**
   * The words up to the first with a letter that is no filler (`10202422024Rechnung`); an unnamed
   * element's after its context word, so its id still names the anchor (`afterCheck`).
   */
  private leadOf(body: string, unnamed = false): string {
    const words = idWords(body);
    const from = unnamed ? words.slice(0, 3).findIndex((word) => CONTEXT_WORDS.has(word.replace(/^[_.-]+/, '').toLowerCase())) + 1 : 0;
    const at = words.findIndex((word, index) => index >= from && /[A-Za-z]/.test(word) && !isFiller(word));
    return (at === -1 ? words : words.slice(0, at + 1)).join('');
  }
}
