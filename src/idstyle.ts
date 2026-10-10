/**
 * Edits follow the file: the id conventions of a document, so that new ids
 * look like the ones it already has, and every new id says what it names.
 *
 * CONTRACT
 *  IdStyle.infer(defs) reads the ids of the BPMN elements of a document
 *  (never DI or vendor ids) and learns, by majority:
 *   - the PREFIX per kind: the prefix the file uses for that kind (and
 *     trigger), else what its family uses (`Task_` for every task when the
 *     tasks share it), else the type name when the file names prefixes after
 *     the type (`serviceTask_`, `EndEvent_`; `Task_` on a plain task counts
 *     as a family prefix), else the bpmn-cli prefix (Activity, Event,
 *     Gateway, ...) in the file's prefix case (`event_`). "No prefix" is a
 *     prefix too: where the file's ids of a kind or family have none
 *     (`checkOrder`, `start`), or a kind without evidence of its own (and
 *     of a family without prefixed ids) sits in a file whose flow node ids
 *     mostly have none, a named element gets
 *     the bare name-derived body (`reviewOrder`; camel case, PascalCase in a
 *     pascal file) and an unnamed one the next prefix that rule chain gives;
 *   - the CASE of id bodies (voted by the named flow nodes; by every named
 *     element when they show none): `pascal` (Activity_CheckInvoice, the
 *     default), `camel` (serviceTask_checkInvoice), `snake`
 *     (Task_check_invoice) or `pascalSnake` (Task_Check_Invoice). Bodies
 *     that say nothing (Camunda Modeler hashes Activity_0k3x9qa, numbers
 *     Task_12) vote for no case: such a file gets pascal bodies with its own
 *     prefixes (Activity_CheckInvoice next to Activity_0k3x9qa);
 *   - the FORM of sequence flows and of message flows (a type without flows
 *     follows the sequence flows): `stemTo` (flow_checkStockToShipGoods: the
 *     ends' ids without prefix), `idPair` (Flow_Task_A_Task_B), `stemSnake`
 *     (Flow_check_stock_to_ship_goods), `idSnake` (Flow_Task_A_to_Task_B) or
 *     `scopedTo` (Flow_KotO_ValidateToReserve: a scope segment the flows
 *     share, then the first word of each end; a start / end event is Start /
 *     End), with the prefix those flows use; else `named`
 *     (Flow_CheckInvoiceToBookInvoice: the labels of the ends in the body
 *     case) with the prefix and separator of the file's flows (hashed
 *     Flow_0k3x9qa, numbered SF_12 or flow12: `flowCheckOrderToShip`). A form
 *     needs at least half of the flows of its type.
 *  A document without ids to learn from gets the default style: pascal
 *  bodies, the bpmn-cli prefixes, `named` flows with the prefix Flow.
 *
 *  Every generated id is SPEAKING (never a hash, a random or a running
 *  number): a named element's body is its name (a name needs a word with a
 *  letter: `123` names nothing); an unnamed element's body is a word for its
 *  kind plus its context (IdRequest.context: Gateway_AfterCheckInvoice,
 *  Event_TimerOnReview, Event_StartInPayment, LaneSet_OrderHandling; built
 *  by contextOf: an unnamed anchor that is itself after / before something
 *  gives the nearest named anchor, once: the task after Gateway_AfterCheck
 *  is Activity_AfterCheck, never Activity_AfterAfterCheck); a flow's body
 *  names its ends (labelOf: the speaking part of an end's id, also an
 *  unnamed end's own context, AfterCheck, and CheckJoin for the join of the
 *  split after Check; else its name, else a word for its kind). Names and
 *  contexts are transliterated (ä -> ae, ø -> oe, å -> aa, src/ids.ts). A
 *  generated id has at most MAX_ID (64) characters: a long body is cut at a
 *  word boundary, a flow's two ends share the room.
 *
 *  style.next(req, registry) returns a free id for a request (kindRequest /
 *  typeRequest / connectionRequest / flowRequest) and the id it wanted
 *  (`base`); an unnamed gateway or activity whose base is taken, or whose
 *  body another id has, first spells out its kind (spelledBase:
 *  Gateway_ParallelAfterCheck), then, after an unnamed anchor whose context
 *  it repeats (IdRequest.anchorKind, anchorContext), names the anchor's
 *  kind (qualifiedBase: Task_AfterCheckGateway after
 *  ExclusiveGateway_AfterCheck where the task prefix says the kind); a
 *  taken base gets `_2`, `_3` (the file-learned flow forms stemTo and
 *  scopedTo: `2`, `3`), so the same request on the same document always
 *  gives the same id; `id !== base` is W_ID_SUFFIXED (Doc.allocateId
 *  records it). A flow whose two ends begin with the same word (the unnamed
 *  elements after one anchor) keeps each end's last word when the length
 *  cap cuts it (fitPair), so the ends keep what tells them apart.
 *  style.derivedBase(req) is that base without allocating (derivedBases:
 *  also the uncut one, for ids written before the cut); style.joinId(gatewayId)
 *  the id of a split's join gateway.
 */
import { camelSlug, cutAt, hasIdWords, isValidId, MAX_ID, MAX_SLUG, nameWords, pascalSnakeSlug, slugify, snakeSlug, type IdRegistry } from './ids.js';
import { kindOf, triggerOf, type KindDef } from './kinds.js';
import { is, isBpmnElement, walk, type El } from './model.js';

/** The case of the bodies of new ids. */
export type Body = 'pascal' | 'camel' | 'snake' | 'pascalSnake';
/** How new flows are named (see the module contract). */
export type FlowForm = 'named' | 'stemTo' | 'idPair' | 'stemSnake' | 'idSnake' | 'scopedTo';

export interface IdRequest {
  /** style key: a kind of `bpmn kinds` (userTask, eventSubProcess, lane, ...) or a BPMN type (bpmn:Message, bpmn:LaneSet) */
  key: string;
  /** the bpmn-cli prefix of the kind (Activity, Event, Gateway, Message, ...) */
  prefix: string;
  /** names of the kind that a type-named prefix would use (serviceTask_, ServiceTask_), lowerCamel */
  typeNames: string[];
  /** event trigger (message, timer, ...) */
  trigger?: string;
  name?: string;
  /**
   * words that tell an element without name apart: where it is ("After Check
   * invoice", "On Review", "In Payment") or what it belongs to (the process
   * of a lane set, the ends of an association); with a word for the kind
   * they are the body of its id
   */
  context?: string;
  /**
   * a word for the kind of the unnamed anchor whose context `context`
   * repeats (anchorContext: `Gateway` for the gateway after Check, whose
   * context `After Check` an element after it repeats): where the id from
   * the context alone, or its body, is taken, the context names that anchor
   * too (`After Check Gateway`), before a suffix
   */
  anchorKind?: string;
  /** connections (sequence / message flows): the ids of the ends */
  source?: string;
  target?: string;
  /** connections: the speaking labels of the ends (labelOf; default: the speaking part of the end ids) */
  sourceLabel?: string;
  targetLabel?: string;
}

