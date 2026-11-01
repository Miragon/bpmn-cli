import { Kinds } from '../kinds/Kinds.js';
import { DeclaredConventions } from './DeclaredConventions.js';
import { IdCut } from './IdCut.js';
import { IdDefaults, type Body, type IdConventions, type IdState } from './IdDefaults.js';
import { IdFitter } from './IdFitter.js';
import type { IdRegistry } from './IdRegistry.js';
import { IdRequests, type IdRequest } from './IdRequests.js';
import { IdSlug } from './IdSlug.js';
import { IdWords } from './IdWords.js';

export type PrefixSource = 'lint' | 'default' | 'bpmn-cli';

export interface StalePrefix {
  was?: string;
  heads: string[];
  suggested: string;
}

export class IdStyle {
  private static readonly SPELLABLE = new Set(Kinds.ALL.filter((def) => Kinds.FLOW_NODE_FAMILIES.has(def.family) && def.family !== 'event' && def.kind !== 'eventSubProcess').map((def) => def.kind));
  private static readonly NUMBERED_PROCESS = 'Process_';

  private constructor(
    private readonly conventions: DeclaredConventions,
    readonly declared: boolean,
  ) {}

  static of(conventions?: IdConventions): IdStyle {
    return new IdStyle(DeclaredConventions.of(conventions ?? IdDefaults.CONVENTIONS), conventions !== undefined);
  }

  static keyRequest(key: string): IdRequest {
    const def = Kinds.byName(key);
    return def ? IdRequests.kindRequest(def) : IdRequests.typeRequest(key);
  }

  private get body(): Body {
    return this.conventions.bodyCase ?? 'camel';
  }

  private get lettersOnly(): boolean {
    return this.body === 'camel' || this.body === 'pascal';
  }

  suffixSep(): string {
    if (this.lettersOnly) {
      return '';
    }
    return this.body === 'kebab' ? '-' : '_';
  }

  private headOf(req: IdRequest): { head: string; source: PrefixSource } {
    const type = this.typeOf(req.key);
    const declared = this.conventions.headFor(type, req.trigger);
    if (declared !== undefined) {
      return { head: declared, source: this.declared ? 'lint' : 'default' };
    }
    if (type === 'bpmn:Process') {
      return { head: '', source: 'bpmn-cli' };
    }
    return { head: IdWords.caseLike(IdDefaults.UNCHECKED_PREFIXES[type] ?? `${IdWords.lcfirst(IdWords.localName(type))}_`, !this.conventions.upperFirst), source: 'bpmn-cli' };
  }

  private numbered(req: IdRequest): boolean {
    return this.headOf(req).head === '' && !IdSlug.hasIdWords(req.name);
  }

  private bodyOf(text: string | undefined): string {
    switch (this.body) {
      case 'camel':
        return IdSlug.camelSlug(text);
      case 'snake':
        return IdSlug.snakeSlug(text);
      case 'kebab':
        return IdSlug.kebabSlug(text);
      default:
        return IdSlug.slugify(text);
    }
  }

  private unnamedText(req: IdRequest, head: string, spelled = false): string {
    const context = IdSlug.nameWords(req.context).length ? req.context! : '';
    const word = IdWords.kindWord(req.key, req.trigger, !!context && !spelled);
    return `${this.unsaid(word, head)} ${context}`.trim();
  }

  private derived(req: IdRequest, spelled = false, qualified = false, max = IdCut.MAX_ID): string {
    const named = IdSlug.hasIdWords(req.name);
    const { head } = this.headOf(req);
    const room = max - head.length;
    const body = this.bodyFor(named ? req.name! : this.unnamedText(req, head, spelled), req, head);
    if (qualified && !named && req.anchorKind) {
      return `${head}${this.withWord(body, req.anchorKind, Math.min(room, IdSlug.MAX_SLUG))}`;
    }
    return `${head}${this.cutBody(body, room)}`;
  }

  private bodyFor(text: string, req: IdRequest, head: string): string {
    const body = this.bodyOf(text);
    if (body && !((this.lettersOnly || head === '') && /^[0-9]/.test(body))) {
      return body;
    }
    const word = head === '' ? 'Process' : IdWords.kindWord(req.key, req.trigger);
    return this.bodyOf(`${this.unsaid(word, head) || word} ${text}`);
  }

