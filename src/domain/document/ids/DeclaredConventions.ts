import { KINDS } from '../Kinds.js';
import { isUsablePrefix } from '../utils/slug.js';
import { PREFIXED, prefixClass } from '../utils/id-words.js';
import { kindTypeNames } from '../utils/requests.js';
import type { IdConventions } from './IdConventions.js';
import type { Body, IdState } from './IdStyle.js';

/** The declared prefixes as votes on the shape of a prefix nothing declares. */
export interface Votes {
  kind: number;
  literal: number;
  lower: number;
  upper: number;
}

const BODY_OF_CASE: Record<string, Body> = { camelCase: 'camel', PascalCase: 'pascal', snake_case: 'snake' };

/** The bodies element-id-naming accepts after the prefix under a declared case. */
const CASE_BODY: Partial<Record<Body, RegExp>> = { camel: /^[a-z][A-Za-z0-9]*$/, pascal: /^[A-Z][A-Za-z0-9]*$/, snake: /^[a-z0-9]+(_[a-z0-9]+)*$/ };

/**
 * The declared id conventions as the style uses them: the usable prefixes and the body case,
 * checked the way element-id-naming checks them.
 */
export class DeclaredConventions {
  readonly case: Body | undefined;
  private shapeVotes: Votes | undefined;

  private constructor(
    readonly prefixes: Record<string, string>,
    readonly qualifier: 'off' | 'optional' | 'required',
    body: Body | undefined,
    /**
     * types (`bpmn:ReceiveTask`) and event triggers (`bpmn:EndEvent:escalation`) the rule
     * checks with a prefix new ids cannot have
     */
    readonly ignored: Set<string>,
  ) {
    this.case = body;
  }

  static of(conventions: IdConventions | undefined): DeclaredConventions | undefined {
    const prefixes: Record<string, string> = {};
    for (const [key, prefix] of Object.entries(conventions?.prefixes ?? {})) if (isUsablePrefix(prefix)) prefixes[key] = prefix;
    if (!Object.keys(prefixes).length) return undefined;
    const body = conventions?.case ? BODY_OF_CASE[conventions.case] : undefined;
    return new DeclaredConventions(prefixes, conventions?.qualifier ?? 'optional', body, new Set(conventions?.ignored));
  }

  /**
   * Under `required` an event with a trigger takes the qualified prefix (timerStartEvent_);
   * undefined where that one is ignored, so such events follow the learned style.
   */
  headFor(type: string, trigger: string | undefined): string | undefined {
    const plain = this.prefixes[type];
    if (plain === undefined) return undefined;
    if (this.qualifier === 'required' && trigger && trigger !== 'none') {
      const key = `${type}:${trigger}`;
      return this.prefixes[key] ?? (this.ignored.has(key) ? undefined : plain);
    }
    return plain;
  }

  /**
   * The plain and the qualified prefix, as element-id-naming accepts them
   * (`required`: only the qualified one; `off`: only the plain one).
   */
  headsOf({ type, trigger }: IdState): string[] {
    const plain = this.prefixes[type];
    if (plain === undefined) return [];
    const key = `${type}:${trigger}`;
    const qualified = trigger && trigger !== 'none' && this.qualifier !== 'off' ? this.prefixes[key] : undefined;
    if (!qualified) return this.qualifier === 'required' && this.ignored.has(key) ? [] : [plain];
    return this.qualifier === 'required' ? [qualified] : [plain, qualified];
  }

  /** Message flows without an entry of their own borrow the sequence flows' prefix. */
  borrowedHead(type: string): string | undefined {
    return type !== 'bpmn:SequenceFlow' && this.prefixes[type] === undefined ? this.prefixes['bpmn:SequenceFlow'] : undefined;
  }

  /**
   * Where the rule checks an element with a prefix new ids cannot have, it rejects every id
   * in practice: no id starts with a prefix that cannot start one.
   */
  rejects(state: IdState, id: string, heads = this.headsOf(state)): boolean {
    if (heads.length) return !this.passes(heads, id);
    return this.ignored.has(state.type) || this.prefixes[state.type] !== undefined;
  }

  acceptsId(id: string, state: IdState): boolean {
    const heads = this.headsOf(state);
    return !heads.length || heads.some((head) => id.startsWith(head));
  }

  headOf(id: string, state: IdState): string | undefined {
    return this.headsOf(state)
      .filter((head) => id.startsWith(head))
      .sort((first, second) => second.length - first.length)[0];
  }

  /** acceptsId, and the body is in the declared case too. */
  inDeclaredCase(id: string, state: IdState): boolean {
    const heads = this.headsOf(state);
    return !heads.length || this.passes(heads, id);
  }

  /** A prefix several kinds share (gateway_) votes once. */
  get votes(): Votes {
    if (this.shapeVotes) return this.shapeVotes;
    const votes = { kind: 0, literal: 0, lower: 0, upper: 0 };
    const voted = new Set<string>();
    for (const def of KINDS) {
      const match = PREFIXED.exec(`${this.prefixes[def.type] ?? ''}x`);
      if (!match || voted.has(match[1]!)) continue;
      voted.add(match[1]!);
      if (prefixClass(match[1]!, kindTypeNames(def), undefined, def.prefix) === 'literal') votes.literal++;
      else votes.kind++;
      if (/^[a-z]/.test(match[1]!)) votes.lower++;
      else votes.upper++;
    }
    return (this.shapeVotes = votes);
  }

  private passes(heads: string[], id: string): boolean {
    const head = heads.filter((candidate) => id.startsWith(candidate)).sort((first, second) => second.length - first.length)[0];
    if (head === undefined) return false;
    const pattern = this.case && CASE_BODY[this.case];
    return !pattern || pattern.test(id.slice(head.length));
  }
}