/** How a type's flows are named: the form, its prefix, the separator after the prefix ('' in `flow12` files), the scope of `scopedTo`. */
export interface FlowStyle {
  form: FlowForm;
  prefix: string;
  sep?: string;
  scope?: string;
}

export interface IdStyleInfo {
  body: Body;
  sequenceFlow: FlowStyle;
  messageFlow: FlowStyle;
}

/* ------------------------------------------------------------------ */
/* requests                                                             */
/* ------------------------------------------------------------------ */

const lcfirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const ucfirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const localName = (type: string): string => type.slice(type.indexOf(':') + 1);

/** Names a type-named prefix of the kind could use: the kind and its BPMN type (`dataObject`, `dataObjectReference`). */
function kindTypeNames(def: KindDef): string[] {
  return [...new Set([def.kind, lcfirst(localName(def.type))])];
}

/** The request for an element of a kind of `bpmn kinds`. */
export function kindRequest(def: KindDef, opts: { trigger?: string; name?: string; context?: string; anchorKind?: string } = {}): IdRequest {
  return { key: def.kind, prefix: def.prefix, typeNames: kindTypeNames(def), ...opts };
}

/** The request for an element of another BPMN type (bpmn:Message, bpmn:LaneSet, bpmn:Association, ...). */
export function typeRequest(type: string, opts: { name?: string; context?: string; prefix?: string } = {}): IdRequest {
  const { prefix, ...rest } = opts;
  return { key: type, prefix: prefix ?? localName(type), typeNames: [lcfirst(localName(type))], ...rest };
}

/** The request for a sequence flow or message flow from `source` to `target` (ids; their labels: see flowRequest). */
export function connectionRequest(
  type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow',
  source: string,
  target: string,
  opts: { name?: string; sourceLabel?: string; targetLabel?: string } = {},
): IdRequest {
  const { name, ...labels } = opts;
  return { key: type, prefix: 'Flow', typeNames: [lcfirst(localName(type))], source, target, ...(name ? { name } : {}), ...labels };
}

/** The request for a connection between two elements: their ids and speaking labels (labelOf). */
export function flowRequest(type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source: El, target: El, name?: string): IdRequest {
  return connectionRequest(type, source.get<string>('id'), target.get<string>('id'), { ...(name ? { name } : {}), sourceLabel: labelOf(source), targetLabel: labelOf(target) });
}

/**
 * A word for an element of a kind (the start of an unnamed element's body,
 * the label of an unnamed flow end): Start, MessageStart, End, ErrorEnd,
 * Timer (catch and boundary events), MessageThrow, Intermediate; Exclusive,
 * Parallel (gateways); Task, UserTask, SubProcess; LaneSet, ...; Main (a
 * process or collaboration). With a context, the prefix says enough for
 * every kind but the events (Gateway_AfterCheckInvoice): ''.
 */
export function kindWord(key: string, trigger: string | undefined, withContext = false): string {
  const t = trigger && trigger !== 'none' ? ucfirst(trigger) : '';
  switch (key) {
    case 'startEvent':
      return `${t}Start`;
    case 'endEvent':
      return `${t}End`;
    case 'boundaryEvent':
      return t || 'Boundary';
    case 'intermediateCatchEvent':
      return t || 'Catch';
    case 'intermediateThrowEvent':
      return t ? `${t}Throw` : 'Intermediate';
  }
  if (withContext) return '';
  if (/^[a-z]+Gateway$/.test(key)) return ucfirst(key.slice(0, -'Gateway'.length));
  // the one process of a file, the collaboration of its pools
  if (key === 'bpmn:Process' || key === 'bpmn:Collaboration') return 'Main';
  return ucfirst(localName(key));
}

const CONNECTIONS = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);

/** The longest base id: MAX_ID less room for a collision suffix (`_99`), so that a suffix never has to cut it further. */
const MAX_BASE = MAX_ID - 3;

/* ------------------------------------------------------------------ */
/* classification                                                       */
/* ------------------------------------------------------------------ */

const PREFIXED = /^([A-Za-z][A-Za-z0-9]*)_(.+)$/;
/** A number glued to its prefix: `flow12`, `f3`. */
const GLUED = /^([A-Za-z]+)(\d+)$/;
/** `<scope>_<A>To<B>` after a flow prefix: Flow_KotO_ValidateToReserve. */
const SCOPED_TO = /^([A-Za-z][A-Za-z0-9]*)_([A-Z][A-Za-z0-9]*?)To([A-Z][A-Za-z0-9]*)$/;

/**
 * One element is not a convention: a learned rule needs two ids that follow
 * it. In a file whose ids are mostly prefixed (at least three, at least half
 * of them), one id is enough for the prefix of its own kind (`End_1` for the
 * next end event) and of its family.
 */
const MIN_EVIDENCE = 2;

/** Tool defaults that say nothing about a file's conventions (the Camunda Modeler's first start event). */
const TOOL_DEFAULTS = new Set(['StartEvent_1']);
const HASH = /^[01][0-9a-z]{6}$/;

type BodyClass = Body | 'hash' | 'numbered' | 'lower' | 'other';

/** The class of an id body (the part after the prefix); a collision suffix `_2` is ignored. */
function bodyClass(body: string): BodyClass {
  if (HASH.test(body)) return 'hash';
  if (/^\d+$/.test(body)) return 'numbered';
  const b = body.replace(/_\d+$/, '');
  if (/^[A-Z][A-Za-z0-9]*$/.test(b)) return 'pascal';
  if (/^[a-z][a-z0-9]*$/.test(b)) return 'lower';
  if (/^[a-z][A-Za-z0-9]*$/.test(b)) return 'camel';
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(b)) return 'snake';
  if (/^[A-Z][A-Za-z0-9]*(_[A-Za-z0-9]+)+$/.test(b)) return 'pascalSnake';
  return 'other';
}

type PrefixClass = 'kind' | 'triggerKind' | 'literal';

