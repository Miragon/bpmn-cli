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
 *     share, then the first word with a letter of each end; a start / end
 *     event is Start / End), with the prefix those flows use; else `named`
 *     (Flow_CheckInvoiceToBookInvoice: the labels of the ends in the body
 *     case) with the prefix and separator of the file's flows (hashed
 *     Flow_0k3x9qa, numbered SF_12 or flow12: `flowCheckOrderToShip`). A form
 *     needs at least half of the flows of its type; a flow the length cap
 *     cut votes for its form too (cutOfForm: one of the cuts derivedBases
 *     lists, also 0.6's; legacyScopedCut: a scopedTo flow 0.6 cut to an
 *     empty target word), a glued flow named by its ends lends no prefix of
 *     its own and votes for the file's glued numbered flows (flow12) of the
 *     prefix it starts with (`flowCheckOrderToShip`; with a suffix,
 *     `flowCheckOrderToShip_2`, it counts only in such a file; in a
 *     snake_case / Pascal_Snake body `fweigh_parcel_to_label_parcel` where
 *     it is the id bpmn-cli gives its ends: gluedJoinedOf). Ties between
 *     forms and prefixes never go by document order (a move that declares a
 *     flow elsewhere changes nothing): between forms to the one that names
 *     the ends (FORM_ORDER), between a form's prefixes to the one more flows
 *     use (glued ones too), then to the alphabetically first; a tie between
 *     the scopes of one prefix and form keeps the first one counted;
 *   - the PREFIX of new processes (a new pool's): the one at least two of
 *     the file's process ids share (a tie: the alphabetically first), with
 *     the case their bodies show (a tie: the file's), else the file's
 *     (single lower-case words: camel, snake in a snake_case / Pascal_Snake
 *     file): process_customer and process_shop give process_bankAccount.
 *     Process ids vote on nothing else, and participant ids never on them;
 *     where they share no prefix a process follows the rules above
 *     (bpmn-cli's Process_<Name> ids vote for Process_).
 *  A document without ids to learn from gets the default style: pascal
 *  bodies, the bpmn-cli prefixes, `named` flows with the prefix Flow.
 *
 *  Every generated id is SPEAKING (never a hash, a random or a running
 *  number): a named element's body is its name (a name needs a word with a
 *  letter: `123` names nothing); an unnamed element's body is a word for its
 *  kind plus its context (IdRequest.context: Gateway_AfterCheckInvoice,
 *  Event_TimerOnReview, Event_StartInPayment, LaneSet_OrderHandling; built
 *  by ElementLabels.context: an unnamed anchor that is itself after / before something
 *  gives the nearest named anchor, once: the task after Gateway_AfterCheck
 *  is Activity_AfterCheck, never Activity_AfterAfterCheck); a flow's body
 *  names its ends (ElementLabels.label: the speaking part of an end's id, also an
 *  unnamed end's own context, AfterCheck, and CheckJoin for the join of the
 *  split after Check; else its name, else a word for its kind). Names and
 *  contexts are transliterated (ä -> ae, ø -> oe, å -> aa, src/ids/utils/slug.ts). A
 *  name or context gives at most MAX_SLUG (40) characters of words (a single
 *  longer word is cut at 40, src/ids/utils/slug.ts; a cut never ends on a filler word,
 *  cutName: und, an, the). A generated id has at most MAX_ID
 *  (64) characters, a collision suffix included; an id within that is not
 *  cut again. A longer one loses whole words: a long body its last words, a
 *  flow's two ends share the room, each giving up its last words, and of
 *  the cuts that fit the one with the most words, then the most characters
 *  (fitPair); a flow named by its ends' ids (idPair, idSnake) keeps each
 *  id's prefix where the prefixes leave 16 characters. A cut never leaves a
 *  number alone, nor at the end of the id where it reads like a collision
 *  suffix. A word is cut inside only where no whole word is left to give
 *  up: a flow's ends keep their first word, or their last where they begin
 *  alike. A cut keeps a letter: a room that ends inside a leading number
 *  starts at the first word with a letter (withLetter: rechnung for
 *  10202422024 Rechnung). A file prefix that leaves a body fewer than 8
 *  characters beside a suffix up to `_99` (more than 52) stays where the
 *  body's words up to its first one with a letter (and no filler word; an
 *  unnamed element's up to its anchor's first word) fit beside it whole,
 *  and gives way to the bpmn-cli prefix elsewhere (an element, per id:
 *  <prefix>_auftrag, activity_auftrag_2, activity_afterCheckOrder); a
 *  flow prefix (with a scopedTo flow's scope) that leaves the ends fewer
 *  than 16 stays where the ends fit beside it at whole words (wholePair:
 *  each keeps its first word) and gives way to a named flow with Flow
 *  elsewhere (a scoped one named by its end words), so one file can hold
 *  both forms (derivedBases lists both).
 *
 *  style.next(req, registry) returns a free id for a request (kindRequest /
 *  typeRequest / connectionRequest / ElementLabels.flowRequest) and the id it wanted
 *  (`base`); an unnamed gateway or activity whose base is taken, or whose
 *  body another id has, first spells out its kind (spelledBase:
 *  Gateway_ParallelAfterCheck), then, after an unnamed anchor whose context
 *  it repeats (IdRequest.anchorKind, ElementLabels.anchorContext), names the anchor's
 *  kind (qualifiedBase: Task_AfterCheckGateway after
 *  ExclusiveGateway_AfterCheck where the task prefix says the kind); a
 *  taken base gets `_2`, `_3` (the file-learned flow forms stemTo and
 *  scopedTo: `2`, `3`; after a base that ends in a digit `No2`, `No3`,
 *  withSuffix: flow_checkOrderToSendPdf10No2, never ...Pdf102, the flow to
 *  Send PDF 102), so the same request on the same document always
 *  gives the same id; `id !== base` is W_ID_SUFFIXED (Doc.allocateId
 *  records it); a base that leaves no room for the suffix is cut again so
 *  that the id stays within MAX_ID. A flow whose two ends begin with the
 *  same word (the unnamed elements after one anchor) keeps each end's last
 *  word when the length cap cuts it (fitPair), so the ends keep what tells
 *  them apart. style.derivedBase(req) is that base without allocating
 *  (derivedBases: also the uncut one, the ones a suffix leaves room for,
 *  the one 0.6 wanted and the ones it cut, also for a suffix from `_100`,
 *  and the same under every other flow prefix and form the file's flows
 *  use, the `named` ones bpmn-cli gave before another form or prefix won
 *  among them, for ids written before);
 *  style.joinId(gatewayId) the id of a split's join gateway.
 *
 * DECLARED CONVENTIONS
 *  IdStyle.infer(defs, conventions) with IdConventions (src/ids/conventions.ts:
 *  the prefixes, case and qualifier @miragon/rules/element-id-naming
 *  declares in the project's .bpmnlintrc, or a host's table) fills the gaps
 *  the file leaves: a request whose BPMN type has a declared prefix (the
 *  table's entry for it; under the qualifier `required` an event with a
 *  trigger takes the qualified one, timerStartEvent_, else the plain one)
 *  gets that prefix and a body in the declared case (none declared, `any`:
 *  the file's case over every id); its kind word drops what the prefix
 *  already says (startEvent_timer1stOfMonth, not ...timerStart...), and
 *  under camelCase / PascalCase a body that would begin with a number
 *  begins with the kind word, the collision suffix is glued
 *  (serviceTask_checkInvoice2; serviceTask_step1No2 after a digit, never
 *  serviceTask_step12, Step 12's id) and a join is `<id>Join` (snake_case:
 *  `<id>_join`; after a split id the declared prefix does not start, that
 *  prefix and the gateway's label: gateway_checkJoin for Gateway_Check;
 *  after one whose body is not in the declared case, that prefix and the
 *  body's words: gateway_approvedJoin for gateway_Approved).
 *  Sequence flows with a declared prefix take the `named` form under a
 *  declared case (flow_checkInvoiceToBookInvoice; the file's scope segment
 *  left out of the ends, an end that begins with a number written
 *  `From...`), else the file's form after that prefix; message flows take
 *  an exact entry of their own, else the style of the file's message flows
 *  where two show one (the ones under the borrowed prefix do not vote, so
 *  the second message flow looks like the first), else the sequence flows'
 *  prefix and style. Every other request follows the file, learned
 *  without the ids that already start with a prefix the conventions accept
 *  for their element (so the ids bpmn-cli writes from the table never vote
 *  on the style of the rest; Activity_CheckOrder still does). Where those show no
 *  case, the declared case is theirs (single lower-case words show none:
 *  lane_sales is the declared camelCase's too; under a declared PascalCase,
 *  which they cannot be, they read as camelCase), unless their prefixes
 *  show the other first letter than the declared ones (Lane_, Participant_
 *  next to serviceTask_: bpmn-cli's PascalCase); where they show no prefix
 *  shape, the declared prefixes' shape (type-named, first letter; a prefix
 *  several kinds share, gateway_, counts once) is. The
 *  process and the definitions take bpmn-cli's style (Process_<Name>, also
 *  a new pool's process) unless the table names their type exactly; a new
 *  process takes the prefix the file's process ids share (two at least,
 *  in their case, else the case of a kind the table does not name, so it
 *  matches its pool: Process_BankAccount next to Camunda Modeler's
 *  Process_1 and hashed participants; never the declared prefixes'
 *  shape). Under the qualifier `required` an event whose qualified prefix
 *  is too long for new ids (IdConventions.ignored) follows the file like
 *  an ignored type. learnedOnly() is the file's own style over every id: a
 *  flow it named still names its ends (derivedBases), and Doc.allocateId
 *  compares a new id under a declared prefix with it (the result's
 *  `conventions:` line) where the file has ids the conventions check that
 *  do not follow them (ownStyleDiffers; any id of an ignored type or event
 *  counts: no id passes a prefix new ids cannot have; a new file, and one
 *  whose checked ids all follow them, have no style of their own to differ
 *  from). Existing ids are never renamed for the conventions:
 *  stalePrefix() names the one a retype or a trigger change leaves
 *  (W_ID_PREFIX_STALE; also one the rule did not check before, a type
 *  switched off; the suggested id keeps the rest of an id that passed the
 *  rule, else it is the id of what the element is now, an unnamed one with
 *  the words after the old prefix: scriptTask_ShipGoods for
 *  serviceTask_shipGoods under PascalCase, userTask_userTask1 for
 *  serviceTask_1), and gives an element the batch created (a split's join
 *  too) its new id, which the flows the batch named after it follow
 *  (ops/set.ts recordIdState). Without declared conventions nothing of
 *  this runs.
 */
import { camelSlug, cutAt, cutName, hasIdWords, idWords, isFiller, isSuffix, isValidId, MAX_ID, MAX_SLUG, nameWords, pascalSnakeSlug, slugify, snakeSlug, SUFFIX_WORD, withSuffix } from './utils/slug.js';
import type { IdRegistry } from './IdRegistry.js';
import { FORM_JOIN, ID_FORMS, IdFitter, LEGACY_BASE, type IdForm } from './IdFitter.js';
import { beginAlike, CONTEXT_WORDS, GENERIC, GLUED, HASH, kindWord, lcfirst, localName, PREFIXED, prefixClass, speakingStem, stem, stemWords, TOOL_DEFAULTS, ucfirst, type PrefixClass } from './utils/id-words.js';
import { CONNECTIONS, connectionRequest, kindRequest, kindTypeNames, typeRequest, type IdRequest } from './utils/requests.js';
import { ElementLabels } from './ElementLabels.js';
import type { IdConventions } from './conventions.js';
import { DeclaredConventions, type Votes } from './DeclaredConventions.js';
import { kindByName, kindOf, triggerOf } from '../model/kinds.js';
import { is, isBpmnElement, walk, type El } from '../model/utils/moddle.js';

/** The case of the bodies of new ids. */
export type Body = 'pascal' | 'camel' | 'snake' | 'pascalSnake';
/** How new flows are named (see the module contract). */
export type FlowForm = 'named' | 'stemTo' | 'idPair' | 'stemSnake' | 'idSnake' | 'scopedTo';

/** How a type's flows are named: the form, its prefix, the separator after the prefix ('' in `flow12` files), the scope of `scopedTo`. */
export interface FlowStyle {
  form: FlowForm;
  prefix: string;
  sep?: string;
  scope?: string;
  /** a declared prefix with its separator (element-id-naming: `flow_`), which replaces `<prefix>_` */
  head?: string;
}

export interface IdStyleInfo {
  body: Body;
  sequenceFlow: FlowStyle;
  messageFlow: FlowStyle;
}

/** A request for a connection between two ends (its id names them: connectionBase). */
const isConnection = (req: IdRequest): boolean => CONNECTIONS.has(req.key) && req.source !== undefined && req.target !== undefined;

/** `<scope>_<A>To<B>` after a flow prefix: Flow_KotO_ValidateToReserve. */
const SCOPED_TO = /^([A-Za-z][A-Za-z0-9]*)_([A-Z][A-Za-z0-9]*?)To([A-Z][A-Za-z0-9]*)$/;
/** A glued flow named by its ends with a collision suffix (`flowCheckOrderToShip_2`, a flow bpmn-cli named in a file of flow12 ids): not a prefix and a number. */
const GLUED_SUFFIXED = /^[A-Za-z][A-Za-z0-9]*To[A-Z0-9][A-Za-z0-9]*_\d+$/;
/** The same without a suffix (`flowCheckOrderToShip`, `fPackToWeigh`; a cut one may end on `To`): no `_`, a `To` before an upper-case letter, a digit or the end. */
const GLUED_NAMED = /^[A-Za-z][A-Za-z0-9]*To(?![a-z])[A-Za-z0-9]*$/;
/** A flow id that may be a glued flow named by its ends in a snake_case / Pascal_Snake body (`fweigh_parcel_to_label_parcel`, `fWeigh_Parcel_To_Label_Parcel`, also with `_2`): a lower-case start and `_to_` / `_To_` (gluedJoinedOf decides). */
const GLUED_JOINED = /^[a-z]\w*_[tT]o_\w*$/;
/** `<scope>_<A>To` after a flow prefix, with a glued suffix or none: a scopedTo flow 0.6 cut to an empty target word (Flow_KotO_WarenwirtschaftssystemabgleichTo; legacyScopedCut). */
const SCOPED_CUT = /^([A-Za-z][A-Za-z0-9]*)_([A-Z][A-Za-z0-9]*?)To\d*$/;

/**
 * One element is not a convention: a learned rule needs two ids that follow
 * it. In a file whose ids are mostly prefixed (at least three, at least half
 * of them), one id is enough for the prefix of its own kind (`End_1` for the
 * next end event) and of its family.
 */
const MIN_EVIDENCE = 2;

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

/** A literal prefix that abbreviates its own kind (End, Start, Call, Sub, Boundary, Timer) says nothing about other kinds. */
function isSpecific(prefix: string, typeNames: string[], trigger: string | undefined, family: string): boolean {
  const p = prefix.toLowerCase();
  if (p === family.toLowerCase() || GENERIC.has(p)) return false;
  return typeNames.some((n) => n.toLowerCase().startsWith(p)) || (!!trigger && trigger.toLowerCase().startsWith(p));
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
  // the form itself, or the form with a collision suffix (`2`, `No2` after a digit / `_2`)
  const fits = (candidate: string, sep: string): boolean => rest === candidate || (rest.startsWith(candidate) && isSuffix(candidate, rest.slice(candidate.length), sep));
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
  /**
   * The most frequent key with at least `min` occurrences. A tie goes to the
   * key `prefers` puts before the other (the flow votes: never document
   * order, so a flow a move declares elsewhere tips nothing), else to the
   * first one counted.
   */
  top(min = MIN_EVIDENCE, prefers?: (a: K, b: K) => boolean): K | undefined {
    let best: K | undefined;
    let n = 0;
    for (const [k, v] of this.counts) {
      if (v > n || (v === n && best !== undefined && prefers?.(k, best))) {
        best = k;
        n = v;
      }
    }
    return n >= min ? best : undefined;
  }
}

/** Alphabetical order (code units, the same everywhere): the last tie-break of the flow votes. */
const alphabetical = (a: string, b: string): boolean => a < b;

/**
 * The flow forms in the order a tie between them goes (learn): a form that
 * names the ends before numbers and hashes, so a file of half speaking
 * flows gets speaking ones.
 */
const FORM_ORDER: SeenForm[] = ['scopedTo', 'stemTo', 'idPair', 'stemSnake', 'idSnake', 'named', 'numbered', 'hash'];

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
  /** the file's ids showed a case (else `body` is the default) */
  bodyVoted: boolean;
  flows: Map<string, FlowStyle>;
  /** the types whose flows show a style (a form or a prefix of at least two of them); a type in `flows` without it has bpmn-cli's prefix Flow */
  flowVoted: Set<string>;
  /** the file's ids are mostly prefixed (see MIN_EVIDENCE): one id is evidence for its kind and family */
  strong: boolean;
  /** scopedTo flows: the scopes of a type's flows, most used first */
  scopes: Map<string, string[]>;
  /**
   * every style a type's flows show besides the one new flows take (`flows`):
   * `named` under each flow prefix with its separator (the flows bpmn-cli
   * named before another form or prefix had the majority, and those of a
   * prefix a tie or a few more flows outvoted), each form built from the
   * ends with the prefixes that voted for it (scopedTo: with each scope).
   * derivedBases lists their ids too, so a flow named in one of them still
   * names its ends
   */
  flowStyles: Map<string, FlowStyle[]>;
  /** flow node ids without / with a prefix: a file whose flow nodes mostly have none gives a kind without own evidence none either */
  bareNodes: number;
  prefixedNodes: number;
  /** the case of bare ids (voted by the bare ids that spell their names; prefixed ids vote `body`) */
  bareBody: 'pascal' | 'camel';
  /** the prefixes of the process ids (no vote on anything else: processStyle), and the classes of their bodies per prefix */
  processes: Tally<string>;
  processBodies: Map<string, Tally<BodyClass>>;
  /** with declared conventions: the file has an id they check that does not follow them (a prefix they do not accept, a body not in their case, an ignored type's: rejects; ownStyleDiffers) */
  unconforming: boolean;
}

/** The votes of one type's flows (learn). */
interface FlowVotes {
  /** flows that count (all but the glued ones with a suffix, which count only for glued numbered flows) */
  n: number;
  /** glued flows named by their ends with a suffix (GLUED_SUFFIXED) and without (GLUED_NAMED) */
  glued: string[];
  gluedNamed: string[];
  /** flows with `_to_` / `_To_` that may be glued flows in a snake_case / Pascal_Snake body (fweigh_parcel_to_label_parcel): decided once the glued prefixes are known */
  joined: Array<{ el: El; id: string; source: string; target: string }>;
  forms: Tally<SeenForm>;
  prefixes: Map<SeenForm, Tally<string>>;
  /** the prefix before `_` of every flow that has one */
  any: Tally<string>;
  /** every flow of a prefix: `any`, the glued numbered flows and the glued flows that voted for one (a tie between a form's prefixes) */
  uses: Tally<string>;
  /** the separator of a numbered prefix ('' of flow12) */
  seps: Map<string, string>;
  scopes: Tally<string>;
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

/**
 * Learns the conventions of `defs`. With declared conventions (`d`) the ids
 * that already follow them do not vote (conforms; flows aside), and single
 * lower-case words alone show no case (lane_sales: the declared camelCase's
 * as much as snake_case's).
 */
function learn(defs: El | undefined, d?: DeclaredConventions): Learned {
  const l: Learned = {
    byKey: new Map(),
    byKeyTrigger: new Map(),
    classByKey: new Map(),
    family: new Map(),
    classes: new Tally(),
    lowerFirst: 0,
    upperFirst: 0,
    body: 'pascal',
    bodyVoted: false,
    flows: new Map(),
    flowVoted: new Set(),
    scopes: new Map(),
    flowStyles: new Map(),
    bareNodes: 0,
    bareBody: 'camel',
    prefixedNodes: 0,
    strong: false,
    processes: new Tally(),
    processBodies: new Map(),
    unconforming: false,
  };
  let samples = 0;
  let prefixed = 0;
  const nodeBodies = new Tally<BodyClass>();
  const bareBodies = new Tally<BodyClass>();
  const otherBodies = new Tally<BodyClass>();
  const flowVotes = new Map<string, FlowVotes>();
  /** The votes of a flow that is none of bpmn-cli's glued flows: its prefix, and the forms it matches given its ends. */
  const countFlow = (v: FlowVotes, el: El, id: string, source: string | undefined, target: string | undefined): void => {
    const p = PREFIXED.exec(id)?.[1];
    if (p) v.any.add(p);
    const own = p ?? GLUED.exec(id)?.[1];
    if (own) v.uses.add(own);
    if (!source || !target) return;
    const seen = flowForms(id, source, target);
    // a flow the length cap cut votes for its form too (else enough of them would flip the file's form), also a
    // scopedTo flow 0.6 cut to an empty target word (Flow_KotO_WarenwirtschaftssystemabgleichTo)
    if (p) {
      let req: IdRequest | undefined;
      const request = (): IdRequest => (req ??= connectionRequest(el.$type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source, target, { sourceLabel: new ElementLabels(el.get<El>('sourceRef')).label(), targetLabel: new ElementLabels(el.get<El>('targetRef')).label() }));
      for (const form of ID_FORMS) if (!seen.some((f) => f.form === form) && cutOfForm(id, form, p, request)) seen.push({ form, prefix: p });
      const scope = seen.some((f) => f.form === 'scopedTo') ? undefined : legacyScopedCut(id, p, source, target);
      if (scope) seen.push({ form: 'scopedTo', prefix: p, scope });
    }
    for (const f of seen) {
      v.forms.add(f.form);
      let t = v.prefixes.get(f.form);
      if (!t) v.prefixes.set(f.form, (t = new Tally()));
      t.add(f.prefix);
      if (f.sep !== undefined && !v.seps.has(f.prefix)) v.seps.set(f.prefix, f.sep);
      if (f.scope) v.scopes.add(f.scope);
    }
  };

  for (const el of defs ? walk(defs, { bpmnOnly: true }) : []) {
    if (!isBpmnElement(el) || /^(bpmndi|dc|di):/.test(el.$type)) continue;
    const id = el.get<string | undefined>('id');
    if (!id) continue;
    if (CONNECTIONS.has(el.$type)) {
      // a flow of a type the conventions check that does not follow them: the file has a style of its own there
      if (d && !l.unconforming && d.rejects({ type: el.$type }, id)) l.unconforming = true;
      const source = el.get<El | undefined>('sourceRef')?.get<string | undefined>('id');
      const target = el.get<El | undefined>('targetRef')?.get<string | undefined>('id');
      // a message flow under the prefix it borrows from the sequence flows (flowOf) does not vote: bpmn-cli wrote it
      // from the declared conventions, so it never ends the borrowing
      const borrowed = d && el.$type === 'bpmn:MessageFlow' ? d.borrowedHead(el.$type) : undefined;
      if (borrowed !== undefined && id.startsWith(borrowed)) continue;
      let v = flowVotes.get(el.$type);
      if (!v) flowVotes.set(el.$type, (v = { n: 0, glued: [], gluedNamed: [], joined: [], forms: new Tally(), prefixes: new Map(), any: new Tally(), uses: new Tally(), seps: new Map(), scopes: new Tally() }));
      // a glued flow named by its ends with a suffix (flowCheckToShip_2) is not the prefix flowCheckToShip and a number: it
      // lends no prefix, and counts only for a file's glued numbered flows (flow12, below)
      if (GLUED_SUFFIXED.test(id)) {
        v.glued.push(id);
        continue;
      }
      v.n++;
      // one without a suffix (flowCheckToShip, fPackToWeigh) votes for the glued numbered flows of its prefix (below)
      if (!id.includes('_') && GLUED_NAMED.test(id) && !GLUED.test(id)) {
        v.gluedNamed.push(id);
        continue;
      }
      // one in a snake_case / Pascal_Snake body (fweigh_parcel_to_label_parcel, also with `_2`) has a `_` and reads like
      // the prefix fweigh: it waits until the glued numbered prefixes are known (below), then votes for one or counts
      // like any other flow
      if (source && target && GLUED_JOINED.test(id)) {
        v.joined.push({ el, id, source, target });
        continue;
      }
      countFlow(v, el, id, source, target);
      continue;
    }
    if (TOOL_DEFAULTS.has(id)) continue;
    // a process id votes only on the ids of new processes (processStyle), never on anything else
    if (el.$type === 'bpmn:Process') {
      const m = PREFIXED.exec(id);
      if (m) {
        l.processes.add(m[1]!);
        tallyOf(l.processBodies, m[1]!).add(bodyClass(m[2]!));
      }
      continue;
    }
    if (d) {
      const trigger = triggerOf(el);
      const state = { type: el.$type, ...(trigger ? { trigger } : {}) };
      const heads = d.headsOf(state);
      if (!l.unconforming && !IGNORED.some((t) => is(el, t)) && d.rejects(state, id, heads)) l.unconforming = true;
      // an id that already starts with a prefix the conventions accept for its element does not vote
      if (heads.some((h) => id.startsWith(h))) continue;
    }
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
  // a single lower-case word fits camel and snake alike (with declared conventions alone: neither, but never a declared
  // PascalCase: then they read as camel, like bare ids); hashes and numbers show none (pascal)
  // bare ids: PascalCase when the file writes them so, else camelCase (single lower-case words read as camel)
  l.bareBody = bareBodies.get('pascal') > bareBodies.get('camel') + bareBodies.get('lower') ? 'pascal' : 'camel';
  const bodies = nodeBodies.total >= MIN_EVIDENCE ? nodeBodies : otherBodies;
  if (bodies === otherBodies) for (const [k, v] of nodeBodies.counts) bodies.add(k, v);
  const camel = bodies.get('camel');
  const snake = bodies.get('snake');
  const lowerOnly = camel + snake === 0;
  const lower = d && lowerOnly && d.case !== 'pascal' ? 0 : bodies.get('lower');
  const lowerCamel = (camel > 0 && camel >= snake) || (lowerOnly && d?.case === 'pascal');
  const votes: Array<[Body, number]> = [
    ['pascal', bodies.get('pascal')],
    ['camel', camel + (lowerCamel ? lower : 0)],
    ['snake', snake + (lowerCamel ? 0 : lower)],
    ['pascalSnake', bodies.get('pascalSnake')],
  ];
  let best: [Body, number] = ['pascal', MIN_EVIDENCE - 1];
  for (const v of votes) if (v[1] > best[1]) best = v;
  l.body = best[0];
  l.bodyVoted = best[1] >= MIN_EVIDENCE;

  for (const [type, v] of flowVotes) {
    // the glued flows bpmn-cli named by their ends in a file of flow12 ids vote for that form and for the glued prefix
    // they start with (flowCheckToShip: flow; the longest that is followed by an upper-case letter or a digit); with a
    // suffix they count only there, as 0.6 counted them; without one they count anyway and vote where a prefix matches
    const glued = [...v.seps].filter(([p, sep]) => sep === '' && /[a-z]/.test(p)).map(([p]) => p).sort((a, b) => b.length - a.length);
    const gluedTo = (id: string): string | undefined => glued.find((p) => id.startsWith(p) && /^[A-Z0-9]/.test(id.charAt(p.length)));
    const voteNumbered = (p: string | undefined): void => {
      v.forms.add('numbered');
      if (p) {
        tallyOf(v.prefixes, 'numbered').add(p);
        v.uses.add(p);
      }
    };
    if (v.glued.length && [...v.seps.values()].includes('')) {
      v.n += v.glued.length;
      for (const id of v.glued) voteNumbered(gluedTo(id));
    }
    for (const id of v.gluedNamed) {
      const p = gluedTo(id);
      if (p) voteNumbered(p);
    }
    // in a snake_case / Pascal_Snake body the glued prefix is followed by the source's words (fweigh_parcel_to_...,
    // fWeigh_Parcel_To_...): such a flow votes where it is the id bpmn-cli gives its ends after the prefix
    for (const { el, id, source, target } of v.joined) {
      let a: string | undefined;
      let b: string | undefined;
      const ends = { source: (): string => (a ??= new ElementLabels(el.get<El>('sourceRef')).label()), target: (): string => (b ??= new ElementLabels(el.get<El>('targetRef')).label()) };
      const p = glued.find((p) => id.startsWith(p) && gluedJoinedOf(id, p, ends));
      if (p) voteNumbered(p);
      else countFlow(v, el, id, source, target);
    }
    // a type whose flows are all such glued flows has no style of its own (the sequence flows', else the default)
    if (!v.n) continue;
    // ties between forms and prefixes never go by document order: forms by FORM_ORDER, a form's prefixes by how many
    // flows use them (`uses`), then alphabetically, as does `any`; a tie between scopes (one prefix and one form) keeps
    // the first one counted, as before
    const form = v.forms.top(MIN_EVIDENCE, (a, b) => FORM_ORDER.indexOf(a) < FORM_ORDER.indexOf(b));
    const prefix = form ? v.prefixes.get(form)!.top(MIN_EVIDENCE, (a, b) => v.uses.get(a) > v.uses.get(b) || (v.uses.get(a) === v.uses.get(b) && a < b)) : undefined;
    const scope = form === 'scopedTo' ? v.scopes.top() : undefined;
    const any = v.any.top(MIN_EVIDENCE, alphabetical);
    let style: FlowStyle;
    if (form && prefix && v.forms.get(form) * 2 >= v.n && (form !== 'scopedTo' || scope)) {
      const sep = v.seps.get(prefix);
      // hashed and numbered flows lend new flows their prefix (and a numbered prefix's separator: flow12 -> flowAToB)
      const named = form === 'hash' || form === 'numbered';
      style = { form: named ? 'named' : form, prefix, ...(form === 'numbered' && sep !== undefined ? { sep } : {}), ...(scope ? { scope } : {}) };
      if (form === 'scopedTo') l.scopes.set(type, [...v.scopes.counts.keys()].sort((a, b) => v.scopes.get(b) - v.scopes.get(a)));
      l.flowVoted.add(type);
    } else {
      style = { form: 'named', prefix: any ?? 'Flow' };
      if (any !== undefined) l.flowVoted.add(type);
    }
    l.flows.set(type, style);
    l.flowStyles.set(type, otherStyles(v, style));
  }
  return l;
}

/**
 * Whether `id` can be one of the ids a flow style gives (derivedBases): they
 * start with its head (the prefix, a scopedTo flow's with its scope; the
 * first 32 characters: a cut never reaches past them), or with Flow_ where
 * the head is long enough to give way to it (namedHead, connectionBase: from
 * 44 characters; 40 here). A scopedTo flow whose end names another learned
 * scope takes that one (scopeOf), as does that scope's own style, which
 * passes.
 */
function mayBeOf(id: string, style: FlowStyle): boolean {
  const head = style.form === 'scopedTo' && style.scope !== undefined ? `${style.prefix}_${style.scope}_` : style.prefix;
  return id.startsWith(head.slice(0, 32)) || (style.prefix.length + (style.scope?.length ?? 0) >= 40 && id.startsWith(`${DEFAULT_FLOW.prefix}_`));
}

/**
 * Whether `id` is a flow bpmn-cli named by its ends (their labels, ElementLabels.label,
 * read when needed) after the glued prefix `prefix` in a snake_case or
 * Pascal_Snake body (namedBase with a glued head:
 * `fweigh_parcel_to_label_parcel`, `fWeigh_Parcel_To_Label_Parcel`): before
 * the length cap, cut for a suffix of up to 4 characters or as 0.6 cut it,
 * with a collision suffix `_2` or none, or one that names its source whole
 * (its target changed since, the id kept: `fweigh_parcel_to_event` on Weigh
 * parcel -> Label parcel), as a glued flow in a camelCase body votes
 * whatever its ends (GLUED_NAMED). Learn: such a flow votes for the prefix.
 */
function gluedJoinedOf(id: string, prefix: string, ends: { source: () => string; target: () => string }): boolean {
  const fits = (base: string): boolean => id === base || (id.startsWith(base) && isSuffix(base, id.slice(base.length), '_'));
  for (const [join, slug] of [['_to_', snakeSlug], ['_To_', pascalSnakeSlug]] as const) {
    // cheap test first: every cut keeps the source's first letter after the prefix (a short glued prefix leaves the
    // source half of the room at least)
    if (!id.includes(join) || id.charAt(prefix.length) !== slug(ends.source()).charAt(0)) continue;
    // its source whole and the join: also one whose target a splice changed while its id was kept (W_FLOW_ID_STALE)
    if (id.startsWith(`${prefix}${slug(ends.source())}${join}`)) return true;
    const at = (max: number, legacy = false): string => new IdFitter({ legacy }).pair(prefix, slug(ends.source(), legacy), join, slug(ends.target(), legacy), max);
    const uncut = at(Infinity);
    if (fits(uncut) || (uncut.length > MAX_ID - 4 && [0, 1, 2, 3, 4].some((k) => fits(at(MAX_ID - k))))) return true;
    const legacy = at(LEGACY_BASE, true);
    if (fits(legacy) || fits(cutAt(legacy, MAX_ID - 4, true))) return true;
  }
  return false;
}

/**
 * The styles a type's flows show besides `style` (Learned.flowStyles):
 * `named` under every prefix (with `_`, and glued after a numbered prefix
 * without separator), each form built from the ends under the prefixes that
 * voted for it, scopedTo with each scope. One per head.
 */
function otherStyles(v: FlowVotes, style: FlowStyle): FlowStyle[] {
  const out = new Map<string, FlowStyle>();
  const key = (s: FlowStyle): string => (s.form === 'named' ? `named|${new IdFitter({ legacy: true }).namedHead(s.prefix, s.sep).head}` : `${s.form}|${s.prefix}|${s.scope ?? ''}`);
  const add = (s: FlowStyle): void => {
    if (!out.has(key(s))) out.set(key(s), s);
  };
  add(style);
  for (const prefix of v.any.counts.keys()) add({ form: 'named', prefix });
  for (const [prefix, sep] of v.seps) add({ form: 'named', prefix, sep });
  for (const [form, t] of v.prefixes) {
    if (form === 'hash' || form === 'numbered' || form === 'named') continue;
    for (const prefix of t.counts.keys()) {
      if (form === 'scopedTo') for (const scope of v.scopes.counts.keys()) add({ form, prefix, scope });
      else add({ form, prefix });
    }
  }
  out.delete(key(style));
  return [...out.values()];
}

/* ------------------------------------------------------------------ */
/* the style                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_FLOW: FlowStyle = { form: 'named', prefix: 'Flow' };

/** Where the prefix of a new id comes from (the conventions view): a declared prefix, the file's ids, the declared prefixes' shape where the file shows none, bpmn-cli's. */
export type PrefixSource = 'lint' | 'file' | 'lint shape' | 'default';

/** The type and trigger of an element: what decides which declared prefixes its id may have (stalePrefix). */
export interface IdState {
  type: string;
  trigger?: string;
}

/**
 * The process and the definitions under declared conventions: their ids are
 * bpmn-cli's own (Process_<Name>, Definitions_<Name>) unless the declared
 * prefixes name their type exactly, or (a process) the file's own process
 * ids share a prefix (processStyle); never learned from the rest of a file
 * whose ids bpmn-cli shapes after the declared prefixes (participant_customer
 * would make the next pool's process process_supplier, then
 * process_back_office).
 */
const FILE_LEVEL = new Set(['bpmn:Process', 'bpmn:Definitions']);

/** The BPMN type of a request's key (a kind of `bpmn kinds`: its type, eventSubProcess bpmn:SubProcess). */
function typeOf(key: string): string {
  return kindByName(key)?.type ?? key;
}

/** A word without the words a declared prefix already says (`TimerStart` after `startEvent_`: Timer); '' when nothing is left. */
function unsaid(word: string, head: string): string {
  const said = new Set(stemWords(head).map((w) => w.toLowerCase()));
  return stemWords(word)
    .filter((w) => !said.has(w.toLowerCase()))
    .join('');
}

export class IdStyle {
  private constructor(
    private readonly l: Learned,
    /** the declared conventions (undefined: the file's own style) */
    private readonly d?: DeclaredConventions,
    /** the file's own style over every id (learnedOnly); with declared conventions `l` leaves out the ids a declared prefix covers */
    private readonly all: Learned = l,
  ) {}

  /** The bpmn-cli default: pascal bodies, bpmn-cli prefixes, `named` flows (Flow_CheckInvoiceToBookInvoice). */
  static readonly DEFAULT = new IdStyle(learn(undefined));

  /** Learns the conventions of a document (see the module contract); declared conventions fill the gaps they cover (DECLARED CONVENTIONS). */
  static infer(defs: El, conventions?: IdConventions): IdStyle {
    const d = DeclaredConventions.of(conventions);
    if (!d) return new IdStyle(learn(defs));
    return new IdStyle(learn(defs, d), d, learn(defs));
  }

  /** The style of a document without ids yet (`new`): the declared conventions over the default. */
  static of(conventions?: IdConventions): IdStyle {
    const d = DeclaredConventions.of(conventions);
    return d ? new IdStyle(learn(undefined), d) : IdStyle.DEFAULT;
  }

  /** A request by key alone (a kind of `bpmn kinds`, or a BPMN type): the case and collision suffix of a split's join gateway. */
  static keyRequest(key: string): IdRequest {
    const def = kindByName(key);
    return def ? kindRequest(def) : typeRequest(key);
  }

  /** Whether declared conventions apply (IdStyle.infer with conventions that declare a usable prefix). */
  get declared(): boolean {
    return this.d !== undefined;
  }

  /**
   * Whether the file has ids of its own the declared conventions check that
   * do not follow them (a prefix they do not accept, a body not in their
   * case, any id of a type or event whose prefix they ignore: rejects; not
   * the tool default StartEvent_1, the process, the definitions):
   * only then is a new id under a declared prefix one the file's own style
   * would give otherwise (Doc.allocateId, the result's `conventions:` line).
   * A new file, and one whose checked ids all follow them, have none, even
   * where learnedOnly() shows no style of their own yet (its first ids, a
   * kind it has no id of). False without declared conventions.
   */
  get ownStyleDiffers(): boolean {
    return this.l.unconforming;
  }

  private processMemo: { prefix: string; body: Body } | null | undefined;

  /**
   * The style of new process ids where the file's own process ids show one
   * (Learned.processes; participant ids never vote): the prefix at least two
   * of them share (bpmn-cli's own Process_<Name> ids vote for Process_), and
   * the case their bodies show (a tie: the file's case where it is one of
   * them, else the first of pascal, camel, snake, pascalSnake), else the
   * file's case: the one a kind the declared conventions do not name gets
   * (caseFor(), so the process matches the pool made with it; without them
   * the file's), also for bodies that show none (hashes, numbers:
   * Process_1, Process_0k3x9qa); single lower-case words (process_customer)
   * are no PascalCase: camel, snake where the file's case is snake_case /
   * Pascal_Snake. Undefined where they share none.
   */
  private processStyle(): { prefix: string; body: Body } | undefined {
    if (this.processMemo === undefined) {
      const prefix = this.l.processes.top(MIN_EVIDENCE, alphabetical);
      if (prefix === undefined) this.processMemo = null;
      else {
        const t = this.l.processBodies.get(prefix)!;
        const file = this.caseFor();
        let best: [Body, number] = [file, 0];
        for (const c of ['pascal', 'camel', 'snake', 'pascalSnake'] as const) if (t.get(c) > best[1] || (t.get(c) === best[1] && best[1] > 0 && c === file)) best = [c, t.get(c)];
        const body = best[1] || !t.get('lower') ? best[0] : file === 'snake' || file === 'pascalSnake' ? 'snake' : 'camel';
        this.processMemo = { prefix, body };
      }
    }
    return this.processMemo ?? undefined;
  }

  /** Whether a request takes bpmn-cli's own style under declared conventions (FILE_LEVEL: no declared prefix names its type, no process style of the file's). */
  private fileLevel(req: IdRequest): boolean {
    return !!this.d && FILE_LEVEL.has(req.key) && this.declaredHead(req) === undefined && !(req.key === 'bpmn:Process' && this.processStyle());
  }

  private own: IdStyle | undefined;

  /** This style without the declared conventions: the file's own over every id (itself without declared conventions). */
  learnedOnly(): IdStyle {
    return this.d ? (this.own ??= new IdStyle(this.all)) : this;
  }

  info(): IdStyleInfo {
    const sequenceFlow = this.flowOf('bpmn:SequenceFlow');
    return { body: this.caseFor(), sequenceFlow, messageFlow: this.flowOf('bpmn:MessageFlow') };
  }

  private learnedFlow(type: string): FlowStyle {
    return this.l.flows.get(type) ?? this.l.flows.get('bpmn:SequenceFlow') ?? DEFAULT_FLOW;
  }

  /**
   * How a type's new flows are named: the file's form and prefix; a
   * declared prefix (`head`: the type's entry; message flows without one,
   * as long as the file's own message flows show no style (flowVoted; the
   * ones under the borrowed prefix do not vote): the sequence flows', with
   * their style) takes the place of the file's, with the `named` form under
   * a declared case (the one form whose body passes it).
   */
  private flowOf(type: string): FlowStyle {
    const d = this.d;
    if (!d) return this.learnedFlow(type);
    const borrowed = this.l.flowVoted.has(type) ? undefined : d.borrowedHead(type);
    const learned = this.learnedFlow(borrowed === undefined ? type : 'bpmn:SequenceFlow');
    const head = d.prefixes[type] ?? borrowed;
    if (head === undefined) return learned;
    return { ...learned, form: d.case ? 'named' : learned.form, head };
  }

  /** The declared prefix of a request (DeclaredConventions.headFor its BPMN type and trigger). */
  private declaredHead(req: IdRequest): string | undefined {
    return this.d?.headFor(typeOf(req.key), req.trigger);
  }

  /** Whether a declared prefix speaks about the request's id (its type's, or the flow prefix of a connection). */
  private declares(req: IdRequest): boolean {
    if (!this.d) return false;
    return CONNECTIONS.has(req.key) ? this.flowOf(req.key).head !== undefined : this.declaredHead(req) !== undefined;
  }

  /**
   * The body case of a request's id: under a declared prefix the declared
   * case (none declared, `any`: the file's over every id); else the file's
   * own (the ids that do not follow the conventions), where those show
   * none the declared case, unless their prefixes show the other first
   * letter (otherShape: bpmn-cli's). Without declared conventions the file's.
   * A new process the case of the file's process ids (processStyle).
   */
  private caseFor(req?: IdRequest): Body {
    const own = req?.key === 'bpmn:Process' && !this.declares(req) ? this.processStyle() : undefined;
    if (own) return own.body;
    if (!this.d) return this.l.body;
    if (req && this.declares(req)) return this.d.case ?? this.all.body;
    if (this.l.bodyVoted) return this.l.body;
    if (!this.d.case) return this.all.body;
    return this.otherShape() ? this.l.body : this.d.case;
  }

  /**
   * Whether the prefixes of the ids that do not follow the conventions show
   * the other first letter than the declared prefixes of the kinds (Lane_,
   * Participant_, Activity_ next to serviceTask_): the declared case goes
   * with the declared shape, so such a file keeps bpmn-cli's case.
   */
  private otherShape(): boolean {
    const l = this.l;
    if (l.lowerFirst + l.upperFirst < MIN_EVIDENCE) return false;
    const v = this.d!.votes;
    return l.lowerFirst > l.upperFirst ? v.upper > v.lower : l.upperFirst > l.lowerFirst && v.lower > v.upper;
  }

  /** Whether a declared camelCase / PascalCase checks the request's id (no `_` in its body, a letter first): a glued suffix, `<id>Join`, a kind word before a number. */
  private lettersOnly(req: IdRequest): boolean {
    return this.declares(req) && (this.d!.case === 'camel' || this.d!.case === 'pascal');
  }

  /** The separator of a request's collision suffix: none where a declared camelCase / PascalCase checks it (serviceTask_checkInvoice2; withSuffix puts No before it after a digit), else `_`. */
  private sepFor(req: IdRequest): string {
    return this.lettersOnly(req) ? '' : '_';
  }

  /** The separator of the collision suffix of a kind's ids (split's join gateway: gateway_okJoin2). */
  suffixSep(key: string): string {
    return this.sepFor(IdStyle.keyRequest(key));
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
    return this.learnedPrefix(req, bare).prefix;
  }

  /** prefixFor and where it comes from (the conventions view). */
  private learnedPrefix(req: IdRequest, bare = true): { prefix: string; source: PrefixSource } {
    const l = this.l;
    // the shape of a prefix nothing declares (type-named, first letter): the file's ids decide; a file without evidence
    // of its own takes the declared prefixes' (a new file looks like one that follows the conventions)
    const dv = this.d && l.lowerFirst + l.upperFirst < MIN_EVIDENCE ? this.d.votes : NO_VOTES;
    const lowerFile = l.lowerFirst + dv.lower >= MIN_EVIDENCE && l.lowerFirst + dv.lower > l.upperFirst + dv.upper;
    const min = l.strong ? 1 : MIN_EVIDENCE;
    const typeName = req.typeNames[0]!;
    const withTrigger = (lowerFirst: boolean): string => this.caseLike(req.trigger ? `${req.trigger}${ucfirst(typeName)}` : typeName, lowerFirst);
    const usable = (p: string | undefined): p is string => p !== undefined && (bare || p !== '');
    const file = (prefix: string): { prefix: string; source: PrefixSource } => ({ prefix, source: 'file' });
    // a new process: the prefix the file's process ids share
    const processes = req.key === 'bpmn:Process' ? this.processStyle() : undefined;
    if (processes) return file(processes.prefix);
    if (req.trigger) {
      const exact = l.byKeyTrigger.get(`${req.key}|${req.trigger}`)?.top(min);
      if (usable(exact)) return file(exact);
    }
    const own = l.byKey.get(req.key);
    const ownTop = own?.top(min);
    if (usable(ownTop)) {
      const cls = l.classByKey.get(req.key)!;
      if (ownTop && cls.get('triggerKind') > cls.get('kind') && cls.get('triggerKind') >= cls.get('literal')) return file(withTrigger(/^[a-z]/.test(ownTop)));
      return file(ownTop);
    }
    const fam = l.family.get(req.prefix);
    if (fam) {
      const generic = fam.generic.top(min);
      const kindish = fam.kindish.total;
      if (usable(generic) && fam.generic.get(generic) >= kindish) return file(generic);
      if (kindish >= MIN_EVIDENCE) return file(fam.kindish.get('triggerKind') > fam.kindish.get('kind') ? withTrigger(lowerFile) : this.caseLike(typeName, lowerFile));
    }
    // a family the file has prefixed ids of (one is enough) keeps a prefix; else the file's flow nodes decide
    if (bare && !fam?.prefixed && l.bareNodes >= MIN_EVIDENCE && l.bareNodes > l.prefixedNodes) return file('');
    const kindish = l.classes.get('kind') + l.classes.get('triggerKind') + dv.kind;
    const source: PrefixSource = dv.kind + dv.literal > 0 ? 'lint shape' : l.classes.total + l.lowerFirst + l.upperFirst > 0 ? 'file' : 'default';
    if (kindish >= MIN_EVIDENCE && kindish > l.classes.get('literal') + dv.literal) return { prefix: this.caseLike(typeName, lowerFile), source };
    return { prefix: this.caseLike(req.prefix, lowerFile), source };
  }

  /** A name or a context as an id body in a case (default: the file's; '' when it has no usable words). */
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
  private unnamedText(req: IdRequest, spelled = false, head?: string): string {
    const context = nameWords(req.context).length ? req.context! : '';
    const word = kindWord(req.key, req.trigger, !!context && !spelled);
    // under a declared prefix the word says only what the prefix does not (startEvent_ + TimerStart: Timer)
    return `${head === undefined ? word : unsaid(word, head)} ${context}`.trim();
  }

  /**
   * The id an element request wants (before collision handling): its name,
   * else its kind and context, after the file's prefix; at most `max`
   * characters (a file prefix of more than 52 characters stays where the
   * body's words up to its first word with a letter that is no filler word
   * fit beside it whole, an unnamed element's up to its anchor's first
   * word: leadOf; else this id takes the bpmn-cli prefix of the kind, in
   * the case of the file's prefix). `qualified`: the context ends with the
   * anchor's kind (IdRequest.anchorKind), which a cut of a long context
   * leaves in place. A declared prefix (declaredHead) is taken as it is,
   * with a body in the declared case (see DECLARED CONVENTIONS).
   */
  private derived(req: IdRequest, spelled = false, qualified = false, max = MAX_ID): string {
    const named = hasIdWords(req.name);
    const c = this.caseFor(req);
    const head = this.declaredHead(req);
    if (head !== undefined) {
      const room = max - head.length;
      const body = this.declaredBody(named ? req.name! : this.unnamedText(req, spelled, head), req, head, c);
      if (qualified && !named && req.anchorKind) return `${head}${this.withWord(body, req.anchorKind, Math.min(room, MAX_SLUG), c)}`;
      if (req.tailWord) return `${head}${this.withWord(body, req.tailWord, room, c)}`;
      return `${head}${cutBody(body, room, c)}`;
    }
    const prefix = this.prefixFor(req);
    if (prefix === '' && named) {
      const bare = this.bareBody(req.name);
      if (bare) return req.tailWord ? this.withWord(bare, req.tailWord, max, this.l.bareBody) : cutBody(bare, max, this.l.bareBody);
    }
    // an unnamed element keeps a prefix in a file whose named ids have none
    let p = prefix === '' ? this.prefixFor(req, false) : prefix;
    const body = this.bodyOf(named ? req.name : this.unnamedText(req, spelled), c) || this.bodyOf(kindWord(req.key, req.trigger), c);
    // a long file prefix (one that leaves a body fewer than 8 characters beside a suffix up to `_99`: more than 52) stays
    // where the body's words up to its first one with a letter fit beside it whole (an unnamed element's: up to its
    // anchor's first word, afterCheck); else the bpmn-cli prefix of the kind in the case of the file's prefix
    // (activity_auftrag, activity_afterCheckOrder)
    if (MAX_ID - p.length - 1 - 3 < 8 && leadOf(body, !named).length > max - p.length - 1) p = this.caseLike(req.prefix, /^[a-z]/.test(p));
    const room = max - p.length - 1;
    if (qualified && !named && req.anchorKind) return `${p}_${this.withWord(body, req.anchorKind, Math.min(room, MAX_SLUG), c)}`;
    if (req.tailWord) return `${p}_${this.withWord(body, req.tailWord, room, c)}`;
    return `${p}_${cutBody(body, room, c)}`;
  }

  /**
   * The body after a declared prefix: the text in case `c`; where it gives
   * nothing, or begins with a number under a declared camelCase /
   * PascalCase (whose bodies begin with a letter), the kind word first,
   * without what the prefix already says, or the whole word where the
   * prefix says all of it (startEvent_ + `1st of month` on a timer:
   * startEvent_timer1stOfMonth; scriptTask_ + `4 Augen`:
   * scriptTask_scriptTask4Augen).
   */
  private declaredBody(text: string, req: IdRequest, head: string, c: Body): string {
    const body = this.bodyOf(text, c);
    if (body && !(this.lettersOnly(req) && /^[0-9]/.test(body))) return body;
    const word = kindWord(req.key, req.trigger);
    return this.bodyOf(`${unsaid(word, head) || word} ${text}`, c);
  }

  /** A body with a word appended in a case (`AfterCheck` + Gateway -> `AfterCheckGateway`, `after_check_gateway`), the body cut so that the word stays within `max` (where that leaves the body fewer than 8 characters, body and word are cut as one). */
  private withWord(body: string, word: string, max: number, c: Body): string {
    const tail = c === 'snake' ? `_${snakeSlug(word)}` : c === 'pascalSnake' ? `_${pascalSnakeSlug(word)}` : slugify(word);
    return max - tail.length >= 8 ? `${cutName(body, max - tail.length)}${tail}` : cutName(`${body}${tail}`, max);
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
    const prefix = (this.declaredHead(req) ?? (this.prefixFor(req) || this.prefixFor(req, false))).toLowerCase();
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
   * The ids a request wants: derivedBase, and for a request with a long id
   * also the id before the length cap, the ids cut to leave room for a
   * collision suffix of up to 4 characters (`_100`, see next) and, for a
   * flow, the id 0.6 and earlier wanted before their cap (a head that now
   * gives way to Flow_ included) and the ids they cut it to (legacyFitPair;
   * cut again for a suffix from `_100`), and the same in every other style
   * the file's flows show (Learned.flowStyles: the `named` ones under each
   * flow prefix, which bpmn-cli gave them before another form or prefix had
   * the majority, and each form built from the ends under the prefixes that
   * voted for it), so that a flow a file got before still names its ends
   * (ops/flows.ts followEnds), whichever way the vote goes. With declared
   * conventions also the ids of the file's own style (learnedOnly): a flow
   * named before they applied still names its ends. `id`: only the other
   * styles whose ids it can be (it starts with their head, prefix and a
   * scopedTo flow's scope, or with Flow_ where their head is long enough to
   * give way to it): a file whose flows show many prefixes or scopes costs a
   * string test per style, not its bases.
   */
  derivedBases(req: IdRequest, id?: string): string[] {
    const own = this.basesOf(req, id);
    return this.d ? [...new Set([...own, ...this.learnedOnly().basesOf(req, id)])] : own;
  }

  /** derivedBases in this style alone. */
  private basesOf(req: IdRequest, id?: string): string[] {
    if (!isConnection(req)) {
      const uncut = this.wanted(req, Infinity).base;
      // short enough for every suffix: no cut can differ from it
      return uncut.length <= MAX_ID - 4 ? [uncut] : [...new Set([...[0, 1, 2, 3, 4].map((suffix) => this.wanted(req, MAX_ID - suffix).base), uncut])];
    }
    const style = this.flowOf(req.key);
    const bases = this.connectionBases(req, style);
    // the file's other flow styles (a flow to the join of a split is named by its label, CheckJoin, not by its id stem);
    // under a declared prefix the file's own style lists them (derivedBases: learnedOnly)
    if (style.head === undefined) for (const other of this.l.flowStyles.get(this.l.flows.has(req.key) ? req.key : 'bpmn:SequenceFlow') ?? []) if (id === undefined || mayBeOf(id, other)) bases.push(...this.connectionBases(req, other));
    return [...new Set(bases)];
  }

  /**
   * The ids a flow style gives a connection (basesOf): before the length
   * cap, cut for a suffix of up to 4 characters, and as 0.6 wanted and cut
   * it, also a short one (a scopedTo end word 0.6 took: Flow_KotO_ReserveTo4),
   * cut again for a suffix of 4 characters and more (`_100`; stemTo /
   * scopedTo: `1000`), and the id 0.6 wanted before its cap, with a head
   * that now leaves the ends too little room (connectionBase).
   */
  private connectionBases(req: IdRequest, style: FlowStyle): string[] {
    const at = (max: number, legacy = false): string => this.connectionBase(req, max, legacy, style).base;
    const uncut = at(Infinity);
    const legacy = at(LEGACY_BASE, true);
    return [...(uncut.length <= MAX_ID - 4 ? [] : [0, 1, 2, 3, 4].map((suffix) => at(MAX_ID - suffix))), legacy, cutAt(legacy, MAX_ID - 4, true), at(Infinity, true), uncut];
  }

  /** The id the request wants, at most `max` characters, and the separator of its collision suffix (`_2`; the file-learned stemTo and scopedTo flows and a declared camelCase / PascalCase: `2`). */
  private wanted(req: IdRequest, max = MAX_ID): { base: string; sep: string } {
    if (isConnection(req)) return this.connectionBase(req, max);
    // the process and the definitions are bpmn-cli's (Process_<Name>) unless a declared prefix names their type exactly,
    // or the file's process ids share a prefix (a process)
    if (this.fileLevel(req)) return IdStyle.DEFAULT.wanted(req, max);
    return { base: this.derived(req, false, false, max), sep: this.sepFor(req) };
  }

  /**
   * The prefix a new element of a kind or type gets and where it comes from
   * (`show --conventions`): a declared prefix (`lint`), else the file's
   * style; the body's case with it.
   */
  explain(req: IdRequest): { head: string; source: PrefixSource; body: Body } {
    const head = this.declaredHead(req);
    if (head !== undefined) return { head, source: 'lint', body: this.caseFor(req) };
    if (this.fileLevel(req)) return IdStyle.DEFAULT.explain(req);
    const { prefix, source } = this.learnedPrefix(req);
    return { head: prefix ? `${prefix}_` : '', source, body: this.caseFor(req) };
  }

  /**
   * How new flows of a type are named and where their prefix comes from
   * (`show --conventions`): the style, and the head and form its ids get in
   * effect (connectionBase: F_ for a numbered F12, Flow_ after a prefix that
   * leaves the ends no room; `fallback`: Flow_ where a long one leaves them
   * too little).
   */
  explainFlow(type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow'): { style: FlowStyle; head: string; form: FlowForm; fallback?: string; source: PrefixSource; body: Body } {
    const style = this.flowOf(type);
    const source: PrefixSource = style.head !== undefined ? 'lint' : this.l.flows.has(type) || this.l.flows.has('bpmn:SequenceFlow') ? 'file' : 'default';
    const body = this.caseFor(connectionRequest(type, '', ''));
    return { style, ...effectiveHead(style, body), source, body };
  }

  /**
   * W_ID_PREFIX_STALE: an element kept its id through a change of its type
   * or trigger (`from` -> `to`), and the id starts with none of the
   * prefixes the declared conventions accept for `to`, but with one they
   * accept for `from`: that prefix (`was`) and the id with the prefix new
   * ids of `to` get and the rest of the id (`suggested`, not claimed), where
   * the id passed the rule for `from` (inDeclaredCase: its body in the
   * declared case too); one that did not (serviceTask_shipGoods under
   * PascalCase), or that starts with a `was` without separator by accident
   * (userTask_checkOrder under a prefix `user`, also under the case any:
   * the rest has a prefix of its own that completes `was` into the old
   * type's name), suggests the id `now` wants, an
   * unnamed one with the words of the rest after `was` (after that prefix)
   * as the context: scriptTask_ShipGoods, manualTask_checkOrder, and
   * userTask_userTask1 for an unnamed serviceTask_1 under camelCase, never
   * the old kind's words. Or they accept none for
   * `from` (a type switched off or ignored, an event whose qualified prefix
   * is too long: the rule did not check the id, the change makes it):
   * no `was`, and the id `now` (the request for what the element is now:
   * kind, trigger, name) wants, an unnamed one with its id's speaking part
   * as the context. Undefined otherwise (an id that never fitted `from`).
   */
  stalePrefix(id: string, from: IdState, to: IdState, now?: IdRequest): { was?: string; heads: string[]; suggested: string } | undefined {
    const d = this.d;
    if (!d) return undefined;
    const heads = d.headsOf(to);
    if (!heads.length || d.acceptsId(id, to)) return undefined;
    const was = d.headOf(id, from);
    if (was === undefined && d.headsOf(from).length) return undefined;
    // the rest after `was`; after a `was` without separator, a prefix of its own that completes it into the old type's
    // name (Task_ of userTask_checkOrder under `user`) says the id starts with it by accident: what follows that
    // prefix is its body, whatever the case
    const rest = was === undefined ? undefined : id.slice(was.length);
    const own = rest !== undefined && /[A-Za-z0-9]$/.test(was!) ? PREFIXED.exec(rest) : null;
    const accidental = own && `${was}${own[1]}`.toLowerCase() === from.type.slice(from.type.indexOf(':') + 1).toLowerCase() ? own : null;
    if (now && (rest === undefined || accidental || !d.inDeclaredCase(id, from))) {
      // an unnamed one: the words of its id after `was` as the context (serviceTask_1: 1, never the old kind's words),
      // of its speaking part where the rule did not check it
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
   * The id of the join gateway of a split whose gateway is `gatewayId`
   * (`<id>_join`, camel `<id>Join`, pascalSnake `<id>_Join`; a bare id
   * `<id>Join`). Under a declared prefix of the kind the declared case
   * decides (camelCase / PascalCase `<id>Join`, snake_case `<id>_join`),
   * and a gateway id that does not start with a prefix the conventions
   * accept (an explicit Gateway_Check) gives the declared prefix and
   * `label` (the gateway's: ElementLabels.label) with Join: gateway_checkJoin; one whose
   * body after that prefix is not in the declared case, the words of that
   * body: gateway_Approved under camelCase gives gateway_approvedJoin.
   */
  joinId(gatewayId: string, key = 'exclusiveGateway', label = speakingStem(gatewayId) ?? gatewayId): string {
    const req = IdStyle.keyRequest(key);
    const head = this.declaredHead(req);
    const state = { type: typeOf(key) };
    if (head !== undefined && !this.d!.inDeclaredCase(gatewayId, state)) {
      const c = this.caseFor(req);
      const own = this.d!.headOf(gatewayId, state);
      const body = own === undefined ? '' : stemWords(gatewayId.slice(own.length)).join(' ');
      return `${head}${this.withWord(this.declaredBody(hasIdWords(body) ? body : label, req, head, c), 'Join', MAX_ID - head.length, c)}`;
    }
    const base = cutAt(gatewayId, MAX_ID - '_join'.length);
    if (head !== undefined && this.d!.case) return this.d!.case === 'snake' ? `${base}_join` : `${base}Join`;
    if (!gatewayId.includes('_') && this.l.bareNodes) return `${base}Join`;
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
   * A free id for the request (not claimed) and the id it wanted (`base`;
   * different when that one was taken); at most MAX_ID characters. An
   * unnamed gateway or activity whose id is taken, or whose body another
   * element's id has (the unnamed gateway it follows: Gateway_AfterCheck),
   * first spells out its kind (spelledBase), then, after an unnamed anchor
   * whose context it repeats, names that anchor's kind (qualifiedBase:
   * Task_AfterCheckGateway): the first of them whose id and body are free,
   * else the first whose id is free, else a suffix (on the anchor-qualified
   * id when the base's own id is free but another id has its body). A base
   * that leaves no room for the suffix is cut again to `MAX_ID - suffix`:
   * a flow's ends share what is left (fitPair), an anchor-qualified id
   * keeps the anchor's kind, and a long flow head that gives way to Flow_
   * there gives the whole id that form (`Flow_Validate_To_Step1_2`). A cut
   * that gives the base back with the suffix (an element body the cap ends
   * on a number: `x_2` + `_2`) skips that suffix: a shorter cut would read
   * as the id of another name (`x_2` for `x_2_2`).
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
    // the base cut again for a suffix, and the separator of the form it is cut to
    const recut = (max: number): { base: string; sep: string } => (base === qualified ? { base: this.derived(req, false, true, max), sep } : this.wanted(req, max));
    const suffixed = (n: number): string => {
      let given: { base: string; sep: string } | undefined;
      const out = withSuffix(base, sep, n, (max) => {
        const c = recut(max);
        if (c.sep !== sep) given ??= c;
        return c.base;
      });
      if (!given) return out;
      // a long head that gives way to Flow_ in the cut for the suffix: the whole id takes that form, its base and its
      // `_2` (not the glued 2 of the form it gave up, nor `_2` on the base that kept the head)
      const suffix = `${given.sep}${n}`;
      const room = recut(MAX_ID - suffix.length);
      return `${room.sep === given.sep ? room.base : given.base}${suffix}`;
    };
    for (let n = 2; ids.has(id); n++) id = suffixed(n);
    return { id, base };
  }

  /**
   * `legacy`: the ends cut as 0.6 and earlier cut them (legacyFitPair;
   * derivedBases). A head (the flow prefix, and a scopedTo flow's scope) that
   * leaves the ends fewer than 16 of the 64 characters stays, per flow,
   * where the ends fit beside it at whole words (IdFitter.whole,
   * IdFitter.wholeIdForm), and gives way elsewhere to a named flow with the
   * default prefix Flow_, a scopedTo flow's ends named by their end words,
   * so one file can hold both forms (not `legacy`: 0.6 kept the head and
   * cut the ends).
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
      const fitter = new IdFitter({ legacy, sep: '' });
      const [a, b] = [fitter.endWord(s, own, 'Start'), fitter.endWord(t, own, 'End')];
      if (legacy) return { base: cutAt(`${head}${a}To${b}`, max, true), sep: '' };
      // the two words share the room after the scope like any flow's ends (0.6 cut the whole id: Flow_KotO_ValidateTo); a
      // long head stays where they fit beside it whole, elsewhere the flow is named by its end words (Flow_Validate_To_Pack)
      const base = long(head, 'To') ? fitter.whole(head, a, 'To', b, max) : fitter.pair(head, a, 'To', b, max);
      return base !== undefined ? { base, sep: '' } : { base: this.namedBase({ ...req, sourceLabel: a, targetLabel: b }, max, DEFAULT_FLOW.prefix, undefined, false), sep: '_' };
    }
    const own = form === 'stemTo' ? '' : '_';
    const fitter = new IdFitter({ legacy });
    if (!long(`${prefix}_`, FORM_JOIN[form])) return { base: fitter.idForm(form, `${prefix}_`, req, max), sep: own };
    // a long flow prefix stays where the ends fit beside it at whole words, elsewhere a named flow with Flow_
    const base = fitter.wholeIdForm(form, `${prefix}_`, req, max);
    return base !== undefined ? { base, sep: own } : { base: this.namedBase(req, max, DEFAULT_FLOW.prefix, undefined, false), sep: '_' };
  }

  /** The scope of a scopedTo flow: the one one of the ends names as a segment of its id (KotO in serviceTask_KotO_ValidatePayment), else the most used one. */
  private scopeOf(req: IdRequest, scope: string): string {
    const scopes = this.l.scopes.get(req.key) ?? this.l.scopes.get('bpmn:SequenceFlow') ?? [scope];
    return scopes.find((x) => req.source!.split('_').includes(x) || req.target!.split('_').includes(x)) ?? scope;
  }

  /**
   * The base of a flow under a declared prefix (`head`, its separator
   * included; it never gives way to Flow_): `named` under a declared case,
   * its ends without the file's scope segment (flow_validateInvoiceToBook,
   * not ...ToKotOBook), an end that begins with a number written `From...`
   * where camelCase / PascalCase wants a letter first; else the file's form
   * after the head. The collision suffix is the declared case's.
   */
  private declaredFlowBase(req: IdRequest, max: number, form: FlowForm, head: string, legacy: boolean): { base: string; sep: string } {
    const sep = this.sepFor(req);
    if (form === 'named') {
      const c = this.caseFor(req);
      const scopes = this.l.scopes.get(req.key) ?? this.l.scopes.get('bpmn:SequenceFlow') ?? [];
      const label = (id: string, given: string | undefined): string => {
        const text = given && nameWords(given).length ? given : (speakingStem(id) ?? id);
        return (scopes.length && text.split('_').filter((x) => !scopes.includes(x)).join('_')) || text;
      };
      const source = label(req.source!, req.sourceLabel);
      const target = label(req.target!, req.targetLabel);
      const fitter = new IdFitter({ body: c, legacy, sep, ...(c === 'camel' ? { names: nameWords(source) } : {}) });
      let [a, join, b] = fitter.ends(source, target, false);
      if (this.lettersOnly(req) && /^[0-9]/.test(a)) a = fitter.ends(`From ${source}`, target, false)[0];
      return { base: fitter.pair(head, a, join, b, max), sep };
    }
    if (form === 'scopedTo') {
      const own = this.scopeOf(req, this.flowOf(req.key).scope!);
      const fitter = new IdFitter({ legacy, sep });
      const [a, b] = [fitter.endWord(req.source!, own, 'Start'), fitter.endWord(req.target!, own, 'End')];
      return { base: legacy ? cutAt(`${head}${own}_${a}To${b}`, max, true) : fitter.pair(`${head}${own}_`, a, 'To', b, max), sep };
    }
    return { base: new IdFitter({ legacy }).idForm(form, head, req, max), sep };
  }

  /** The base of a `named` flow with the prefix and separator of the file's flows (`legacy`: connectionBase). */
  private namedBase(req: IdRequest, max: number, prefix: string, sep: string | undefined, legacy: boolean): string {
    const label = (id: string, given: string | undefined): string => (given && nameWords(given).length ? given : (speakingStem(id) ?? id));
    const c = this.caseFor(req);
    const { head, glued, long } = new IdFitter({ body: c, legacy }).namedHead(prefix, sep);
    const source = label(req.source!, req.sourceLabel);
    const fitter = new IdFitter({ body: c, legacy, ...(c === 'camel' && !glued ? { names: nameWords(source) } : {}) });
    const [a, join, b] = fitter.ends(source, label(req.target!, req.targetLabel), glued);
    if (!long) return fitter.pair(head, a, join, b, max);
    // a long prefix stays where the ends fit beside it at whole words, elsewhere the default Flow_
    return fitter.whole(head, a, join, b, max) ?? this.namedBase(req, max, DEFAULT_FLOW.prefix, undefined, legacy);
  }
}

/**
 * The head and form the ids of a flow style get in effect (connectionBase):
 * a declared head as it is, else the file's; a head that leaves the ends
 * fewer than 16 of the 64 characters gives way to a `named` Flow_ flow
 * where the ends do not fit beside it at whole words (`fallback`: that
 * head), and everywhere where it leaves them no room at all.
 */
function effectiveHead(style: FlowStyle, c: Body): { head: string; form: FlowForm; fallback?: string } {
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

/** No such votes: a file with evidence of its own, or no declared conventions. */
const NO_VOTES: Votes = { kind: 0, literal: 0, lower: 0, upper: 0 };


/**
 * Whether a flow id is a cut of a form built from its ends' ids with the
 * prefix `prefix`: one of the bases derivedBases lists for the form (cut to
 * leave room for a suffix of up to 4 characters, or as 0.6 cut it, also
 * again for `_100`), with or without a suffix, so that a flow the length
 * cap cut still votes for its form (learn). Only for an id the form's
 * uncut base would not give (flowForms has those).
 */
function cutOfForm(id: string, form: IdForm, prefix: string, request: () => IdRequest): boolean {
  const rest = id.slice(prefix.length + 1);
  const join = FORM_JOIN[form];
  // cheap tests first: a cut keeps the word between the ends, and a stemTo source begins in lower case
  if (id.length > MAX_ID || !rest.includes(join) || (form === 'stemTo' && /^[A-Z]/.test(rest) && !rest.startsWith(join))) return false;
  const req = request();
  if (form === 'stemTo' || form === 'stemSnake') {
    // and the start of the source (an empty one: the join), unless the ends begin alike (a source without its first word)
    const { a, b } = new IdFitter().stemEnds(form, req);
    if (!beginAlike(a, b) && rest.charAt(0) !== a.charAt(0) && !rest.startsWith(join)) return false;
  }
  const fitter = new IdFitter();
  if (fitter.idForm(form, `${prefix}_`, req, Infinity).length <= MAX_ID - 4) return false;
  const sep = form === 'stemTo' ? '' : '_';
  const suffixed = (base: string): boolean => id.startsWith(base) && isSuffix(base, id.slice(base.length), sep);
  const legacy = new IdFitter({ legacy: true }).idForm(form, `${prefix}_`, req, LEGACY_BASE);
  if (id === legacy || suffixed(legacy) || suffixed(cutAt(legacy, MAX_ID - 4, true))) return true;
  if (id === fitter.idForm(form, `${prefix}_`, req, MAX_ID)) return true;
  // a suffix of up to 4 characters cut the base to leave it room (next); a glued one can take any of the last digits,
  // and the letter word before them after a base that ends in a digit (`No2`)
  const digits = (sep === '' ? /\d+$/ : /_\d+$/).exec(id)?.[0] ?? '';
  const ks: number[] = [];
  for (let k = sep === '' ? 1 : digits.length; k <= Math.min(digits.length, 4); k++) ks.push(k);
  if (sep === '' && digits.length <= 4 && id.endsWith(`${SUFFIX_WORD}${digits}`)) ks.push(SUFFIX_WORD.length + digits.length);
  for (const k of ks) {
    const suffix = id.slice(id.length - k);
    if (/^_?0/.test(suffix.slice(suffix.startsWith(SUFFIX_WORD) ? SUFFIX_WORD.length : 0))) continue;
    if (id.slice(0, -k) === fitter.idForm(form, `${prefix}_`, req, MAX_ID - k)) return true;
  }
  return false;
}

/**
 * The scope of a scopedTo flow 0.6 cut to an empty target word under the
 * prefix `prefix` (`Flow_KotO_WarenwirtschaftssystemabgleichTo`, with a
 * glued suffix or none), which SCOPED_TO does not read: the base 0.6 wanted
 * for its ends (connectionBase `legacy`; derivedBases lists it), so that
 * enough of them do not flip a 0.6 file's form (learn). Undefined for any
 * other id.
 */
function legacyScopedCut(id: string, prefix: string, source: string, target: string): string | undefined {
  const m = SCOPED_CUT.exec(id.slice(prefix.length + 1));
  if (!m) return undefined;
  const scope = m[1]!;
  // cheap test first: the source's end word as 0.6 took it
  const fitter = new IdFitter({ legacy: true });
  const a = fitter.endWord(source, scope, 'Start');
  if (!m[2]!.startsWith(a)) return undefined;
  const legacy = cutAt(`${prefix}_${scope}_${a}To${fitter.endWord(target, scope, 'End')}`, LEGACY_BASE, true);
  const suffixed = (base: string): boolean => id.startsWith(base) && isSuffix(base, id.slice(base.length), '');
  return id === legacy || suffixed(legacy) || suffixed(cutAt(legacy, MAX_ID - 4, true)) ? scope : undefined;
}

/** A body cut to `max` (cutName) in case `c`: a camelCase body that lost its leading number to the cut (withLetter) begins in lower case (`rechnung`, not `Rechnung`). */
function cutBody(body: string, max: number, c: Body): string {
  const cut = cutName(body, max);
  return c === 'camel' && /^[0-9]/.test(body) && /^[A-Z]/.test(cut) ? cut.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (m) => m.toLowerCase()) : cut;
}

/**
 * A body's words up to and with its first word with a letter that is no
 * filler word (`10202422024Rechnung`, `auftrag`, `theArchivieren`); for an
 * unnamed element (`unnamed`) the first such word after its context word,
 * After / Before / On / In among its first three words (`afterCheck`,
 * `timerOnReview`), so that its id still names the anchor: what a long
 * prefix leaves room for (IdStyle.derived).
 */
function leadOf(body: string, unnamed = false): string {
  const words = idWords(body);
  const from = unnamed ? words.slice(0, 3).findIndex((w) => CONTEXT_WORDS.has(w.replace(/^[_.-]+/, '').toLowerCase())) + 1 : 0;
  const at = words.findIndex((w, i) => i >= from && /[A-Za-z]/.test(w) && !isFiller(w));
  return (at === -1 ? words : words.slice(0, at + 1)).join('');
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
  'complexGateway',
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

