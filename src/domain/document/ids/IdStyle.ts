import { camelSlug, cutAt, cutName, hasIdWords, isValidId, kebabSlug, MAX_ID, MAX_SLUG, nameWords, slugify, snakeSlug, withSuffix } from '../utils/slug.js';
import type { IdRegistry } from './IdRegistry.js';
import { IdFitter } from './IdFitter.js';
import { caseLike, kindWord, lcfirst, localName, PREFIXED, speakingStem, stemWords } from '../utils/id-words.js';
import { CONNECTIONS, kindRequest, typeRequest, type IdRequest } from '../utils/requests.js';
import { DEFAULT_ID_CONVENTIONS, UNCHECKED_PREFIXES, type IdConventions } from './IdConventions.js';
import { DeclaredConventions } from './DeclaredConventions.js';
import { FLOW_NODE_FAMILIES, KINDS, kindByName } from '../Kinds.js';

/** The case of the bodies of new ids. */
export type Body = 'camel' | 'pascal' | 'snake' | 'kebab';

/** lint: declared by element-id-naming; default: the rule's defaults, nothing declared; bpmn-cli: a type the rule does not check */
export type PrefixSource = 'lint' | 'default' | 'bpmn-cli';

export interface IdState {
  type: string;
  trigger?: string;
}

/** Their prefix says the kind, so an unnamed one's id leaves it out (gateway_afterCheck). */
const SPELLABLE = new Set(KINDS.filter((def) => FLOW_NODE_FAMILIES.has(def.family) && def.family !== 'event' && def.kind !== 'eventSubProcess').map((def) => def.kind));

/** An unnamed process without a declared prefix keeps the tool default. */
const NUMBERED_PROCESS = 'Process_';

/**
 * The id conventions new ids follow: the declared ones of element-id-naming, else the rule's
 * defaults; types the rule does not check take bpmn-cli's own prefix. Every new id says what it
 * names (never a hash or a running number); existing ids are never renamed for the conventions.
 */
export class IdStyle {
  private constructor(
    private readonly conventions: DeclaredConventions,
    /** false: nothing declared, the rule's defaults apply */
    readonly declared: boolean,
  ) {}

  static of(conventions?: IdConventions): IdStyle {
    return new IdStyle(DeclaredConventions.of(conventions ?? DEFAULT_ID_CONVENTIONS), conventions !== undefined);
  }

  static keyRequest(key: string): IdRequest {
    const def = kindByName(key);
    return def ? kindRequest(def) : typeRequest(key);
  }

  /** `any` takes camelCase. */
  private get body(): Body {
    return this.conventions.bodyCase ?? 'camel';
  }

  /** No `_` in the body and a letter first: a glued suffix, `<id>Join`, a kind word first. */
  private get lettersOnly(): boolean {
    return this.body === 'camel' || this.body === 'pascal';
  }

  suffixSep(): string {
    if (this.lettersOnly) return '';
    return this.body === 'kebab' ? '-' : '_';
  }

  /** '' for a named process without a declared prefix: its id is its name. */
  private headOf(req: IdRequest): { head: string; source: PrefixSource } {
    const type = this.typeOf(req.key);
    const declared = this.conventions.headFor(type, req.trigger);
    if (declared !== undefined) return { head: declared, source: this.declared ? 'lint' : 'default' };
    if (type === 'bpmn:Process') return { head: '', source: 'bpmn-cli' };
    return { head: caseLike(UNCHECKED_PREFIXES[type] ?? `${lcfirst(localName(type))}_`, !this.conventions.upperFirst), source: 'bpmn-cli' };
  }

  private numbered(req: IdRequest): boolean {
    return this.headOf(req).head === '' && !hasIdWords(req.name);
  }

  private bodyOf(text: string | undefined): string {
    switch (this.body) {
      case 'camel':
        return camelSlug(text);
      case 'snake':
        return snakeSlug(text);
      case 'kebab':
        return kebabSlug(text);
      default:
        return slugify(text);
    }
  }

  /**
   * A kind word and the context (`Timer On Review`), minus what the head says; `spelled` adds
   * the kind word a gateway's or activity's prefix otherwise says (`Parallel After Check invoice`).
   */
  private unnamedText(req: IdRequest, head: string, spelled = false): string {
    const context = nameWords(req.context).length ? req.context! : '';
    const word = kindWord(req.key, req.trigger, !!context && !spelled);
    return `${this.unsaid(word, head)} ${context}`.trim();
  }

