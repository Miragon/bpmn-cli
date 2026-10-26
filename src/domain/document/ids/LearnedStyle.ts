import { kindOf, triggerOf } from '../utils/kinds.js';
import { is, isBpmnElement, walk, type El } from '../utils/moddle.js';
import { cutAt, isSuffix, MAX_ID, nameWords, pascalSnakeSlug, snakeSlug, SUFFIX_WORD } from '../utils/slug.js';
import { beginAlike, caseLike, GENERIC, GLUED, HASH, lcfirst, localName, PREFIXED, prefixClass, stem, TOOL_DEFAULTS, ucfirst, type PrefixClass } from '../utils/id-words.js';
import { CONNECTIONS, connectionRequest, kindTypeNames, type IdRequest } from '../utils/requests.js';
import { ElementLabels } from './ElementLabels.js';
import { ID_FORMS, IdFitter, LEGACY_BASE, FORM_JOIN, type IdForm } from './IdFitter.js';
import { MIN_EVIDENCE, Tally } from './Tally.js';
import type { DeclaredConventions, Votes } from './DeclaredConventions.js';
import type { Body, FlowForm, FlowStyle, PrefixSource } from './IdStyle.js';

export const DEFAULT_FLOW: FlowStyle = { form: 'named', prefix: 'Flow' };

const NO_VOTES: Votes = { kind: 0, literal: 0, lower: 0, upper: 0 };

/** Flow_KotO_ValidateToReserve */
const SCOPED_TO = /^([A-Za-z][A-Za-z0-9]*)_([A-Z][A-Za-z0-9]*?)To([A-Z][A-Za-z0-9]*)$/;
/** `flowCheckOrderToShip_2` in a file of flow12 ids: not a prefix and a number. */
const GLUED_SUFFIXED = /^[A-Za-z][A-Za-z0-9]*To[A-Z0-9][A-Za-z0-9]*_\d+$/;
/** `flowCheckOrderToShip`, `fPackToWeigh`; a cut one may end on `To`. */
const GLUED_NAMED = /^[A-Za-z][A-Za-z0-9]*To(?![a-z])[A-Za-z0-9]*$/;
/** May be a glued flow in a snake_case / Pascal_Snake body (`fweigh_parcel_to_label_parcel`). */
const GLUED_JOINED = /^[a-z]\w*_[tT]o_\w*$/;
/** A scopedTo flow 0.6 cut to an empty target word (Flow_KotO_WarenwirtschaftssystemabgleichTo). */
const SCOPED_CUT = /^([A-Za-z][A-Za-z0-9]*)_([A-Z][A-Za-z0-9]*?)To\d*$/;

type BodyClass = Body | 'hash' | 'numbered' | 'lower' | 'other';

type SeenForm = FlowForm | 'hash' | 'numbered';
interface SeenFlow {
  form: SeenForm;
  prefix: string;
  sep?: string;
  scope?: string;
}

/** Tie order: a file of half speaking flows gets speaking ones. */
const FORM_ORDER: SeenForm[] = ['scopedTo', 'stemTo', 'idPair', 'stemSnake', 'idSnake', 'named', 'numbered', 'hash'];

interface FamilyStats {
  kindish: Tally<string>;
  generic: Tally<string>;
  prefixed: number;
}

interface FlowVotes {
  /** all but the glued ones with a suffix, which count only for glued numbered flows */
  count: number;
  glued: string[];
  gluedNamed: string[];
  /** decided once the glued prefixes are known */
  joined: Array<{ el: El; id: string; source: string; target: string }>;
  forms: Tally<SeenForm>;
  prefixes: Map<SeenForm, Tally<string>>;
  any: Tally<string>;
  /** breaks a tie between a form's prefixes */
  uses: Tally<string>;
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
  spellsName: boolean;
  flowNode: boolean;
}

const FLOW_NODE_FAMILIES = new Set(['task', 'subProcess', 'callActivity', 'gateway', 'event']);

/** Ids nobody chooses say nothing about the conventions. */
const IGNORED = ['bpmn:Definitions', 'bpmn:Process', 'bpmn:EventDefinition', 'bpmn:Expression', 'bpmn:ExtensionElements', 'bpmn:Documentation', 'bpmn:LoopCharacteristics', 'bpmn:InputOutputSpecification', 'bpmn:InputSet', 'bpmn:OutputSet'];

