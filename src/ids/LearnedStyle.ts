import { kindOf, triggerOf } from '../model/kinds.js';
import { is, isBpmnElement, walk, type El } from '../model/utils/moddle.js';
import { cutAt, isSuffix, MAX_ID, nameWords, pascalSnakeSlug, snakeSlug, SUFFIX_WORD } from './utils/slug.js';
import { beginAlike, caseLike, GENERIC, GLUED, HASH, lcfirst, localName, PREFIXED, prefixClass, stem, TOOL_DEFAULTS, ucfirst, type PrefixClass } from './utils/id-words.js';
import { CONNECTIONS, connectionRequest, kindTypeNames, type IdRequest } from './utils/requests.js';
import { ElementLabels } from './ElementLabels.js';
import { ID_FORMS, IdFitter, LEGACY_BASE, FORM_JOIN, type IdForm } from './IdFitter.js';
import { MIN_EVIDENCE, Tally } from './Tally.js';
import type { DeclaredConventions, Votes } from './DeclaredConventions.js';
import type { Body, FlowForm, FlowStyle, PrefixSource } from './style.js';

export const DEFAULT_FLOW: FlowStyle = { form: 'named', prefix: 'Flow' };

/** No such votes: a file with evidence of its own, or no declared conventions. */
const NO_VOTES: Votes = { kind: 0, literal: 0, lower: 0, upper: 0 };

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

type BodyClass = Body | 'hash' | 'numbered' | 'lower' | 'other';

/** A flow form as read from a file: the forms new flows get, or hashed / numbered flows (new ones get `named` with their prefix). */
type SeenForm = FlowForm | 'hash' | 'numbered';
interface SeenFlow {
  form: SeenForm;
  prefix: string;
  sep?: string;
  scope?: string;
}

/**
 * The flow forms in the order a tie between them goes (voteFlows): a form that
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

/** The votes of one type's flows (readFlow, voteFlows). */
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

interface IdsRead {
  samples: number;
  prefixed: number;
  nodeBodies: Tally<BodyClass>;
  bareBodies: Tally<BodyClass>;
  otherBodies: Tally<BodyClass>;
  flowVotes: Map<string, FlowVotes>;
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

const FLOW_NODE_FAMILIES = new Set(['task', 'subProcess', 'callActivity', 'gateway', 'event']);

/** BPMN elements whose ids say nothing about the conventions (tool defaults, ids nobody chooses). */
const IGNORED = ['bpmn:Definitions', 'bpmn:Process', 'bpmn:EventDefinition', 'bpmn:Expression', 'bpmn:ExtensionElements', 'bpmn:Documentation', 'bpmn:LoopCharacteristics', 'bpmn:InputOutputSpecification', 'bpmn:InputSet', 'bpmn:OutputSet'];

/**
 * The conventions of a document's ids (see the IdStyle module contract).
 * With declared conventions (`d`) the ids that already follow them do not
 * vote (conforms; flows aside), and single lower-case words alone show no
 * case (lane_sales: the declared camelCase's as much as snake_case's).
 */
export class LearnedStyle {
  /** literal prefixes per key and per key|trigger */
  private readonly byKey = new Map<string, Tally<string>>();
  private readonly byKeyTrigger = new Map<string, Tally<string>>();
  private readonly classByKey = new Map<string, Tally<PrefixClass>>();
  private readonly family = new Map<string, FamilyStats>();
  private readonly classes = new Tally<PrefixClass>();
  private lowerFirst = 0;
  private upperFirst = 0;
  readonly body: Body;
  /** the file's ids showed a case (else `body` is the default) */
  readonly bodyVoted: boolean;
  private readonly flows = new Map<string, FlowStyle>();
  /** the types whose flows show a style (a form or a prefix of at least two of them); a type in `flows` without it has bpmn-cli's prefix Flow */
  private readonly flowVoted = new Set<string>();
  /** the file's ids are mostly prefixed (see MIN_EVIDENCE): one id is evidence for its kind and family */
  private readonly strong: boolean;
  /** scopedTo flows: the scopes of a type's flows, most used first */
  private readonly scopes = new Map<string, string[]>();
  /**
   * every style a type's flows show besides the one new flows take (`flows`):
   * `named` under each flow prefix with its separator (the flows bpmn-cli
   * named before another form or prefix had the majority, and those of a
   * prefix a tie or a few more flows outvoted), each form built from the
   * ends with the prefixes that voted for it (scopedTo: with each scope).
   * derivedBases lists their ids too, so a flow named in one of them still
   * names its ends
   */
  private readonly flowStyles = new Map<string, FlowStyle[]>();
  /** flow node ids without / with a prefix: a file whose flow nodes mostly have none gives a kind without own evidence none either */
  private bareNodes = 0;
  private prefixedNodes = 0;
  /** the case of bare ids (voted by the bare ids that spell their names; prefixed ids vote `body`) */
  readonly bareBody: 'pascal' | 'camel';
  /** the prefixes of the process ids (no vote on anything else: processStyle), and the classes of their bodies per prefix */
  private readonly processes = new Tally<string>();
  private readonly processBodies = new Map<string, Tally<BodyClass>>();
  private rejected = false;