/**
 * Prefixes that name a type but are also the usual generic prefix of their
 * family: `Task_` on a plain task may be the old modeler's type name or a
 * `Task_` for every task. Such a prefix counts as the family's prefix, and
 * on its own type it says nothing about type-named prefixes.
 */
const GENERIC = new Set(['task']);

/**
 * `kind`: the prefix names the element's type (serviceTask_, EndEvent_),
 * `triggerKind`: its trigger and type (messageBoundaryEvent_), else a
 * `literal` (Task_, End_, Activity_). The bpmn-cli prefix of the family is a
 * literal even where it is the type name (Lane_, Message_, LaneSet_): it says
 * nothing about type-named prefixes; so is `Task_` (GENERIC).
 */
function prefixClass(prefix: string, typeNames: string[], trigger: string | undefined, family: string): PrefixClass {
  const p = prefix.toLowerCase();
  if (p === family.toLowerCase() || GENERIC.has(p)) return 'literal';
  if (typeNames.some((n) => n.toLowerCase() === p)) return 'kind';
  if (trigger && typeNames.some((n) => `${trigger}${n}`.toLowerCase() === p)) return 'triggerKind';
  return 'literal';
}

/** A literal prefix that abbreviates its own kind (End, Start, Call, Sub, Boundary, Timer) says nothing about other kinds. */
function isSpecific(prefix: string, typeNames: string[], trigger: string | undefined, family: string): boolean {
  const p = prefix.toLowerCase();
  if (p === family.toLowerCase() || GENERIC.has(p)) return false;
  return typeNames.some((n) => n.toLowerCase().startsWith(p)) || (!!trigger && trigger.toLowerCase().startsWith(p));
}

/** The id without its prefix (`serviceTask_checkStock` -> `checkStock`). */
function stem(id: string): string {
  const i = id.indexOf('_');
  return i === -1 ? id : id.slice(i + 1);
}

/**
 * The part of an id that says what the element is (`CheckInvoice` of
 * Activity_CheckInvoice, `checkOrder` of a bare checkOrder), or undefined
 * for ids that say nothing: tool defaults (StartEvent_1), Camunda Modeler
 * hashes (Activity_0k3x9qa), numbers (Task_12, flow12) and machine ids
 * (sid-6F1C..., UUIDs: mostly digits).
 */
export function speakingStem(id: string): string | undefined {
  if (TOOL_DEFAULTS.has(id) || GLUED.test(id)) return undefined;
  // a collision suffix belongs to the stem (reviewOrder_2, Activity_Check_2); `Task_12` is a number, not a suffix
  const suffixed = /^(.+)_(\d+)$/.exec(id);
  if (suffixed && (suffixed[1]!.includes('_') || nameWords(suffixed[1]).length > 1)) {
    const base = speakingStem(suffixed[1]!);
    return base ? `${base}_${suffixed[2]}` : undefined;
  }
  const s = stem(id);
  if (HASH.test(s) || /^\d+$/.test(s) || !/[A-Za-z]/.test(s)) return undefined;
  const digits = s.replace(/[^0-9]/g, '').length;
  if (digits >= 3 && digits * 4 >= s.length) return undefined;
  return s;
}

/** The words that tie an unnamed element's id to its place (Gateway_AfterCheckInvoice, Event_TimerOnReview, Event_StartInPayment). */
export type ContextWord = 'After' | 'Before' | 'On' | 'In';
const CONTEXT_WORDS = new Set(['after', 'before', 'on', 'in']);

/** The words of an id stem, split at case changes, between letters and digits and at separators (`After4AugenPrinzip` -> After, 4, Augen, Prinzip). */
function stemWords(stem: string): string[] {
  return stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/**
 * An id body made from a kind and a context (`AfterCheckInvoice`,
 * `EndAfterTimer`, `timer_on_review`): the words before the first context
 * word among its first three words (the kind: `End`, none for a gateway or
 * task), that word and the words after it (the anchor); a collision suffix
 * is not part of the anchor. Undefined for any other stem.
 */
function contextParts(stem: string): { head: string[]; word: ContextWord; tail: string[] } | undefined {
  const words = stemWords(stem.replace(/_\d+$/, ''));
  const i = words.slice(0, 3).findIndex((w) => CONTEXT_WORDS.has(w.toLowerCase()));
  if (i === -1 || i === words.length - 1) return undefined;
  return { head: words.slice(0, i), word: ucfirst(words[i]!.toLowerCase()) as ContextWord, tail: words.slice(i + 1) };
}

/**
 * The label of an unnamed join a split gave its gateway's id (`<id>_join`,
 * `<id>Join`): the split's anchor and Join (Gateway_AfterCheck_join ->
 * `Check Join`; Gateway_InvoiceOk_join keeps `InvoiceOk_join`).
 */
function joinLabel(own: string): string | undefined {
  const m = /^(.+?)_?join$/i.exec(own);
  if (!m) return undefined;
  const parts = contextParts(m[1]!);
  return parts && !parts.head.length && parts.word === 'After' ? `${parts.tail.join(' ')} Join` : undefined;
}

/**
 * How another id names an element (the ends of a flow, what an element
 * belongs to), so that ids are built from ids: the speaking part of its id
 * (Activity_CheckInvoice -> CheckInvoice, also after a rename of the
 * element; an unnamed element's own context, Gateway_AfterCheckInvoice ->
 * AfterCheckInvoice, so the flows at two unnamed gateways differ; the join
 * of the split after Check -> `Check Join`); else, for an id that says too
 * little (a hash, a number, one or two letters such as Part_B), its name; a
 * text annotation its text; else a word for its kind (Gateway, End, Timer,
 * UserTask, Flow, ...).
 */
export function labelOf(el: El): string {
  const id = el.get<string | undefined>('id');
  const name = el.get<string | undefined>('name');
  const own = id ? speakingStem(id) : undefined;
  const named = hasIdWords(name);
  if (is(el, 'bpmn:TextAnnotation')) {
    const text = el.get<string | undefined>('text');
    return own ?? (nameWords(text).length ? text! : 'TextAnnotation');
  }
  if (own && (!named || own.replace(/[^A-Za-z]/g, '').length >= 3)) return named ? own : (joinLabel(own) ?? own);
  if (named) return name!;
  return kindLabel(el);
}

/** A word for the kind of an element without a speaking id or name (Gateway, End, Timer, UserTask, Flow, ...). */
function kindLabel(el: El): string {
  if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) return 'Flow';
  const def = kindOf(el);
  if (def?.family === 'gateway') return 'Gateway';
  if (def) return kindWord(def.kind, triggerOf(el));
  return localName(el.$type);
}