/**
 * The id conventions a document's ids show, learned by votes. With declared conventions the ids
 * that already follow them do not vote.
 */
export class LearnedStyle {
  private readonly byKey = new Map<string, Tally<string>>();
  private readonly byKeyTrigger = new Map<string, Tally<string>>();
  private readonly classByKey = new Map<string, Tally<PrefixClass>>();
  private readonly family = new Map<string, FamilyStats>();
  private readonly classes = new Tally<PrefixClass>();
  private lowerFirst = 0;
  private upperFirst = 0;
  readonly body: Body;
  readonly bodyVoted: boolean;
  private readonly flows = new Map<string, FlowStyle>();
  private readonly flowVoted = new Set<string>();
  /** one id is evidence for its kind and family (MIN_EVIDENCE) */
  private readonly strong: boolean;
  private readonly scopes = new Map<string, string[]>();
  /** the styles besides the one new flows take, so flows named in them are still recognised */
  private readonly flowStyles = new Map<string, FlowStyle[]>();
  private bareNodes = 0;
  private prefixedNodes = 0;
  readonly bareBody: 'pascal' | 'camel';
  /** process ids vote on nothing but new process ids */
  private readonly processes = new Tally<string>();
  private readonly processBodies = new Map<string, Tally<BodyClass>>();
  private rejected = false;

  constructor(defs: El | undefined, declared?: DeclaredConventions) {
    const read: IdsRead = { samples: 0, prefixed: 0, nodeBodies: new Tally(), bareBodies: new Tally(), otherBodies: new Tally(), flowVotes: new Map() };
    for (const el of defs ? walk(defs, { bpmnOnly: true }) : []) {
      if (!isBpmnElement(el) || /^(bpmndi|dc|di):/.test(el.$type)) continue;
      const id = el.get<string | undefined>('id');
      if (!id) continue;
      if (CONNECTIONS.has(el.$type)) this.readFlow(el, id, read.flowVotes, declared);
      else this.readElement(el, id, read, declared);
    }

    this.strong = read.prefixed >= 3 && read.prefixed * 2 >= read.samples;

    /**
     * The named flow nodes decide the case (pools, lanes, messages often keep tool ids);
     * a single lower-case word fits camel and snake alike.
     */
    const { bareBodies, nodeBodies, otherBodies } = read;
    this.bareBody = bareBodies.get('pascal') > bareBodies.get('camel') + bareBodies.get('lower') ? 'pascal' : 'camel';
    const bodies = nodeBodies.total >= MIN_EVIDENCE ? nodeBodies : otherBodies;
    if (bodies === otherBodies) for (const [key, count] of nodeBodies.counts) bodies.add(key, count);
    const camel = bodies.get('camel');
    const snake = bodies.get('snake');
    const lowerOnly = camel + snake === 0;
    const lower = declared && lowerOnly && declared.case !== 'pascal' ? 0 : bodies.get('lower');
    const lowerCamel = (camel > 0 && camel >= snake) || (lowerOnly && declared?.case === 'pascal');
    const votes: Array<[Body, number]> = [
      ['pascal', bodies.get('pascal')],
      ['camel', camel + (lowerCamel ? lower : 0)],
      ['snake', snake + (lowerCamel ? 0 : lower)],
      ['pascalSnake', bodies.get('pascalSnake')],
    ];
    let best: [Body, number] = ['pascal', MIN_EVIDENCE - 1];
    for (const vote of votes) if (vote[1] > best[1]) best = vote;
    this.body = best[0];
    this.bodyVoted = best[1] >= MIN_EVIDENCE;

    for (const [type, votes] of read.flowVotes) this.voteFlows(type, votes);
  }

  /** The file has an id the declared conventions check that does not follow them. */
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
   * The prefix at least two process ids share and the case their bodies show, else the file's
   * case, so the process matches the pool made with it. Participant ids never vote.
   */
  processStyle(fileCase: () => Body): { prefix: string; body: Body } | undefined {
    const prefix = this.processes.top(MIN_EVIDENCE, (first, second) => this.alphabetical(first, second));
    if (prefix === undefined) return undefined;
    const caseTally = this.processBodies.get(prefix)!;
    const file = fileCase();
    let best: [Body, number] = [file, 0];
    for (const bodyCase of ['pascal', 'camel', 'snake', 'pascalSnake'] as const) if (caseTally.get(bodyCase) > best[1] || (caseTally.get(bodyCase) === best[1] && best[1] > 0 && bodyCase === file)) best = [bodyCase, caseTally.get(bodyCase)];
    const body = best[1] || !caseTally.get('lower') ? best[0] : file === 'snake' || file === 'pascalSnake' ? 'snake' : 'camel';
    return { prefix, body };
  }