  constructor(defs: El | undefined, d?: DeclaredConventions) {
    const read: IdsRead = { samples: 0, prefixed: 0, nodeBodies: new Tally(), bareBodies: new Tally(), otherBodies: new Tally(), flowVotes: new Map() };
    for (const el of defs ? walk(defs, { bpmnOnly: true }) : []) {
      if (!isBpmnElement(el) || /^(bpmndi|dc|di):/.test(el.$type)) continue;
      const id = el.get<string | undefined>('id');
      if (!id) continue;
      if (CONNECTIONS.has(el.$type)) this.readFlow(el, id, read.flowVotes, d);
      else this.readElement(el, id, read, d);
    }

    this.strong = read.prefixed >= 3 && read.prefixed * 2 >= read.samples;

    // case of the bodies: the named flow nodes' when they show one (pools, lanes, messages often keep tool ids);
    // a single lower-case word fits camel and snake alike (with declared conventions alone: neither, but never a declared
    // PascalCase: then they read as camel, like bare ids); hashes and numbers show none (pascal)
    // bare ids: PascalCase when the file writes them so, else camelCase (single lower-case words read as camel)
    const { bareBodies, nodeBodies, otherBodies } = read;
    this.bareBody = bareBodies.get('pascal') > bareBodies.get('camel') + bareBodies.get('lower') ? 'pascal' : 'camel';
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
    this.body = best[0];
    this.bodyVoted = best[1] >= MIN_EVIDENCE;

    for (const [type, v] of read.flowVotes) this.voteFlows(type, v);
  }

  /** with declared conventions: the file has an id they check that does not follow them (a prefix they do not accept, a body not in their case, an ignored type's: rejects; IdStyle.ownStyleDiffers) */
  get unconforming(): boolean {
    return this.rejected;
  }

  get hasBareNodes(): boolean {
    return this.bareNodes > 0;
  }

  flowOf(type: string): FlowStyle {
    return this.flows.get(type) ?? this.flows.get('bpmn:SequenceFlow') ?? DEFAULT_FLOW;
  }

  showsFlowStyle(type: string): boolean {
    return this.flowVoted.has(type);
  }

  hasFlows(type: string): boolean {
    return this.flows.has(type) || this.flows.has('bpmn:SequenceFlow');
  }

  otherFlowStyles(type: string): FlowStyle[] {
    return this.flowStyles.get(this.flows.has(type) ? type : 'bpmn:SequenceFlow') ?? [];
  }

  scopesOf(type: string): string[] | undefined {
    return this.scopes.get(type) ?? this.scopes.get('bpmn:SequenceFlow');
  }

  /**
   * The style of new process ids where the file's own process ids show one
   * (participant ids never vote): the prefix at least two
   * of them share (bpmn-cli's own Process_<Name> ids vote for Process_), and
   * the case their bodies show (a tie: the file's case where it is one of
   * them, else the first of pascal, camel, snake, pascalSnake), else the
   * file's case: the one a kind the declared conventions do not name gets
   * (IdStyle.caseFor(), so the process matches the pool made with it; without them
   * the file's), also for bodies that show none (hashes, numbers:
   * Process_1, Process_0k3x9qa); single lower-case words (process_customer)
   * are no PascalCase: camel, snake where the file's case is snake_case /
   * Pascal_Snake. Undefined where they share none.
   */
  processStyle(fileCase: () => Body): { prefix: string; body: Body } | undefined {
    const prefix = this.processes.top(MIN_EVIDENCE, (a, b) => this.alphabetical(a, b));
    if (prefix === undefined) return undefined;
    const t = this.processBodies.get(prefix)!;
    const file = fileCase();
    let best: [Body, number] = [file, 0];
    for (const c of ['pascal', 'camel', 'snake', 'pascalSnake'] as const) if (t.get(c) > best[1] || (t.get(c) === best[1] && best[1] > 0 && c === file)) best = [c, t.get(c)];
    const body = best[1] || !t.get('lower') ? best[0] : file === 'snake' || file === 'pascalSnake' ? 'snake' : 'camel';
    return { prefix, body };
  }