/**
 * The context an anchor gives an unnamed element (`After Check invoice`,
 * `On Review`, `In Payment`): `<word> <labelOf(anchor)>`, but an anchor
 * that is itself unnamed and placed the same way gives its own anchor (the
 * nearest named anchor, once: after Gateway_AfterCheck is `After Check`,
 * never `After AfterCheck`), and an unnamed anchor whose id starts with its
 * context says its kind first (`On Task AfterCheck`).
 */
export function contextOf(word: ContextWord, anchor: El): string {
  return anchorContext(word, anchor).context;
}

/** The context of an unnamed element (contextOf) and, where it repeats an unnamed anchor's own context, a word for that anchor's kind (IdRequest.anchorKind). */
export interface AnchorContext {
  context: string;
  anchorKind?: string;
}

/**
 * contextOf with the kind of the anchor it names past: after or before an
 * unnamed anchor placed the same way (Gateway_AfterCheck) the context is the
 * anchor's own (`After Check`), and `anchorKind` (`Gateway`) tells the new
 * element apart where its id would repeat the anchor's body
 * (Task_AfterCheckGateway after ExclusiveGateway_AfterCheck in a file whose
 * task prefix says the kind; IdStyle.next).
 */
export function anchorContext(word: ContextWord, anchor: El): AnchorContext {
  const label = labelOf(anchor);
  const id = anchor.get<string | undefined>('id');
  const own = id ? speakingStem(id) : undefined;
  if (!own || is(anchor, 'bpmn:TextAnnotation') || hasIdWords(anchor.get<string | undefined>('name'))) return { context: `${word} ${label}` };
  const parts = contextParts(own);
  if (!parts) return { context: `${word} ${label}` };
  if (parts.word === word && (word === 'After' || word === 'Before')) return { context: `${word} ${parts.tail.join(' ')}`, anchorKind: kindLabel(anchor) };
  // the join's label says its kind (Check Join)
  if (!parts.head.length && label === own) return { context: `${word} ${kindLabel(anchor)} ${label}` };
  return { context: `${word} ${label}` };
}

/**
 * The labels earlier versions gave an element as a flow end (followEnds
 * recognises a flow named by them): an unnamed element whose id tells its
 * context was named by its kind (Gateway, Join, End, Timer).
 */
export function formerLabels(el: El): string[] {
  const id = el.get<string | undefined>('id');
  const own = id ? speakingStem(id) : undefined;
  if (!own || hasIdWords(el.get<string | undefined>('name')) || is(el, 'bpmn:TextAnnotation') || !contextParts(own)) return [];
  return [kindOf(el)?.family === 'gateway' && /join$/i.test(own) ? 'Join' : kindLabel(el)];
}

/** A flow form as read from a file: the forms new flows get, or hashed / numbered flows (new ones get `named` with their prefix). */
type SeenForm = FlowForm | 'hash' | 'numbered';
interface SeenFlow {
  form: SeenForm;
  prefix: string;
  sep?: string;
  scope?: string;
}

/** The flow forms an id matches, given its ends (none: only its prefix counts). */
function flowForms(id: string, source: string, target: string): SeenFlow[] {
  const m = PREFIXED.exec(id);
  if (!m) {
    const g = GLUED.exec(id);
    return g ? [{ form: 'numbered', prefix: g[1]!, sep: '' }] : [];
  }
  const prefix = m[1]!;
  const rest = m[2]!;
  if (HASH.test(rest)) return [{ form: 'hash', prefix }];
  if (/^\d+$/.test(rest)) return [{ form: 'numbered', prefix }];
  const out: SeenFlow[] = [];
  const scoped = SCOPED_TO.exec(rest);
  if (scoped) out.push({ form: 'scopedTo', prefix, scope: scoped[1]! });
  // the form itself, or the form with a collision suffix (`2` / `_2`)
  const fits = (candidate: string, sep: string): boolean => rest === candidate || (rest.startsWith(candidate) && new RegExp(`^${sep}\\d+$`).test(rest.slice(candidate.length)));
  if (fits(`${lcfirst(stem(source))}To${ucfirst(stem(target))}`, '')) out.push({ form: 'stemTo', prefix });
  if (fits(`${source}_${target}`, '_')) out.push({ form: 'idPair', prefix });
  if (fits(`${stem(source)}_to_${stem(target)}`, '_')) out.push({ form: 'stemSnake', prefix });
  if (fits(`${source}_to_${target}`, '_')) out.push({ form: 'idSnake', prefix });
  return out;
}

/* ------------------------------------------------------------------ */
/* learning                                                             */
/* ------------------------------------------------------------------ */

class Tally<K> {
  readonly counts = new Map<K, number>();
  add(k: K, n = 1): void {
    this.counts.set(k, (this.counts.get(k) ?? 0) + n);
  }
  get(k: K): number {
    return this.counts.get(k) ?? 0;
  }
  get total(): number {
    let t = 0;
    for (const v of this.counts.values()) t += v;
    return t;
  }
  /** The most frequent key with at least `min` occurrences (ties: the first one counted). */
  top(min = MIN_EVIDENCE): K | undefined {
    let best: K | undefined;
    let n = 0;
    for (const [k, v] of this.counts) {
      if (v > n) {
        best = k;
        n = v;
      }
    }
    return n >= min ? best : undefined;
  }
}

interface FamilyStats {
  kindish: Tally<string>;
  generic: Tally<string>;
  /** ids of the family with a prefix, any */
  prefixed: number;
}

interface Learned {
  /** literal prefixes per key and per key|trigger */
  byKey: Map<string, Tally<string>>;
  byKeyTrigger: Map<string, Tally<string>>;
  classByKey: Map<string, Tally<PrefixClass>>;
  family: Map<string, FamilyStats>;
  classes: Tally<PrefixClass>;
  lowerFirst: number;
  upperFirst: number;
  body: Body;
  flows: Map<string, FlowStyle>;
  /** the file's ids are mostly prefixed (see MIN_EVIDENCE): one id is evidence for its kind and family */
  strong: boolean;
  /** scopedTo flows: the scopes of a type's flows, most used first */
  scopes: Map<string, string[]>;
  /** flow node ids without / with a prefix: a file whose flow nodes mostly have none gives a kind without own evidence none either */
  bareNodes: number;
  prefixedNodes: number;
  /** the case of bare ids (voted by the bare ids that spell their names; prefixed ids vote `body`) */
  bareBody: 'pascal' | 'camel';
}

