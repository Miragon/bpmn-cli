import { KINDS } from '../model/kinds.js';
import { isUsablePrefix } from './utils/slug.js';
import { PREFIXED, prefixClass } from './utils/id-words.js';
import { kindTypeNames } from './utils/requests.js';
import type { IdConventions } from './IdConventionsReader.js';
import type { Body, IdState } from './IdStyle.js';

/** The declared prefixes as votes on the shape of a prefix nothing declares (DeclaredConventions.votes). */
export interface Votes {
  kind: number;
  literal: number;
  lower: number;
  upper: number;
}

const BODY_OF_CASE: Record<string, Body> = { camelCase: 'camel', PascalCase: 'pascal', snake_case: 'snake' };

/** The bodies element-id-naming accepts after the prefix under a declared case (its CASES patterns). */
const CASE_BODY: Partial<Record<Body, RegExp>> = { camel: /^[a-z][A-Za-z0-9]*$/, pascal: /^[A-Z][A-Za-z0-9]*$/, snake: /^[a-z0-9]+(_[a-z0-9]+)*$/ };

/** The declared conventions as the style uses them (IdConventions: the usable prefixes, the body case). */
export class DeclaredConventions {
  readonly case: Body | undefined;
  private shapeVotes: Votes | undefined;

  private constructor(
    readonly prefixes: Record<string, string>,
    readonly qualifier: 'off' | 'optional' | 'required',
    body: Body | undefined,
    /** IdConventions.ignored: the types the rule checks with a prefix new ids cannot have (`bpmn:ReceiveTask`), and the event types and triggers whose qualified prefix it requires and new ids cannot have (`bpmn:EndEvent:escalation`) */
    readonly ignored: Set<string>,
  ) {
    this.case = body;
  }

  /** The declared conventions a style uses: undefined where they declare no usable prefix. */
  static of(c: IdConventions | undefined): DeclaredConventions | undefined {
    const prefixes: Record<string, string> = {};
    for (const [key, prefix] of Object.entries(c?.prefixes ?? {})) if (isUsablePrefix(prefix)) prefixes[key] = prefix;
    if (!Object.keys(prefixes).length) return undefined;
    const body = c?.case ? BODY_OF_CASE[c.case] : undefined;
    return new DeclaredConventions(prefixes, c?.qualifier ?? 'optional', body, new Set(c?.ignored));
  }

  /**
   * The declared prefix of a new id of a type and trigger (with its
   * separator): the entry of the type; under the qualifier `required` an
   * event with a trigger takes the qualified one (timerStartEvent_);
   * undefined where nothing is declared, and where the required qualified
   * prefix is too long for new ids (`ignored`: such events follow the
   * learned style, like a type whose prefix is ignored).
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
   * The prefixes declared conventions accept for an element of a type and
   * trigger, as element-id-naming does: the type's entry, the qualified one of
   * its trigger too (`required`: only that one; `off`: never). [] where
   * nothing is declared for the type, and under `required` where the
   * qualified one is too long for new ids (`ignored`: the rule
   * accepts no prefix they can have).
   */
  headsOf({ type, trigger }: IdState): string[] {
    const plain = this.prefixes[type];
    if (plain === undefined) return [];
    const key = `${type}:${trigger}`;
    const qualified = trigger && trigger !== 'none' && this.qualifier !== 'off' ? this.prefixes[key] : undefined;
    if (!qualified) return this.qualifier === 'required' && this.ignored.has(key) ? [] : [plain];
    return this.qualifier === 'required' ? [qualified] : [plain, qualified];
  }

  /** The prefix message flows without an entry of their own borrow from the sequence flows (flowOf); undefined for sequence flows and where nothing is borrowed. */
  borrowedHead(type: string): string | undefined {
    return type !== 'bpmn:SequenceFlow' && this.prefixes[type] === undefined ? this.prefixes['bpmn:SequenceFlow'] : undefined;
  }

  /**
   * Whether element-id-naming rejects an id under the declared conventions
   * (LearnedStyle.unconforming): with the prefixes `heads` they accept for
   * its element, one it does not pass; where the rule checks the element with
   * a prefix new ids cannot have (`ignored`: a type whose prefix is
   * ignored; a type with an entry but no heads: under `required` an event
   * whose qualified prefix is too long), every id (no id starts with a prefix
   * that cannot start one or leaves no room, in practice); false where it
   * does not check the element.
   */
  rejects(state: IdState, id: string, heads = this.headsOf(state)): boolean {
    if (heads.length) return !this.passes(heads, id);
    return this.ignored.has(state.type) || this.prefixes[state.type] !== undefined;
  }

  /** Whether an id starts with a prefix the declared conventions accept for the state (also: they declare none for it). */
  acceptsId(id: string, state: IdState): boolean {
    const heads = this.headsOf(state);
    return !heads.length || heads.some((h) => id.startsWith(h));
  }

  /** The longest prefix the declared conventions accept for the state that the id starts with (undefined: none). */
  headOf(id: string, state: IdState): string | undefined {
    return this.headsOf(state)
      .filter((h) => id.startsWith(h))
      .sort((a, b) => b.length - a.length)[0];
  }

  /** acceptsId, and under a declared case its body after the prefix is in that case too (element-id-naming's pattern: passes), so `<id>Join` / `<id>_join` is. */
  inDeclaredCase(id: string, state: IdState): boolean {
    const heads = this.headsOf(state);
    return !heads.length || this.passes(heads, id);
  }

  /** The declared prefixes of the kinds as votes on the shape of a prefix nothing declares (prefixClass, first letter); a prefix several kinds share (gateway_) votes once. */
  get votes(): Votes {
    if (this.shapeVotes) return this.shapeVotes;
    const v = { kind: 0, literal: 0, lower: 0, upper: 0 };
    const voted = new Set<string>();
    for (const def of KINDS) {
      const m = PREFIXED.exec(`${this.prefixes[def.type] ?? ''}x`);
      if (!m || voted.has(m[1]!)) continue;
      voted.add(m[1]!);
      if (prefixClass(m[1]!, kindTypeNames(def), undefined, def.prefix) === 'literal') v.literal++;
      else v.kind++;
      if (/^[a-z]/.test(m[1]!)) v.lower++;
      else v.upper++;
    }
    return (this.shapeVotes = v);
  }

  /**
   * Whether an id passes element-id-naming with the prefixes `heads` the
   * declared conventions accept for its element: it starts with one, and its
   * body after the longest of them is in the declared case (CASE_BODY; none
   * declared: any body).
   */
  private passes(heads: string[], id: string): boolean {
    const head = heads.filter((h) => id.startsWith(h)).sort((a, b) => b.length - a.length)[0];
    if (head === undefined) return false;
    const pattern = this.case && CASE_BODY[this.case];
    return !pattern || pattern.test(id.slice(head.length));
  }
}