  /**
   * The prefix the file gives a new element of the request's kind (see the
   * IdStyle module contract) and where it comes from; '' when the file's ids
   * of the kind have none (only with `bare`: a named element's id can do
   * without a prefix, an unnamed one cannot). `d`: the declared conventions,
   * whose prefixes shape a prefix nothing declares where the file shows none.
   */
  prefixOf(req: IdRequest, bare: boolean, d: DeclaredConventions | undefined): { prefix: string; source: PrefixSource } {
    // the shape of a prefix nothing declares (type-named, first letter): the file's ids decide; a file without evidence
    // of its own takes the declared prefixes' (a new file looks like one that follows the conventions)
    const dv = d && this.lowerFirst + this.upperFirst < MIN_EVIDENCE ? d.votes : NO_VOTES;
    const lowerFile = this.lowerFirst + dv.lower >= MIN_EVIDENCE && this.lowerFirst + dv.lower > this.upperFirst + dv.upper;
    const min = this.strong ? 1 : MIN_EVIDENCE;
    const typeName = req.typeNames[0]!;
    const withTrigger = (lowerFirst: boolean): string => caseLike(req.trigger ? `${req.trigger}${ucfirst(typeName)}` : typeName, lowerFirst);
    const usable = (p: string | undefined): p is string => p !== undefined && (bare || p !== '');
    const file = (prefix: string): { prefix: string; source: PrefixSource } => ({ prefix, source: 'file' });
    if (req.trigger) {
      const exact = this.byKeyTrigger.get(`${req.key}|${req.trigger}`)?.top(min);
      if (usable(exact)) return file(exact);
    }
    const own = this.byKey.get(req.key);
    const ownTop = own?.top(min);
    if (usable(ownTop)) {
      const cls = this.classByKey.get(req.key)!;
      if (ownTop && cls.get('triggerKind') > cls.get('kind') && cls.get('triggerKind') >= cls.get('literal')) return file(withTrigger(/^[a-z]/.test(ownTop)));
      return file(ownTop);
    }
    const fam = this.family.get(req.prefix);
    if (fam) {
      const generic = fam.generic.top(min);
      const kindish = fam.kindish.total;
      if (usable(generic) && fam.generic.get(generic) >= kindish) return file(generic);
      if (kindish >= MIN_EVIDENCE) return file(fam.kindish.get('triggerKind') > fam.kindish.get('kind') ? withTrigger(lowerFile) : caseLike(typeName, lowerFile));
    }
    // a family the file has prefixed ids of (one is enough) keeps a prefix; else the file's flow nodes decide
    if (bare && !fam?.prefixed && this.bareNodes >= MIN_EVIDENCE && this.bareNodes > this.prefixedNodes) return file('');
    const kindish = this.classes.get('kind') + this.classes.get('triggerKind') + dv.kind;
    const source: PrefixSource = dv.kind + dv.literal > 0 ? 'lint shape' : this.classes.total + this.lowerFirst + this.upperFirst > 0 ? 'file' : 'default';
    if (kindish >= MIN_EVIDENCE && kindish > this.classes.get('literal') + dv.literal) return { prefix: caseLike(typeName, lowerFile), source };
    return { prefix: caseLike(req.prefix, lowerFile), source };
  }

  /**
   * Whether the prefixes of the ids that do not follow the conventions show
   * the other first letter than the declared prefixes of the kinds (Lane_,
   * Participant_, Activity_ next to serviceTask_): the declared case goes
   * with the declared shape, so such a file keeps bpmn-cli's case.
   */
  otherShape(d: DeclaredConventions): boolean {
    if (this.lowerFirst + this.upperFirst < MIN_EVIDENCE) return false;
    const v = d.votes;
    return this.lowerFirst > this.upperFirst ? v.upper > v.lower : this.upperFirst > this.lowerFirst && v.lower > v.upper;
  }