function tallyOf<K>(map: Map<string, Tally<K>>, key: string): Tally<K> {
  let t = map.get(key);
  if (!t) map.set(key, (t = new Tally<K>()));
  return t;
}

interface Sample {
  key: string;
  family: string;
  typeNames: string[];
  trigger?: string;
  id: string;
  named: boolean;
  /** the id spells the element's name (`checkOrder` for "Check order", `branch1` for "Branch 1") */
  spellsName: boolean;
  /** a flow node (task, event, gateway, sub-process, call activity) */
  flowNode: boolean;
}

/** A name or id as lower-case letters and digits only (`Check order` and `checkOrder` -> `checkorder`). */
const folded = (text: string): string => nameWords(text).join('').toLowerCase();

const FLOW_NODE_FAMILIES = new Set(['task', 'subProcess', 'callActivity', 'gateway', 'event']);

/** BPMN elements whose ids say nothing about the conventions (tool defaults, ids nobody chooses). */
const IGNORED = ['bpmn:Definitions', 'bpmn:Process', 'bpmn:EventDefinition', 'bpmn:Expression', 'bpmn:ExtensionElements', 'bpmn:Documentation', 'bpmn:LoopCharacteristics', 'bpmn:InputOutputSpecification', 'bpmn:InputSet', 'bpmn:OutputSet'];

function sampleOf(el: El, id: string): Sample | undefined {
  if (IGNORED.some((t) => is(el, t))) return undefined;
  const name = el.get<string | undefined>('name');
  const named = !!name && nameWords(name).length > 0;
  const spellsName = named && folded(id) === folded(name!);
  const def = kindOf(el);
  if (def) {
    const trigger = triggerOf(el);
    return { key: def.kind, family: def.prefix, typeNames: kindTypeNames(def), ...(trigger && trigger !== 'none' ? { trigger } : {}), id, named, spellsName, flowNode: FLOW_NODE_FAMILIES.has(def.family) };
  }
  const local = localName(el.$type);
  return { key: el.$type, family: local, typeNames: [lcfirst(local)], id, named, spellsName, flowNode: false };
}

function learn(defs: El | undefined): Learned {
  const l: Learned = {
    byKey: new Map(),
    byKeyTrigger: new Map(),
    classByKey: new Map(),
    family: new Map(),
    classes: new Tally(),
    lowerFirst: 0,
    upperFirst: 0,
    body: 'pascal',
    flows: new Map(),
    scopes: new Map(),
    bareNodes: 0,
    bareBody: 'camel',
    prefixedNodes: 0,
    strong: false,
  };
  let samples = 0;
  let prefixed = 0;
  const nodeBodies = new Tally<BodyClass>();
  const bareBodies = new Tally<BodyClass>();
  const otherBodies = new Tally<BodyClass>();
  const flowVotes = new Map<string, { n: number; forms: Tally<SeenForm>; prefixes: Map<SeenForm, Tally<string>>; any: Tally<string>; seps: Map<string, string>; scopes: Tally<string> }>();

  for (const el of defs ? walk(defs, { bpmnOnly: true }) : []) {
    if (!isBpmnElement(el) || /^(bpmndi|dc|di):/.test(el.$type)) continue;
    const id = el.get<string | undefined>('id');
    if (!id) continue;
    if (CONNECTIONS.has(el.$type)) {
      const source = el.get<El | undefined>('sourceRef')?.get<string | undefined>('id');
      const target = el.get<El | undefined>('targetRef')?.get<string | undefined>('id');
      let v = flowVotes.get(el.$type);
      if (!v) flowVotes.set(el.$type, (v = { n: 0, forms: new Tally(), prefixes: new Map(), any: new Tally(), seps: new Map(), scopes: new Tally() }));
      v.n++;
      const p = PREFIXED.exec(id)?.[1];
      if (p) v.any.add(p);
      if (!source || !target) continue;
      for (const f of flowForms(id, source, target)) {
        v.forms.add(f.form);
        let t = v.prefixes.get(f.form);
        if (!t) v.prefixes.set(f.form, (t = new Tally()));
        t.add(f.prefix);
        if (f.sep !== undefined && !v.seps.has(f.prefix)) v.seps.set(f.prefix, f.sep);
        if (f.scope) v.scopes.add(f.scope);
      }
      continue;
    }
    if (TOOL_DEFAULTS.has(id)) continue;
    const s = sampleOf(el, id);
    if (!s) continue;
    samples++;
    const m = PREFIXED.exec(id);
    let fam = l.family.get(s.family);
    if (!fam) l.family.set(s.family, (fam = { kindish: new Tally(), generic: new Tally(), prefixed: 0 }));
    if (!m) {
      // no prefix, and the id spells the name (`checkOrder` for "Check order"): a convention for its kind and
      // family, the whole id is the body. A short id that is no name (`GW`, `Start` for "Started") says nothing.
      if (!s.spellsName) continue;
      tallyOf(l.byKey, s.key).add('');
      if (s.trigger) tallyOf(l.byKeyTrigger, `${s.key}|${s.trigger}`).add('');
      tallyOf(l.classByKey, s.key).add('literal');
      fam.generic.add('');
      bareBodies.add(bodyClass(id));
      if (s.flowNode) l.bareNodes++;
      continue;
    }
    prefixed++;
    fam.prefixed++;
    if (s.flowNode) l.prefixedNodes++;
    const prefix = m[1]!;
    const body = m[2]!;
    const cls = prefixClass(prefix, s.typeNames, s.trigger, s.family);
    tallyOf(l.byKey, s.key).add(prefix);
    if (s.trigger) tallyOf(l.byKeyTrigger, `${s.key}|${s.trigger}`).add(prefix);
    tallyOf(l.classByKey, s.key).add(cls);
    // `Task_` on a plain task: neither for nor against type-named prefixes
    if (!(GENERIC.has(prefix.toLowerCase()) && s.typeNames.some((n) => n.toLowerCase() === prefix.toLowerCase()))) l.classes.add(cls);
    if (/^[a-z]/.test(prefix)) l.lowerFirst++;
    else l.upperFirst++;
    if (cls !== 'literal') fam.kindish.add(cls === 'triggerKind' ? 'triggerKind' : 'kind');
    else if (!isSpecific(prefix, s.typeNames, s.trigger, s.family)) fam.generic.add(prefix);
    if (s.named) (s.flowNode ? nodeBodies : otherBodies).add(bodyClass(body));
  }

  l.strong = prefixed >= 3 && prefixed * 2 >= samples;

  // case of the bodies: the named flow nodes' when they show one (pools, lanes, messages often keep tool ids);
  // a single lower-case word fits camel and snake alike; hashes and numbers show none (pascal)
  // bare ids: PascalCase when the file writes them so, else camelCase (single lower-case words read as camel)
  l.bareBody = bareBodies.get('pascal') > bareBodies.get('camel') + bareBodies.get('lower') ? 'pascal' : 'camel';
  const bodies = nodeBodies.total >= MIN_EVIDENCE ? nodeBodies : otherBodies;
  if (bodies === otherBodies) for (const [k, v] of nodeBodies.counts) bodies.add(k, v);
  const camel = bodies.get('camel');
  const snake = bodies.get('snake');
  const lower = bodies.get('lower');
  const votes: Array<[Body, number]> = [
    ['pascal', bodies.get('pascal')],
    ['camel', camel + (camel > 0 && camel >= snake ? lower : 0)],
    ['snake', snake + (camel > 0 && camel >= snake ? 0 : lower)],
    ['pascalSnake', bodies.get('pascalSnake')],
  ];
  let best: [Body, number] = ['pascal', MIN_EVIDENCE - 1];
  for (const v of votes) if (v[1] > best[1]) best = v;
  l.body = best[0];

  for (const [type, v] of flowVotes) {
    const form = v.forms.top();
    const prefix = form ? v.prefixes.get(form)!.top() : undefined;
    const scope = form === 'scopedTo' ? v.scopes.top() : undefined;
    if (form && prefix && v.forms.get(form) * 2 >= v.n && (form !== 'scopedTo' || scope)) {
      const sep = v.seps.get(prefix);
      // hashed and numbered flows lend new flows their prefix (and a numbered prefix's separator: flow12 -> flowAToB)
      const named = form === 'hash' || form === 'numbered';
      l.flows.set(type, { form: named ? 'named' : form, prefix, ...(form === 'numbered' && sep !== undefined ? { sep } : {}), ...(scope ? { scope } : {}) });
      if (form === 'scopedTo') l.scopes.set(type, [...v.scopes.counts.keys()].sort((a, b) => v.scopes.get(b) - v.scopes.get(a)));
    } else l.flows.set(type, { form: 'named', prefix: v.any.top() ?? 'Flow' });
  }
  return l;
}