  private withWord(body: string, word: string, max: number): string {
    const tail = this.joinedWord(word);
    return max - tail.length >= 8 ? `${IdCut.cutName(body, max - tail.length)}${tail}` : IdCut.cutName(`${body}${tail}`, max);
  }

  private joinedWord(word: string): string {
    if (this.body === 'snake') {
      return `_${IdSlug.snakeSlug(word)}`;
    }
    return this.body === 'kebab' ? `-${IdSlug.kebabSlug(word)}` : IdSlug.slugify(word);
  }

  private spelledBase(req: IdRequest): string | undefined {
    if (!IdStyle.SPELLABLE.has(req.key) || IdSlug.hasIdWords(req.name) || !IdSlug.nameWords(req.context).length) {
      return undefined;
    }
    const word = IdWords.kindWord(req.key, req.trigger).toLowerCase();
    if (this.headOf(req).head.toLowerCase().includes(word)) {
      return undefined;
    }
    return this.derived(req, true);
  }

  private qualifiedBase(req: IdRequest): string | undefined {
    if (!req.anchorKind || IdSlug.hasIdWords(req.name) || !IdSlug.nameWords(req.context).length) {
      return undefined;
    }
    return this.derived(req, false, true);
  }

  derivedBase(req: IdRequest): string {
    return this.wanted(req);
  }

  derivedBases(req: IdRequest): string[] {
    const uncut = this.wanted(req, Infinity);
    return uncut.length <= IdCut.MAX_ID - 4 ? [uncut] : [...new Set([...[0, 1, 2, 3, 4].map((suffix) => this.wanted(req, IdCut.MAX_ID - suffix)), uncut])];
  }

  private wanted(req: IdRequest, max = IdCut.MAX_ID): string {
    if (this.isConnection(req)) {
      return this.connectionBase(req, max);
    }
    if (this.numbered(req)) {
      return `${IdStyle.NUMBERED_PROCESS}1`;
    }
    return this.derived(req, false, false, max);
  }

  explain(req: IdRequest): { head: string; source: PrefixSource; body: Body } {
    return { ...this.headOf(req), body: this.body };
  }

  stalePrefix(id: string, from: IdState, to: IdState, now?: IdRequest): StalePrefix | undefined {
    const conventions = this.conventions;
    const heads = conventions.headsOf(to);
    if (!heads.length || conventions.acceptsId(id, to)) {
      return undefined;
    }
    const was = conventions.headOf(id, from);
    if (was === undefined && conventions.headsOf(from).length) {
      return undefined;
    }
    const accidental = was === undefined ? undefined : this.accidentalWords(id.slice(was.length), was, from);
    if (now && (was === undefined || accidental !== undefined || !conventions.inDeclaredCase(id, from))) {
      const words = was === undefined ? (IdWords.speakingStem(id) ?? '') : (accidental ?? id.slice(was.length));
      return this.staleFromWords(words, now, was, heads);
    }
    const suggested = was === undefined ? undefined : `${conventions.headFor(to.type, to.trigger)!}${id.slice(was.length)}`;
    return suggested !== undefined && IdSlug.isValidId(suggested) ? { was: was!, heads, suggested } : undefined;
  }

  private staleFromWords(words: string, now: IdRequest, was: string | undefined, heads: string[]): StalePrefix | undefined {
    const suggested = this.derivedBase(IdSlug.hasIdWords(now.name) ? now : { ...now, context: IdWords.stemWords(words).join(' ') });
    return IdSlug.isValidId(suggested) ? { ...(was !== undefined ? { was } : {}), heads, suggested } : undefined;
  }

  private accidentalWords(rest: string, was: string, from: IdState): string | undefined {
    const own = /[A-Za-z0-9]$/.test(was) ? IdWords.PREFIXED.exec(rest) : null;
    return own && `${was}${own[1]}`.toLowerCase() === from.type.slice(from.type.indexOf(':') + 1).toLowerCase() ? own[2]! : undefined;
  }