  /**
   * '' only with `bare`: a named element's id can do without a prefix, an unnamed one cannot.
   * The declared prefixes shape a prefix nothing declares where the file shows none.
   */
  prefixOf(req: IdRequest, bare: boolean, declared: DeclaredConventions | undefined): { prefix: string; source: PrefixSource } {
    // a new file looks like one that follows the declared conventions
    const dv = declared && this.lowerFirst + this.upperFirst < MIN_EVIDENCE ? declared.votes : NO_VOTES;
    const lowerFile = this.lowerFirst + dv.lower >= MIN_EVIDENCE && this.lowerFirst + dv.lower > this.upperFirst + dv.upper;
    const min = this.strong ? 1 : MIN_EVIDENCE;
    const typeName = req.typeNames[0]!;
    const withTrigger = (lowerFirst: boolean): string => caseLike(req.trigger ? `${req.trigger}${ucfirst(typeName)}` : typeName, lowerFirst);
    const usable = (prefix: string | undefined): prefix is string => prefix !== undefined && (bare || prefix !== '');
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
    if (bare && !fam?.prefixed && this.bareNodes >= MIN_EVIDENCE && this.bareNodes > this.prefixedNodes) return file('');
    const kindish = this.classes.get('kind') + this.classes.get('triggerKind') + dv.kind;
    const source: PrefixSource = dv.kind + dv.literal > 0 ? 'lint shape' : this.classes.total + this.lowerFirst + this.upperFirst > 0 ? 'file' : 'default';
    if (kindish >= MIN_EVIDENCE && kindish > this.classes.get('literal') + dv.literal) return { prefix: caseLike(typeName, lowerFile), source };
    return { prefix: caseLike(req.prefix, lowerFile), source };
  }

  /**
   * The other ids show the other first letter than the declared prefixes (Lane_ next to
   * serviceTask_): the declared case goes with the declared shape, so the file keeps bpmn-cli's.
   */
  otherShape(declared: DeclaredConventions): boolean {
    if (this.lowerFirst + this.upperFirst < MIN_EVIDENCE) return false;
    const votes = declared.votes;
    return this.lowerFirst > this.upperFirst ? votes.upper > votes.lower : this.upperFirst > this.lowerFirst && votes.lower > votes.upper;
  }

  private readFlow(el: El, id: string, flowVotes: Map<string, FlowVotes>, declared: DeclaredConventions | undefined): void {
    if (declared && !this.rejected && declared.rejects({ type: el.$type }, id)) this.rejected = true;
    const source = el.get<El | undefined>('sourceRef')?.get<string | undefined>('id');
    const target = el.get<El | undefined>('targetRef')?.get<string | undefined>('id');
    // bpmn-cli wrote a borrowed prefix from the declared conventions: a vote would end borrowing
    const borrowed = declared && el.$type === 'bpmn:MessageFlow' ? declared.borrowedHead(el.$type) : undefined;
    if (borrowed !== undefined && id.startsWith(borrowed)) return;
    let votes = flowVotes.get(el.$type);
    if (!votes) flowVotes.set(el.$type, (votes = { count: 0, glued: [], gluedNamed: [], joined: [], forms: new Tally(), prefixes: new Map(), any: new Tally(), uses: new Tally(), seps: new Map(), scopes: new Tally() }));
    if (GLUED_SUFFIXED.test(id)) {
      votes.glued.push(id);
      return;
    }
    votes.count++;
    if (!id.includes('_') && GLUED_NAMED.test(id) && !GLUED.test(id)) {
      votes.gluedNamed.push(id);
      return;
    }
    // fweigh_parcel_to_label_parcel reads like the prefix fweigh until the glued prefixes are known
    if (source && target && GLUED_JOINED.test(id)) {
      votes.joined.push({ el, id, source, target });
      return;
    }
    this.countFlow(votes, el, id, source, target);
  }