/* ------------------------------------------------------------------ */
/* the style                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_FLOW: FlowStyle = { form: 'named', prefix: 'Flow' };

export class IdStyle {
  private constructor(private readonly l: Learned) {}

  /** The bpmn-cli default: pascal bodies, bpmn-cli prefixes, `named` flows (Flow_CheckInvoiceToBookInvoice). */
  static readonly DEFAULT = new IdStyle(learn(undefined));

  /** Learns the conventions of a document (see the module contract). */
  static infer(defs: El): IdStyle {
    return new IdStyle(learn(defs));
  }

  info(): IdStyleInfo {
    const sequenceFlow = this.flowOf('bpmn:SequenceFlow');
    return { body: this.l.body, sequenceFlow, messageFlow: this.flowOf('bpmn:MessageFlow') };
  }

  private flowOf(type: string): FlowStyle {
    return this.l.flows.get(type) ?? this.l.flows.get('bpmn:SequenceFlow') ?? DEFAULT_FLOW;
  }

  private caseLike(name: string, lowerFirst: boolean): string {
    return lowerFirst ? lcfirst(name) : ucfirst(name);
  }

  /**
   * The prefix a new element of the request's kind gets (see the module
   * contract); '' when the file's ids of the kind have none (only with
   * `bare`: a named element's id can do without a prefix, an unnamed one
   * cannot).
   */
  prefixFor(req: IdRequest, bare = true): string {
    const l = this.l;
    const lowerFile = l.lowerFirst >= MIN_EVIDENCE && l.lowerFirst > l.upperFirst;
    const min = l.strong ? 1 : MIN_EVIDENCE;
    const typeName = req.typeNames[0]!;
    const withTrigger = (lowerFirst: boolean): string => this.caseLike(req.trigger ? `${req.trigger}${ucfirst(typeName)}` : typeName, lowerFirst);
    const usable = (p: string | undefined): p is string => p !== undefined && (bare || p !== '');
    if (req.trigger) {
      const exact = l.byKeyTrigger.get(`${req.key}|${req.trigger}`)?.top(min);
      if (usable(exact)) return exact;
    }
    const own = l.byKey.get(req.key);
    const ownTop = own?.top(min);
    if (usable(ownTop)) {
      const cls = l.classByKey.get(req.key)!;
      if (ownTop && cls.get('triggerKind') > cls.get('kind') && cls.get('triggerKind') >= cls.get('literal')) return withTrigger(/^[a-z]/.test(ownTop));
      return ownTop;
    }
    const fam = l.family.get(req.prefix);
    if (fam) {
      const generic = fam.generic.top(min);
      const kindish = fam.kindish.total;
      if (usable(generic) && fam.generic.get(generic) >= kindish) return generic;
      if (kindish >= MIN_EVIDENCE) return fam.kindish.get('triggerKind') > fam.kindish.get('kind') ? withTrigger(lowerFile) : this.caseLike(typeName, lowerFile);
    }
    // a family the file has prefixed ids of (one is enough) keeps a prefix; else the file's flow nodes decide
    if (bare && !fam?.prefixed && l.bareNodes >= MIN_EVIDENCE && l.bareNodes > l.prefixedNodes) return '';
    const kindish = l.classes.get('kind') + l.classes.get('triggerKind');
    if (kindish >= MIN_EVIDENCE && kindish > l.classes.get('literal')) return this.caseLike(typeName, lowerFile);
    return this.caseLike(req.prefix, lowerFile);
  }

  /** A name or a context as an id body in the file's case ('' when it has no usable words). */
  private bodyOf(text: string | undefined): string {
    switch (this.l.body) {
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

  /**
   * A name-derived id without prefix in the case of the file's bare ids:
   * camelCase (also for single lower-case words; snake_case would read as a
   * prefix) or PascalCase; '' when the name gives no valid id.
   */
  private bareBody(name: string | undefined): string {
    const body = this.l.bareBody === 'pascal' ? slugify(name) : camelSlug(name);
    return body && isValidId(body) && !PREFIXED.test(body) ? body : '';
  }

  /**
   * What an unnamed element's id says: a word for its kind and its context
   * (`Timer On Review`, `After Check invoice`); `spelled`: the word for a
   * gateway's or an activity's kind too, which the prefix otherwise says
   * (`Parallel After Check invoice`).
   */
  private unnamedText(req: IdRequest, spelled = false): string {
    const context = nameWords(req.context).length ? req.context! : '';
    return `${kindWord(req.key, req.trigger, !!context && !spelled)} ${context}`.trim();
  }

  /**
   * The id an element request wants (before collision handling): its name,
   * else its kind and context, after the file's prefix; at most MAX_BASE
   * characters. `qualified`: the context ends with the anchor's kind
   * (IdRequest.anchorKind), which a cut of a long context leaves in place.
   */
  private derived(req: IdRequest, spelled = false, qualified = false): string {
    const named = hasIdWords(req.name);
    const prefix = this.prefixFor(req);
    if (prefix === '' && named) {
      const bare = this.bareBody(req.name);
      if (bare) return cutAt(bare, MAX_BASE);
    }
    // an unnamed element keeps a prefix in a file whose named ids have none
    const p = prefix === '' ? this.prefixFor(req, false) : prefix;
    const room = Math.max(MAX_BASE - p.length - 1, 8);
    const body = this.bodyOf(named ? req.name : this.unnamedText(req, spelled)) || this.bodyOf(kindWord(req.key, req.trigger));
    if (qualified && !named && req.anchorKind) return `${p}_${this.withWord(body, req.anchorKind, Math.min(room, MAX_SLUG))}`;
    return `${p}_${cutAt(body, room)}`;
  }

  /** A body with a word appended in the file's case (`AfterCheck` + Gateway -> `AfterCheckGateway`, `after_check_gateway`), the body cut so that the word stays within `max`. */
  private withWord(body: string, word: string, max: number): string {
    const tail = this.l.body === 'snake' ? `_${snakeSlug(word)}` : this.l.body === 'pascalSnake' ? `_${pascalSnakeSlug(word)}` : slugify(word);
    return `${cutAt(body, Math.max(max - tail.length, 8))}${tail}`;
  }

  /**
   * The id an unnamed gateway or activity with a context takes before a
   * collision suffix: its kind spelled out (`Gateway_ParallelAfterCheck`
   * next to `Gateway_AfterCheck`, `Activity_TaskAfterCheck` next to
   * `Activity_AfterCheck` or to the `Gateway_AfterCheck` it follows);
   * undefined for every other request and where the prefix already says
   * the kind (`parallelGateway_`, `Task_` for a task).
   */
  private spelledBase(req: IdRequest): string | undefined {
    if (!SPELLABLE.has(req.key) || hasIdWords(req.name) || !nameWords(req.context).length) return undefined;
    const word = kindWord(req.key, req.trigger).toLowerCase();
    const prefix = (this.prefixFor(req) || this.prefixFor(req, false)).toLowerCase();
    if (prefix.includes(word)) return undefined;
    return this.derived(req, true);
  }

  /**
   * The id an unnamed element after an unnamed anchor takes where its own id
   * (or its spelled one) repeats the anchor's: its context ends with the
   * anchor's kind (`Task_AfterCheckGateway` after `ExclusiveGateway_AfterCheck`,
   * `Activity_AfterCheckServiceTask` after `Activity_ServiceTaskAfterCheck`);
   * undefined without IdRequest.anchorKind.
   */
  private qualifiedBase(req: IdRequest): string | undefined {
    if (!req.anchorKind || hasIdWords(req.name) || !nameWords(req.context).length) return undefined;
    return this.derived(req, false, true);
  }

  /** The id a request wants before collision handling (Doc.allocateId reports a different result as W_ID_SUFFIXED). */
  derivedBase(req: IdRequest): string {
    return this.wanted(req).base;
  }

  /**
   * The ids a request wants: derivedBase, and for a flow between ends with
   * long ids also the id before the length cap (a flow a file got before
   * the cut still names its ends: ops/flows.ts followEnds).
   */
  derivedBases(req: IdRequest): string[] {
    return [...new Set([this.wanted(req).base, this.wanted(req, Infinity).base])];
  }

  /** The id the request wants and the separator of its collision suffix (`_2`; the file-learned stemTo and scopedTo flows: `2`). */
  private wanted(req: IdRequest, max = MAX_BASE): { base: string; sep: string } {
    if (CONNECTIONS.has(req.key) && req.source !== undefined && req.target !== undefined) return this.connectionBase(req, max);
    return { base: this.derived(req), sep: '_' };
  }

  /** The id of the join gateway of a split whose gateway is `gatewayId` (`<id>_join`, camel `<id>Join`, pascalSnake `<id>_Join`; a bare id `<id>Join`). */
  joinId(gatewayId: string): string {
    const base = cutAt(gatewayId, MAX_BASE - '_join'.length);
    if (!gatewayId.includes('_') && this.l.bareNodes) return `${base}Join`;
    switch (this.l.body) {
      case 'camel':
        return `${base}Join`;
      case 'pascalSnake':
        return `${base}_Join`;
      default:
        return `${base}_join`;
    }
  }

  /**
   * A free id for the request (not claimed) and the id it wanted (`base`;
   * different when that one was taken); at most MAX_ID characters. An
   * unnamed gateway or activity whose id is taken, or whose body another
   * element's id has (the unnamed gateway it follows: Gateway_AfterCheck),
   * first spells out its kind (spelledBase), then, after an unnamed anchor
   * whose context it repeats, names that anchor's kind (qualifiedBase:
   * Task_AfterCheckGateway): the first of them whose id and body are free,
   * else the first whose id is free, else a suffix (on the anchor-qualified
   * id when the base's own id is free but another id has its body).
   */
  next(req: IdRequest, ids: IdRegistry): { id: string; base: string } {
    const wanted = this.wanted(req);
    const { sep } = wanted;
    let { base } = wanted;
    const qualified = CONNECTIONS.has(req.key) ? undefined : this.qualifiedBase(req);
    const others = CONNECTIONS.has(req.key) ? [] : [this.spelledBase(req), qualified].filter((x): x is string => !!x && x !== base);
    const clash = (id: string): boolean => ids.has(id) || bodyTaken(id, ids);
    if (others.length && clash(base)) {
      const pick = others.find((x) => !clash(x)) ?? others.find((x) => !ids.has(x));
      if (pick) return { id: pick, base: pick };
      // every form is taken, and the base only by its body: the suffix goes on the form that names the anchor (its flows would name it like the anchor)
      if (qualified && !ids.has(base)) base = qualified;
    }
    let id = base;
    for (let n = 2; ids.has(id); n++) {
      const suffix = `${sep}${n}`;
      id = `${cutAt(base, MAX_ID - suffix.length)}${suffix}`;
    }
    return { id, base };
  }

  /** The ends of a `named` flow in the file's case and the word between them (`CheckInvoice`, `To`, `BookInvoice`). */
  private flowParts(source: string, target: string, glued: boolean): [string, string, string] {
    switch (this.l.body) {
      case 'camel': {
        const a = camelSlug(source);
        return [glued ? ucfirst(a) : a, 'To', slugify(target)];
      }
      case 'snake':
        return [snakeSlug(source), '_to_', snakeSlug(target)];
      case 'pascalSnake':
        return [pascalSnakeSlug(source), '_To_', pascalSnakeSlug(target)];
      default:
        return [slugify(source), 'To', slugify(target)];
    }
  }

  private connectionBase(req: IdRequest, max: number): { base: string; sep: string } {
    const { form, prefix, sep, scope } = this.flowOf(req.key);
    const s = req.source!;
    const t = req.target!;
    /** an end in a form built from id stems: its stem when that says something, else its label */
    const endStem = (id: string, label: string | undefined, slug: (text: string) => string): string => speakingStem(id) ?? (label && slug(label) ? slug(label) : stem(id));
    /** `<head><a><join><b>`, the two ends sharing the room up to `max` */
    const pair = (head: string, a: string, join: string, b: string): string => {
      const [x, y] = fitPair(a, b, max - head.length - join.length);
      return `${head}${x}${join}${y}`;
    };
    switch (form) {
      case 'scopedTo': {
        // the scope one of the ends names as a segment of its id (KotO in serviceTask_KotO_ValidatePayment), else the most used one
        const scopes = this.l.scopes.get(req.key) ?? this.l.scopes.get('bpmn:SequenceFlow') ?? [scope!];
        const own = scopes.find((x) => s.split('_').includes(x) || t.split('_').includes(x)) ?? scope!;
        return { base: cutAt(`${prefix}_${own}_${endWord(s, own, 'Start')}To${endWord(t, own, 'End')}`, max), sep: '' };
      }
      case 'stemTo':
        return { base: pair(`${prefix}_`, lcfirst(endStem(s, req.sourceLabel, camelSlug)), 'To', ucfirst(endStem(t, req.targetLabel, camelSlug))), sep: '' };
      case 'idPair':
        return { base: pair(`${prefix}_`, s, '_', t), sep: '_' };
      case 'stemSnake':
        return { base: pair(`${prefix}_`, endStem(s, req.sourceLabel, snakeSlug), '_to_', endStem(t, req.targetLabel, snakeSlug)), sep: '_' };
      case 'idSnake':
        return { base: pair(`${prefix}_`, s, '_to_', t), sep: '_' };
      default: {
        const label = (id: string, given: string | undefined): string => (given && nameWords(given).length ? given : (speakingStem(id) ?? id));
        // a number glued to a lower-case prefix (flow12) glues the words too (flowCheckToShip); an upper-case one reads apart (F12 -> F_CheckToShip)
        const glued = sep === '' && /[a-z]/.test(prefix);
        const [a, join, b] = this.flowParts(label(s, req.sourceLabel), label(t, req.targetLabel), glued);
        return { base: pair(`${prefix}${glued ? '' : '_'}`, a, join, b), sep: '_' };
      }
    }
  }
}

/** The kinds whose prefix says the kind, so that an unnamed one's id leaves it out (Gateway_AfterCheck, Activity_AfterCheck): spelledBase. */
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
  'eventBasedGateway',
]);