  /** `qualified`: the context ends with the anchor's kind, which a cut leaves in place. */
  private derived(req: IdRequest, spelled = false, qualified = false, max = MAX_ID): string {
    const named = hasIdWords(req.name);
    const { head } = this.headOf(req);
    const room = max - head.length;
    const body = this.bodyFor(named ? req.name! : this.unnamedText(req, head, spelled), req, head);
    if (qualified && !named && req.anchorKind) return `${head}${this.withWord(body, req.anchorKind, Math.min(room, MAX_SLUG))}`;
    if (req.tailWord) return `${head}${this.withWord(body, req.tailWord, room)}`;
    return `${head}${this.cutBody(body, room)}`;
  }

  /**
   * A body that would begin with a number where a letter must come first begins with the kind
   * word, minus what the head says (startEvent_timer1stOfMonth, scriptTask_scriptTask4Augen).
   */
  private bodyFor(text: string, req: IdRequest, head: string): string {
    const body = this.bodyOf(text);
    if (body && !((this.lettersOnly || head === '') && /^[0-9]/.test(body))) return body;
    const word = head === '' ? 'Process' : kindWord(req.key, req.trigger);
    return this.bodyOf(`${this.unsaid(word, head) || word} ${text}`);
  }

  /** The body is cut so the word stays; under 8 characters left, both are cut as one. */
  private withWord(body: string, word: string, max: number): string {
    const tail = this.body === 'snake' ? `_${snakeSlug(word)}` : this.body === 'kebab' ? `-${kebabSlug(word)}` : slugify(word);
    return max - tail.length >= 8 ? `${cutName(body, max - tail.length)}${tail}` : cutName(`${body}${tail}`, max);
  }

  /** A taken unnamed gateway or activity spells its kind (gateway_parallelAfterCheck). */
  private spelledBase(req: IdRequest): string | undefined {
    if (!SPELLABLE.has(req.key) || hasIdWords(req.name) || !nameWords(req.context).length) return undefined;
    const word = kindWord(req.key, req.trigger).toLowerCase();
    if (this.headOf(req).head.toLowerCase().includes(word)) return undefined;
    return this.derived(req, true);
  }

  /** An id that repeats its unnamed anchor's names the anchor's kind (task_afterCheckGateway). */
  private qualifiedBase(req: IdRequest): string | undefined {
    if (!req.anchorKind || hasIdWords(req.name) || !nameWords(req.context).length) return undefined;
    return this.derived(req, false, true);
  }

  derivedBase(req: IdRequest): string {
    return this.wanted(req);
  }

  /**
   * Every id the request may have been given before (uncut, and cut for a suffix), so a flow
   * named earlier still names its ends.
   */
  derivedBases(req: IdRequest): string[] {
    const uncut = this.wanted(req, Infinity);
    return uncut.length <= MAX_ID - 4 ? [uncut] : [...new Set([...[0, 1, 2, 3, 4].map((suffix) => this.wanted(req, MAX_ID - suffix)), uncut])];
  }

  private wanted(req: IdRequest, max = MAX_ID): string {
    if (this.isConnection(req)) return this.connectionBase(req, max);
    if (this.numbered(req)) return `${NUMBERED_PROCESS}1`;
    return this.derived(req, false, false, max);
  }

  explain(req: IdRequest): { head: string; source: PrefixSource; body: Body } {
    return { ...this.headOf(req), body: this.body };
  }

  /**
   * W_ID_PREFIX_STALE: a retype or trigger change kept an id whose prefix the conventions no
   * longer accept. Suggests the new prefix with the rest of the id where that passed the rule,
   * else the id `now` wants (never the old kind's words). An id that starts with the prefix by
   * accident (userTask_checkOrder under `user`, Task_ completing the type name) is suggested
   * from the words after the type name.
   */
  stalePrefix(id: string, from: IdState, to: IdState, now?: IdRequest): { was?: string; heads: string[]; suggested: string } | undefined {
    const conventions = this.conventions;
    const heads = conventions.headsOf(to);
    if (!heads.length || conventions.acceptsId(id, to)) return undefined;
    const was = conventions.headOf(id, from);
    if (was === undefined && conventions.headsOf(from).length) return undefined;
    const rest = was === undefined ? undefined : id.slice(was.length);
    const own = rest !== undefined && /[A-Za-z0-9]$/.test(was!) ? PREFIXED.exec(rest) : null;
    const accidental = own && `${was}${own[1]}`.toLowerCase() === from.type.slice(from.type.indexOf(':') + 1).toLowerCase() ? own : null;
    if (now && (rest === undefined || accidental || !conventions.inDeclaredCase(id, from))) {
      const words = rest === undefined ? (speakingStem(id) ?? '') : accidental ? accidental[2]! : rest;
      const suggested = this.derivedBase(hasIdWords(now.name) ? now : { ...now, context: stemWords(words).join(' ') });
      return isValidId(suggested) ? { ...(was !== undefined ? { was } : {}), heads, suggested } : undefined;
    }
    if (was === undefined) return undefined;
    const suggested = `${conventions.headFor(to.type, to.trigger)!}${id.slice(was.length)}`;
    return isValidId(suggested) ? { was, heads, suggested } : undefined;
  }