  private readElement(el: El, id: string, read: IdsRead, declared: DeclaredConventions | undefined): void {
    if (TOOL_DEFAULTS.has(id)) return;
    if (el.$type === 'bpmn:Process') {
      const processMatch = PREFIXED.exec(id);
      if (processMatch) {
        this.processes.add(processMatch[1]!);
        this.tallyOf(this.processBodies, processMatch[1]!).add(this.bodyClass(processMatch[2]!));
      }
      return;
    }
    if (declared) {
      const trigger = triggerOf(el);
      const state = { type: el.$type, ...(trigger ? { trigger } : {}) };
      const heads = declared.headsOf(state);
      if (!this.rejected && !IGNORED.some((type) => is(el, type)) && declared.rejects(state, id, heads)) this.rejected = true;
      if (heads.some((head) => id.startsWith(head))) return;
    }
    const sample = this.sampleOf(el, id);
    if (!sample) return;
    read.samples++;
    const prefixedMatch = PREFIXED.exec(id);
    let fam = this.family.get(sample.family);
    if (!fam) this.family.set(sample.family, (fam = { kindish: new Tally(), generic: new Tally(), prefixed: 0 }));
    if (!prefixedMatch) {
      // a bare id counts only where it spells the name: `GW` or `Start` for "Started" say nothing
      if (!sample.spellsName) return;
      this.tallyOf(this.byKey, sample.key).add('');
      if (sample.trigger) this.tallyOf(this.byKeyTrigger, `${sample.key}|${sample.trigger}`).add('');
      this.tallyOf(this.classByKey, sample.key).add('literal');
      fam.generic.add('');
      read.bareBodies.add(this.bodyClass(id));
      if (sample.flowNode) this.bareNodes++;
      return;
    }
    read.prefixed++;
    fam.prefixed++;
    if (sample.flowNode) this.prefixedNodes++;
    const prefix = prefixedMatch[1]!;
    const body = prefixedMatch[2]!;
    const cls = prefixClass(prefix, sample.typeNames, sample.trigger, sample.family);
    this.tallyOf(this.byKey, sample.key).add(prefix);
    if (sample.trigger) this.tallyOf(this.byKeyTrigger, `${sample.key}|${sample.trigger}`).add(prefix);
    this.tallyOf(this.classByKey, sample.key).add(cls);
    // `Task_` on a plain task: neither for nor against type-named prefixes
    if (!(GENERIC.has(prefix.toLowerCase()) && sample.typeNames.some((typeName) => typeName.toLowerCase() === prefix.toLowerCase()))) this.classes.add(cls);
    if (/^[a-z]/.test(prefix)) this.lowerFirst++;
    else this.upperFirst++;
    if (cls !== 'literal') fam.kindish.add(cls === 'triggerKind' ? 'triggerKind' : 'kind');
    else if (!this.isSpecific(prefix, sample.typeNames, sample.trigger, sample.family)) fam.generic.add(prefix);
    if (sample.named) (sample.flowNode ? read.nodeBodies : read.otherBodies).add(this.bodyClass(body));
  }