  private readFlow(el: El, id: string, flowVotes: Map<string, FlowVotes>, d: DeclaredConventions | undefined): void {
    // a flow of a type the conventions check that does not follow them: the file has a style of its own there
    if (d && !this.rejected && d.rejects({ type: el.$type }, id)) this.rejected = true;
    const source = el.get<El | undefined>('sourceRef')?.get<string | undefined>('id');
    const target = el.get<El | undefined>('targetRef')?.get<string | undefined>('id');
    // a message flow under the prefix it borrows from the sequence flows (flowOf) does not vote: bpmn-cli wrote it
    // from the declared conventions, so it never ends the borrowing
    const borrowed = d && el.$type === 'bpmn:MessageFlow' ? d.borrowedHead(el.$type) : undefined;
    if (borrowed !== undefined && id.startsWith(borrowed)) return;
    let v = flowVotes.get(el.$type);
    if (!v) flowVotes.set(el.$type, (v = { n: 0, glued: [], gluedNamed: [], joined: [], forms: new Tally(), prefixes: new Map(), any: new Tally(), uses: new Tally(), seps: new Map(), scopes: new Tally() }));
    // a glued flow named by its ends with a suffix (flowCheckToShip_2) is not the prefix flowCheckToShip and a number: it
    // lends no prefix, and counts only for a file's glued numbered flows (flow12, below)
    if (GLUED_SUFFIXED.test(id)) {
      v.glued.push(id);
      return;
    }
    v.n++;
    // one without a suffix (flowCheckToShip, fPackToWeigh) votes for the glued numbered flows of its prefix (below)
    if (!id.includes('_') && GLUED_NAMED.test(id) && !GLUED.test(id)) {
      v.gluedNamed.push(id);
      return;
    }
    // one in a snake_case / Pascal_Snake body (fweigh_parcel_to_label_parcel, also with `_2`) has a `_` and reads like
    // the prefix fweigh: it waits until the glued numbered prefixes are known (below), then votes for one or counts
    // like any other flow
    if (source && target && GLUED_JOINED.test(id)) {
      v.joined.push({ el, id, source, target });
      return;
    }
    this.countFlow(v, el, id, source, target);
  }

  private readElement(el: El, id: string, read: IdsRead, d: DeclaredConventions | undefined): void {
    if (TOOL_DEFAULTS.has(id)) return;
    // a process id votes only on the ids of new processes (processStyle), never on anything else
    if (el.$type === 'bpmn:Process') {
      const m = PREFIXED.exec(id);
      if (m) {
        this.processes.add(m[1]!);
        this.tallyOf(this.processBodies, m[1]!).add(this.bodyClass(m[2]!));
      }
      return;
    }
    if (d) {
      const trigger = triggerOf(el);
      const state = { type: el.$type, ...(trigger ? { trigger } : {}) };
      const heads = d.headsOf(state);
      if (!this.rejected && !IGNORED.some((t) => is(el, t)) && d.rejects(state, id, heads)) this.rejected = true;
      // an id that already starts with a prefix the conventions accept for its element does not vote
      if (heads.some((h) => id.startsWith(h))) return;
    }
    const s = this.sampleOf(el, id);
    if (!s) return;
    read.samples++;
    const m = PREFIXED.exec(id);
    let fam = this.family.get(s.family);
    if (!fam) this.family.set(s.family, (fam = { kindish: new Tally(), generic: new Tally(), prefixed: 0 }));
    if (!m) {
      // no prefix, and the id spells the name (`checkOrder` for "Check order"): a convention for its kind and
      // family, the whole id is the body. A short id that is no name (`GW`, `Start` for "Started") says nothing.
      if (!s.spellsName) return;
      this.tallyOf(this.byKey, s.key).add('');
      if (s.trigger) this.tallyOf(this.byKeyTrigger, `${s.key}|${s.trigger}`).add('');
      this.tallyOf(this.classByKey, s.key).add('literal');
      fam.generic.add('');
      read.bareBodies.add(this.bodyClass(id));
      if (s.flowNode) this.bareNodes++;
      return;
    }
    read.prefixed++;
    fam.prefixed++;
    if (s.flowNode) this.prefixedNodes++;
    const prefix = m[1]!;
    const body = m[2]!;
    const cls = prefixClass(prefix, s.typeNames, s.trigger, s.family);
    this.tallyOf(this.byKey, s.key).add(prefix);
    if (s.trigger) this.tallyOf(this.byKeyTrigger, `${s.key}|${s.trigger}`).add(prefix);
    this.tallyOf(this.classByKey, s.key).add(cls);
    // `Task_` on a plain task: neither for nor against type-named prefixes
    if (!(GENERIC.has(prefix.toLowerCase()) && s.typeNames.some((n) => n.toLowerCase() === prefix.toLowerCase()))) this.classes.add(cls);
    if (/^[a-z]/.test(prefix)) this.lowerFirst++;
    else this.upperFirst++;
    if (cls !== 'literal') fam.kindish.add(cls === 'triggerKind' ? 'triggerKind' : 'kind');
    else if (!this.isSpecific(prefix, s.typeNames, s.trigger, s.family)) fam.generic.add(prefix);
    if (s.named) (s.flowNode ? read.nodeBodies : read.otherBodies).add(this.bodyClass(body));
  }