  joinId(gatewayId: string, key = 'exclusiveGateway', label = IdWords.speakingStem(gatewayId) ?? gatewayId): string {
    const req = IdStyle.keyRequest(key);
    const { head } = this.headOf(req);
    const state = { type: this.typeOf(key) };
    if (!this.conventions.inDeclaredCase(gatewayId, state)) {
      const own = this.conventions.headOf(gatewayId, state);
      const body = own === undefined ? '' : IdWords.stemWords(gatewayId.slice(own.length)).join(' ');
      return `${head}${this.withWord(this.bodyFor(IdSlug.hasIdWords(body) ? body : label, req, head), 'Join', IdCut.MAX_ID - head.length)}`;
    }
    const base = IdCut.cutAt(gatewayId, IdCut.MAX_ID - '_join'.length);
    if (this.body === 'snake') {
      return `${base}_join`;
    }
    return this.body === 'kebab' ? `${base}-join` : `${base}Join`;
  }

  next(req: IdRequest, ids: IdRegistry): { id: string; base: string } {
    if (!this.isConnection(req) && this.numbered(req)) {
      let number = 1;
      while (ids.has(`${IdStyle.NUMBERED_PROCESS}${number}`)) {
        number++;
      }
      return { id: `${IdStyle.NUMBERED_PROCESS}${number}`, base: `${IdStyle.NUMBERED_PROCESS}${number}` };
    }
    let base = this.wanted(req);
    const qualified = IdRequests.CONNECTIONS.has(req.key) ? undefined : this.qualifiedBase(req);
    const others = IdRequests.CONNECTIONS.has(req.key) ? [] : [this.spelledBase(req), qualified].filter((candidate): candidate is string => !!candidate && candidate !== base);
    const clash = (id: string): boolean => ids.has(id) || ids.bodyTaken(id);
    if (others.length && clash(base)) {
      const pick = others.find((candidate) => !clash(candidate)) ?? others.find((candidate) => !ids.has(candidate));
      if (pick) {
        return { id: pick, base: pick };
      }
      if (qualified && !ids.has(base)) {
        base = qualified;
      }
    }
    const recut = (max: number): string => (base === qualified ? this.derived(req, false, true, max) : this.wanted(req, max));
    let id = base;
    for (let suffixNumber = 2; ids.has(id); suffixNumber++) {
      id = IdCut.withSuffix(base, this.suffixSep(), suffixNumber, recut);
    }
    return { id, base };
  }

  private connectionBase(req: IdRequest, max: number): string {
    const { head } = this.headOf(req);
    const label = (id: string, given: string | undefined): string => (given && IdSlug.nameWords(given).length ? given : (IdWords.speakingStem(id) ?? id));
    const source = label(req.source!, req.sourceLabel);
    const target = label(req.target!, req.targetLabel);
    const fitter = new IdFitter({ body: this.body, suffixSep: this.suffixSep(), ...(this.body === 'camel' ? { names: IdSlug.nameWords(source) } : {}) });
    const [sourceEnd, join, targetEnd] = fitter.ends(source, target);
    const startsWithNumber = this.lettersOnly && /^[0-9]/.test(sourceEnd);
    const from = this.body === 'pascal' ? 'From' : 'from';
    return fitter.pair(`${head}${startsWithNumber ? from : ''}`, sourceEnd, join, targetEnd, max);
  }

  private isConnection(req: IdRequest): boolean {
    return IdRequests.CONNECTIONS.has(req.key) && req.source !== undefined && req.target !== undefined;
  }

  private typeOf(key: string): string {
    return Kinds.byName(key)?.type ?? key;
  }

  private unsaid(word: string, head: string): string {
    const said = new Set(IdWords.stemWords(head).map((word) => word.toLowerCase()));
    return IdWords.stemWords(word)
      .filter((word) => !said.has(word.toLowerCase()))
      .join('');
  }

  private cutBody(body: string, max: number): string {
    const cut = IdCut.cutName(body, max);
    return this.body === 'camel' && /^[0-9]/.test(body) && /^[A-Z]/.test(cut) ? cut.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (capitals) => capitals.toLowerCase()) : cut;
  }
}