  private voteFlows(type: string, votes: FlowVotes): void {
    // glued flows in a file of flow12 ids vote for the longest glued prefix they start with
    const glued = [...votes.seps].filter(([prefix, sep]) => sep === '' && /[a-z]/.test(prefix)).map(([prefix]) => prefix).sort((first, second) => second.length - first.length);
    const gluedTo = (id: string): string | undefined => glued.find((prefix) => id.startsWith(prefix) && /^[A-Z0-9]/.test(id.charAt(prefix.length)));
    const voteNumbered = (prefix: string | undefined): void => {
      votes.forms.add('numbered');
      if (prefix) {
        this.tallyOf(votes.prefixes, 'numbered').add(prefix);
        votes.uses.add(prefix);
      }
    };
    if (votes.glued.length && [...votes.seps.values()].includes('')) {
      votes.count += votes.glued.length;
      for (const id of votes.glued) voteNumbered(gluedTo(id));
    }
    for (const id of votes.gluedNamed) {
      const gluedPrefix = gluedTo(id);
      if (gluedPrefix) voteNumbered(gluedPrefix);
    }
    for (const { el, id, source, target } of votes.joined) {
      let sourceLabel: string | undefined;
      let targetLabel: string | undefined;
      const ends = { source: (): string => (sourceLabel ??= new ElementLabels(el.get<El>('sourceRef')).label()), target: (): string => (targetLabel ??= new ElementLabels(el.get<El>('targetRef')).label()) };
      const gluedPrefix = glued.find((candidate) => id.startsWith(candidate) && this.gluedJoinedOf(id, candidate, ends));
      if (gluedPrefix) voteNumbered(gluedPrefix);
      else this.countFlow(votes, el, id, source, target);
    }
    if (!votes.count) return;
    // ties never go by document order, except between scopes, which keep the first one counted
    const form = votes.forms.top(MIN_EVIDENCE, (first, second) => FORM_ORDER.indexOf(first) < FORM_ORDER.indexOf(second));
    const prefix = form ? votes.prefixes.get(form)!.top(MIN_EVIDENCE, (first, second) => votes.uses.get(first) > votes.uses.get(second) || (votes.uses.get(first) === votes.uses.get(second) && first < second)) : undefined;
    const scope = form === 'scopedTo' ? votes.scopes.top() : undefined;
    const any = votes.any.top(MIN_EVIDENCE, (first, second) => this.alphabetical(first, second));
    let style: FlowStyle;
    if (form && prefix && votes.forms.get(form) * 2 >= votes.count && (form !== 'scopedTo' || scope)) {
      const sep = votes.seps.get(prefix);
      // hashed and numbered flows lend new flows their prefix and separator (flow12 -> flowAToB)
      const named = form === 'hash' || form === 'numbered';
      style = { form: named ? 'named' : form, prefix, ...(form === 'numbered' && sep !== undefined ? { sep } : {}), ...(scope ? { scope } : {}) };
      if (form === 'scopedTo') this.scopes.set(type, [...votes.scopes.counts.keys()].sort((first, second) => votes.scopes.get(second) - votes.scopes.get(first)));
      this.flowVoted.add(type);
    } else {
      style = { form: 'named', prefix: any ?? 'Flow' };
      if (any !== undefined) this.flowVoted.add(type);
    }
    this.flows.set(type, style);
    this.flowStyles.set(type, this.otherStyles(votes, style));
  }

  private countFlow(votes: FlowVotes, el: El, id: string, source: string | undefined, target: string | undefined): void {
    const prefix = PREFIXED.exec(id)?.[1];
    if (prefix) votes.any.add(prefix);
    const own = prefix ?? GLUED.exec(id)?.[1];
    if (own) votes.uses.add(own);
    if (!source || !target) return;
    const seen = this.flowForms(id, source, target);
    // a flow the length cap cut votes for its form too, else enough of them flip the file's form
    if (prefix) {
      let req: IdRequest | undefined;
      const request = (): IdRequest => (req ??= connectionRequest(el.$type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source, target, { sourceLabel: new ElementLabels(el.get<El>('sourceRef')).label(), targetLabel: new ElementLabels(el.get<El>('targetRef')).label() }));
      for (const form of ID_FORMS) if (!seen.some((seenForm) => seenForm.form === form) && this.cutOfForm(id, form, prefix, request)) seen.push({ form, prefix });
      const scope = seen.some((seenForm) => seenForm.form === 'scopedTo') ? undefined : this.legacyScopedCut(id, prefix, source, target);
      if (scope) seen.push({ form: 'scopedTo', prefix, scope });
    }
    for (const seenForm of seen) {
      votes.forms.add(seenForm.form);
      let tally = votes.prefixes.get(seenForm.form);
      if (!tally) votes.prefixes.set(seenForm.form, (tally = new Tally()));
      tally.add(seenForm.prefix);
      if (seenForm.sep !== undefined && !votes.seps.has(seenForm.prefix)) votes.seps.set(seenForm.prefix, seenForm.sep);
      if (seenForm.scope) votes.scopes.add(seenForm.scope);
    }
  }