  private voteFlows(type: string, v: FlowVotes): void {
    // the glued flows bpmn-cli named by their ends in a file of flow12 ids vote for that form and for the glued prefix
    // they start with (flowCheckToShip: flow; the longest that is followed by an upper-case letter or a digit); with a
    // suffix they count only there, as 0.6 counted them; without one they count anyway and vote where a prefix matches
    const glued = [...v.seps].filter(([p, sep]) => sep === '' && /[a-z]/.test(p)).map(([p]) => p).sort((a, b) => b.length - a.length);
    const gluedTo = (id: string): string | undefined => glued.find((p) => id.startsWith(p) && /^[A-Z0-9]/.test(id.charAt(p.length)));
    const voteNumbered = (p: string | undefined): void => {
      v.forms.add('numbered');
      if (p) {
        this.tallyOf(v.prefixes, 'numbered').add(p);
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
      const p = glued.find((p) => id.startsWith(p) && this.gluedJoinedOf(id, p, ends));
      if (p) voteNumbered(p);
      else this.countFlow(v, el, id, source, target);
    }
    // a type whose flows are all such glued flows has no style of its own (the sequence flows', else the default)
    if (!v.n) return;
    // ties between forms and prefixes never go by document order: forms by FORM_ORDER, a form's prefixes by how many
    // flows use them (`uses`), then alphabetically, as does `any`; a tie between scopes (one prefix and one form) keeps
    // the first one counted, as before
    const form = v.forms.top(MIN_EVIDENCE, (a, b) => FORM_ORDER.indexOf(a) < FORM_ORDER.indexOf(b));
    const prefix = form ? v.prefixes.get(form)!.top(MIN_EVIDENCE, (a, b) => v.uses.get(a) > v.uses.get(b) || (v.uses.get(a) === v.uses.get(b) && a < b)) : undefined;
    const scope = form === 'scopedTo' ? v.scopes.top() : undefined;
    const any = v.any.top(MIN_EVIDENCE, (a, b) => this.alphabetical(a, b));
    let style: FlowStyle;
    if (form && prefix && v.forms.get(form) * 2 >= v.n && (form !== 'scopedTo' || scope)) {
      const sep = v.seps.get(prefix);
      // hashed and numbered flows lend new flows their prefix (and a numbered prefix's separator: flow12 -> flowAToB)
      const named = form === 'hash' || form === 'numbered';
      style = { form: named ? 'named' : form, prefix, ...(form === 'numbered' && sep !== undefined ? { sep } : {}), ...(scope ? { scope } : {}) };
      if (form === 'scopedTo') this.scopes.set(type, [...v.scopes.counts.keys()].sort((a, b) => v.scopes.get(b) - v.scopes.get(a)));
      this.flowVoted.add(type);
    } else {
      style = { form: 'named', prefix: any ?? 'Flow' };
      if (any !== undefined) this.flowVoted.add(type);
    }
    this.flows.set(type, style);
    this.flowStyles.set(type, this.otherStyles(v, style));
  }

  /** The votes of a flow that is none of bpmn-cli's glued flows: its prefix, and the forms it matches given its ends. */
  private countFlow(v: FlowVotes, el: El, id: string, source: string | undefined, target: string | undefined): void {
    const p = PREFIXED.exec(id)?.[1];
    if (p) v.any.add(p);
    const own = p ?? GLUED.exec(id)?.[1];
    if (own) v.uses.add(own);
    if (!source || !target) return;
    const seen = this.flowForms(id, source, target);
    // a flow the length cap cut votes for its form too (else enough of them would flip the file's form), also a
    // scopedTo flow 0.6 cut to an empty target word (Flow_KotO_WarenwirtschaftssystemabgleichTo)
    if (p) {
      let req: IdRequest | undefined;
      const request = (): IdRequest => (req ??= connectionRequest(el.$type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source, target, { sourceLabel: new ElementLabels(el.get<El>('sourceRef')).label(), targetLabel: new ElementLabels(el.get<El>('targetRef')).label() }));
      for (const form of ID_FORMS) if (!seen.some((f) => f.form === form) && this.cutOfForm(id, form, p, request)) seen.push({ form, prefix: p });
      const scope = seen.some((f) => f.form === 'scopedTo') ? undefined : this.legacyScopedCut(id, p, source, target);
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
  }

  /** The flow forms an id matches, given its ends (none: only its prefix counts). */
  private flowForms(id: string, source: string, target: string): SeenFlow[] {
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

  /** The class of an id body (the part after the prefix); a collision suffix `_2` is ignored. */
  private bodyClass(body: string): BodyClass {
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
  private isSpecific(prefix: string, typeNames: string[], trigger: string | undefined, family: string): boolean {
    const p = prefix.toLowerCase();
    if (p === family.toLowerCase() || GENERIC.has(p)) return false;
    return typeNames.some((n) => n.toLowerCase().startsWith(p)) || (!!trigger && trigger.toLowerCase().startsWith(p));
  }

  /** Alphabetical order (code units, the same everywhere): the last tie-break of the flow votes. */
  private alphabetical(a: string, b: string): boolean {
    return a < b;
  }

  private tallyOf<K>(map: Map<string, Tally<K>>, key: string): Tally<K> {
    let t = map.get(key);
    if (!t) map.set(key, (t = new Tally<K>()));
    return t;
  }

  /** A name or id as lower-case letters and digits only (`Check order` and `checkOrder` -> `checkorder`). */
  private folded(text: string): string {
    return nameWords(text).join('').toLowerCase();
  }

  private sampleOf(el: El, id: string): Sample | undefined {
    if (IGNORED.some((t) => is(el, t))) return undefined;
    const name = el.get<string | undefined>('name');
    const named = !!name && nameWords(name).length > 0;
    const spellsName = named && this.folded(id) === this.folded(name!);
    const def = kindOf(el);
    if (def) {
      const trigger = triggerOf(el);
      return { key: def.kind, family: def.prefix, typeNames: kindTypeNames(def), ...(trigger && trigger !== 'none' ? { trigger } : {}), id, named, spellsName, flowNode: FLOW_NODE_FAMILIES.has(def.family) };
    }
    const local = localName(el.$type);
    return { key: el.$type, family: local, typeNames: [lcfirst(local)], id, named, spellsName, flowNode: false };
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
  private gluedJoinedOf(id: string, prefix: string, ends: { source: () => string; target: () => string }): boolean {
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
   * The styles a type's flows show besides `style` (LearnedStyle.flowStyles):
   * `named` under every prefix (with `_`, and glued after a numbered prefix
   * without separator), each form built from the ends under the prefixes that
   * voted for it, scopedTo with each scope. One per head.
   */
  private otherStyles(v: FlowVotes, style: FlowStyle): FlowStyle[] {
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

  /**
   * Whether a flow id is a cut of a form built from its ends' ids with the
   * prefix `prefix`: one of the bases derivedBases lists for the form (cut to
   * leave room for a suffix of up to 4 characters, or as 0.6 cut it, also
   * again for `_100`), with or without a suffix, so that a flow the length
   * cap cut still votes for its form (countFlow). Only for an id the form's
   * uncut base would not give (flowForms has those).
   */
  private cutOfForm(id: string, form: IdForm, prefix: string, request: () => IdRequest): boolean {
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
   * enough of them do not flip a 0.6 file's form (countFlow). Undefined for any
   * other id.
   */
  private legacyScopedCut(id: string, prefix: string, source: string, target: string): string | undefined {
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
}