/** Whether another id has the body of `id` after its own prefix (`Gateway_AfterCheck` for `Activity_AfterCheck`): a flow between them would name both alike. */
function bodyTaken(id: string, ids: IdRegistry): boolean {
  const at = id.indexOf('_');
  if (at === -1) return false;
  const tail = id.slice(at);
  for (const other of ids.values()) if (other !== id && other.endsWith(tail) && PREFIXED.test(other) && other.indexOf('_') === other.length - tail.length) return true;
  return false;
}

/**
 * Two ends that share `room` characters, each cut at a word boundary
 * (cutAt): the first gets at least half, the second what is left, the
 * first what the second leaves over.
 */
function fitPair(a: string, b: string, room: number): [string, string] {
  if (a.length + b.length <= room) return [a, b];
  // ends that begin alike (the unnamed elements after one anchor: after_check_gateway, after_check_gateway_task) differ
  // at their ends: a cut there would make them read alike, so it cuts inside and keeps each end's last word
  const first = (x: string): string => (stemWords(x)[0] ?? '').toLowerCase();
  return sharePair(a, b, room, first(a) === first(b) ? cutKeepingLast : cutAt);
}

/** fitPair's share of the room: the first end at least half, the second what is left, the first what the second leaves over. */
function sharePair(a: string, b: string, room: number, cut: (slug: string, max: number) => string): [string, string] {
  const first = cut(a, Math.max(Math.floor(room / 2), room - b.length));
  const second = cut(b, room - first.length);
  return [cut(a, room - second.length), second];
}

/** cutAt that keeps the slug's last word (`after_check_order_gateway_task`, 25 -> `after_check_order_task`). */
function cutKeepingLast(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const m = /^(.*[a-z0-9])([_.-][A-Za-z0-9]+|[A-Z][a-z0-9]+)$/.exec(slug);
  if (!m || m[2]!.length + 8 > max) return cutAt(slug, max);
  return `${cutAt(m[1]!, max - m[2]!.length)}${m[2]}`;
}

/**
 * The word a scopedTo flow uses for one of its ends: Start / End for a start
 * / end event (`startEvent_KotOrder`, `EndEvent_Failed`), else the first word
 * of the id after its prefix and the scope (`serviceTask_KotO_ValidatePayment`
 * -> Validate).
 */
function endWord(id: string, scope: string, terminal: 'Start' | 'End'): string {
  const segments = id.split('_');
  if (segments.length > 1 && new RegExp(`^${terminal}(Event)?$`, 'i').test(segments[0]!)) return terminal;
  const rest = segments.length > 1 ? segments.slice(1).filter((x) => x !== scope) : segments;
  const word = nameWords(rest.join(' '))[0] ?? nameWords(id)[0] ?? terminal;
  return ucfirst(word);
}