  private flowForms(id: string, source: string, target: string): SeenFlow[] {
    const match = PREFIXED.exec(id);
    if (!match) {
      const gluedMatch = GLUED.exec(id);
      return gluedMatch ? [{ form: 'numbered', prefix: gluedMatch[1]!, sep: '' }] : [];
    }
    const prefix = match[1]!;
    const rest = match[2]!;
    if (HASH.test(rest)) return [{ form: 'hash', prefix }];
    if (/^\d+$/.test(rest)) return [{ form: 'numbered', prefix }];
    const out: SeenFlow[] = [];
    const scoped = SCOPED_TO.exec(rest);
    if (scoped) out.push({ form: 'scopedTo', prefix, scope: scoped[1]! });
    const fits = (candidate: string, sep: string): boolean => rest === candidate || (rest.startsWith(candidate) && isSuffix(candidate, rest.slice(candidate.length), sep));
    if (fits(`${lcfirst(stem(source))}To${ucfirst(stem(target))}`, '')) out.push({ form: 'stemTo', prefix });
    if (fits(`${source}_${target}`, '_')) out.push({ form: 'idPair', prefix });
    if (fits(`${stem(source)}_to_${stem(target)}`, '_')) out.push({ form: 'stemSnake', prefix });
    if (fits(`${source}_to_${target}`, '_')) out.push({ form: 'idSnake', prefix });
    return out;
  }