  /**
   * The id of a split's join gateway (`<id>Join`, `<id>_join`, `<id>-join`). A split id outside
   * the conventions gives the prefix with its label (Gateway_Check -> gateway_checkJoin).
   */
  joinId(gatewayId: string, key = 'exclusiveGateway', label = speakingStem(gatewayId) ?? gatewayId): string {
    const req = IdStyle.keyRequest(key);
    const { head } = this.headOf(req);
    const state = { type: this.typeOf(key) };
    if (!this.conventions.inDeclaredCase(gatewayId, state)) {
      const own = this.conventions.headOf(gatewayId, state);
      const body = own === undefined ? '' : stemWords(gatewayId.slice(own.length)).join(' ');
      return `${head}${this.withWord(this.bodyFor(hasIdWords(body) ? body : label, req, head), 'Join', MAX_ID - head.length)}`;
    }
    const base = cutAt(gatewayId, MAX_ID - '_join'.length);
    if (this.body === 'snake') return `${base}_join`;
    return this.body === 'kebab' ? `${base}-join` : `${base}Join`;
  }

  /**
   * A free id (not claimed) and the id it wanted. A taken unnamed gateway or activity first
   * spells its kind, then names its anchor's kind, before a collision suffix; the same request
   * on the same document always gives the same id. When the base is taken only by its body, the
   * form that names the anchor is suffixed. An unnamed process takes the first free Process_<n>.
   */
  next(req: IdRequest, ids: IdRegistry): { id: string; base: string } {
    if (!this.isConnection(req) && this.numbered(req)) {
      let number = 1;
      while (ids.has(`${NUMBERED_PROCESS}${number}`)) number++;
      return { id: `${NUMBERED_PROCESS}${number}`, base: `${NUMBERED_PROCESS}${number}` };
    }
    let base = this.wanted(req);
    const qualified = CONNECTIONS.has(req.key) ? undefined : this.qualifiedBase(req);
    const others = CONNECTIONS.has(req.key) ? [] : [this.spelledBase(req), qualified].filter((candidate): candidate is string => !!candidate && candidate !== base);
    const clash = (id: string): boolean => ids.has(id) || ids.bodyTaken(id);
    if (others.length && clash(base)) {
      const pick = others.find((candidate) => !clash(candidate)) ?? others.find((candidate) => !ids.has(candidate));
      if (pick) return { id: pick, base: pick };
      if (qualified && !ids.has(base)) base = qualified;
    }
    const recut = (max: number): string => (base === qualified ? this.derived(req, false, true, max) : this.wanted(req, max));
    let id = base;
    for (let suffixNumber = 2; ids.has(id); suffixNumber++) id = withSuffix(base, this.suffixSep(), suffixNumber, recut);
    return { id, base };
  }

  /** `<head><source>To<target>`; an end that begins with a number is written `From...` where the case wants a letter first. */
  private connectionBase(req: IdRequest, max: number): string {
    const { head } = this.headOf(req);
    const label = (id: string, given: string | undefined): string => (given && nameWords(given).length ? given : (speakingStem(id) ?? id));
    const source = label(req.source!, req.sourceLabel);
    const target = label(req.target!, req.targetLabel);
    const fitter = new IdFitter({ body: this.body, suffixSep: this.suffixSep(), ...(this.body === 'camel' ? { names: nameWords(source) } : {}) });
    const [sourceEnd, join, targetEnd] = fitter.ends(source, target);
    const from = this.lettersOnly && /^[0-9]/.test(sourceEnd) ? (this.body === 'pascal' ? 'From' : 'from') : '';
    return fitter.pair(`${head}${from}`, sourceEnd, join, targetEnd, max);
  }

  private isConnection(req: IdRequest): boolean {
    return CONNECTIONS.has(req.key) && req.source !== undefined && req.target !== undefined;
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

  /** A camelCase body that lost its leading number to the cut begins in lower case (`rechnung`). */
  private cutBody(body: string, max: number): string {
    const cut = cutName(body, max);
    return this.body === 'camel' && /^[0-9]/.test(body) && /^[A-Z]/.test(cut) ? cut.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (capitals) => capitals.toLowerCase()) : cut;
  }
}