  private bodyClass(body: string): BodyClass {
    if (HASH.test(body)) return 'hash';
    if (/^\d+$/.test(body)) return 'numbered';
    const bareBody = body.replace(/_\d+$/, '');
    if (/^[A-Z][A-Za-z0-9]*$/.test(bareBody)) return 'pascal';
    if (/^[a-z][a-z0-9]*$/.test(bareBody)) return 'lower';
    if (/^[a-z][A-Za-z0-9]*$/.test(bareBody)) return 'camel';
    if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(bareBody)) return 'snake';
    if (/^[A-Z][A-Za-z0-9]*(_[A-Za-z0-9]+)+$/.test(bareBody)) return 'pascalSnake';
    return 'other';
  }

  /** A literal prefix that abbreviates its own kind (End, Sub) says nothing about other kinds. */
  private isSpecific(prefix: string, typeNames: string[], trigger: string | undefined, family: string): boolean {
    const lowerPrefix = prefix.toLowerCase();
    if (lowerPrefix === family.toLowerCase() || GENERIC.has(lowerPrefix)) return false;
    return typeNames.some((typeName) => typeName.toLowerCase().startsWith(lowerPrefix)) || (!!trigger && trigger.toLowerCase().startsWith(lowerPrefix));
  }

  private alphabetical(first: string, second: string): boolean {
    return first < second;
  }

  private tallyOf<TKey>(map: Map<string, Tally<TKey>>, key: string): Tally<TKey> {
    let tally = map.get(key);
    if (!tally) map.set(key, (tally = new Tally<TKey>()));
    return tally;
  }

  private folded(text: string): string {
    return nameWords(text).join('').toLowerCase();
  }

  private sampleOf(el: El, id: string): Sample | undefined {
    if (IGNORED.some((type) => is(el, type))) return undefined;
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
   * Whether `id` is a flow bpmn-cli named by its ends after a glued prefix in a snake_case or
   * Pascal_Snake body, uncut, cut, or naming only its source whole (its target changed since).
   */
  private gluedJoinedOf(id: string, prefix: string, ends: { source: () => string; target: () => string }): boolean {
    const fits = (base: string): boolean => id === base || (id.startsWith(base) && isSuffix(base, id.slice(base.length), '_'));
    for (const [join, slug] of [['_to_', snakeSlug], ['_To_', pascalSnakeSlug]] as const) {
      // cheap test first: every cut keeps the source's first letter after the prefix
      if (!id.includes(join) || id.charAt(prefix.length) !== slug(ends.source()).charAt(0)) continue;
      if (id.startsWith(`${prefix}${slug(ends.source())}${join}`)) return true;
      const at = (max: number, legacy = false): string => new IdFitter({ legacy }).pair(prefix, slug(ends.source(), legacy), join, slug(ends.target(), legacy), max);
      const uncut = at(Infinity);
      if (fits(uncut) || (uncut.length > MAX_ID - 4 && [0, 1, 2, 3, 4].some((trim) => fits(at(MAX_ID - trim))))) return true;
      const legacy = at(LEGACY_BASE, true);
      if (fits(legacy) || fits(cutAt(legacy, MAX_ID - 4, true))) return true;
    }
    return false;
  }

  private otherStyles(votes: FlowVotes, style: FlowStyle): FlowStyle[] {
    const out = new Map<string, FlowStyle>();
    const key = (flowStyle: FlowStyle): string => (flowStyle.form === 'named' ? `named|${new IdFitter({ legacy: true }).namedHead(flowStyle.prefix, flowStyle.sep).head}` : `${flowStyle.form}|${flowStyle.prefix}|${flowStyle.scope ?? ''}`);
    const add = (flowStyle: FlowStyle): void => {
      if (!out.has(key(flowStyle))) out.set(key(flowStyle), flowStyle);
    };
    add(style);
    for (const prefix of votes.any.counts.keys()) add({ form: 'named', prefix });
    for (const [prefix, sep] of votes.seps) add({ form: 'named', prefix, sep });
    for (const [form, tally] of votes.prefixes) {
      if (form === 'hash' || form === 'numbered' || form === 'named') continue;
      for (const prefix of tally.counts.keys()) {
        if (form === 'scopedTo') for (const scope of votes.scopes.counts.keys()) add({ form, prefix, scope });
        else add({ form, prefix });
      }
    }
    out.delete(key(style));
    return [...out.values()];
  }

  /** Whether a flow id is a cut of a form built from its ends, so that it still votes for it. */
  private cutOfForm(id: string, form: IdForm, prefix: string, request: () => IdRequest): boolean {
    const rest = id.slice(prefix.length + 1);
    const join = FORM_JOIN[form];
    // cheap tests first: a cut keeps the join, and a stemTo source begins in lower case
    if (id.length > MAX_ID || !rest.includes(join) || (form === 'stemTo' && /^[A-Z]/.test(rest) && !rest.startsWith(join))) return false;
    const req = request();
    if (form === 'stemTo' || form === 'stemSnake') {
      const { sourceEnd, targetEnd } = new IdFitter().stemEnds(form, req);
      if (!beginAlike(sourceEnd, targetEnd) && rest.charAt(0) !== sourceEnd.charAt(0) && !rest.startsWith(join)) return false;
    }
    const fitter = new IdFitter();
    if (fitter.idForm(form, `${prefix}_`, req, Infinity).length <= MAX_ID - 4) return false;
    const sep = form === 'stemTo' ? '' : '_';
    const suffixed = (base: string): boolean => id.startsWith(base) && isSuffix(base, id.slice(base.length), sep);
    const legacy = new IdFitter({ legacy: true }).idForm(form, `${prefix}_`, req, LEGACY_BASE);
    if (id === legacy || suffixed(legacy) || suffixed(cutAt(legacy, MAX_ID - 4, true))) return true;
    if (id === fitter.idForm(form, `${prefix}_`, req, MAX_ID)) return true;
    // a suffix of up to 4 characters cut the base; a glued one may be any of the last digits
    const digits = (sep === '' ? /\d+$/ : /_\d+$/).exec(id)?.[0] ?? '';
    const ks: number[] = [];
    for (let digitCount = sep === '' ? 1 : digits.length; digitCount <= Math.min(digits.length, 4); digitCount++) ks.push(digitCount);
    if (sep === '' && digits.length <= 4 && id.endsWith(`${SUFFIX_WORD}${digits}`)) ks.push(SUFFIX_WORD.length + digits.length);
    for (const digitCount of ks) {
      const suffix = id.slice(id.length - digitCount);
      if (/^_?0/.test(suffix.slice(suffix.startsWith(SUFFIX_WORD) ? SUFFIX_WORD.length : 0))) continue;
      if (id.slice(0, -digitCount) === fitter.idForm(form, `${prefix}_`, req, MAX_ID - digitCount)) return true;
    }
    return false;
  }

  /** SCOPED_TO does not read a flow 0.6 cut to an empty target word, so this does. */
  private legacyScopedCut(id: string, prefix: string, source: string, target: string): string | undefined {
    const match = SCOPED_CUT.exec(id.slice(prefix.length + 1));
    if (!match) return undefined;
    const scope = match[1]!;
    const fitter = new IdFitter({ legacy: true });
    const sourceWord = fitter.endWord(source, scope, 'Start');
    if (!match[2]!.startsWith(sourceWord)) return undefined;
    const legacy = cutAt(`${prefix}_${scope}_${sourceWord}To${fitter.endWord(target, scope, 'End')}`, LEGACY_BASE, true);
    const suffixed = (base: string): boolean => id.startsWith(base) && isSuffix(base, id.slice(base.length), '');
    return id === legacy || suffixed(legacy) || suffixed(cutAt(legacy, MAX_ID - 4, true)) ? scope : undefined;
  }
}
