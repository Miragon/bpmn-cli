/**
 * Edits follow the file: the id conventions of a document, so that new ids
 * look like the ones it already has.
 *
 * CONTRACT
 *  IdStyle.infer(defs) reads the ids of the BPMN elements of a document
 *  (never DI or vendor ids) and learns, by majority:
 *   - the PREFIX per kind: the prefix the file uses for that kind (and
 *     trigger), else what its family uses (`Task_` for every task when the
 *     tasks share it), else the type name when the file names prefixes after
 *     the type (`serviceTask_`, `EndEvent_`; `Task_` on a plain task counts
 *     as a family prefix), else the bpmn-cli prefix (Activity, Event,
 *     Gateway, ...) in the file's prefix case (`event_`);
 *   - the BODY of named elements (voted by the named flow nodes; by every
 *     named element when they show none): `pascal` (Activity_CheckInvoice, the
 *     default), `camel` (serviceTask_checkInvoice), `snake`
 *     (Task_check_invoice), `pascalSnake` (Task_Check_Invoice), `hash`
 *     (Camunda Modeler ids, Activity_0k3x9qa) or `numbered` (Task_12);
 *   - the body of UNNAMED elements: `numbered` when the file numbers them
 *     (Gateway_3; at least two such ids and more than hashed ones), else
 *     `hash`;
 *   - the FORM of sequence flows and of message flows (a type without flows
 *     follows the sequence flows): `hash` (Flow_0k3x9qa, SequenceFlow_1abc2de),
 *     `numbered` (Flow_12, SF_3), `stemTo` (flow_checkStockToShipGoods: the
 *     ends' ids without prefix), `idPair` (Flow_Task_A_Task_B), `stemSnake`
 *     (Flow_check_stock_to_ship_goods) or `idSnake` (Flow_Task_A_to_Task_B),
 *     with the prefix those flows use. A form needs at least half of the
 *     flows of its type; otherwise flows are hashed with the file's most
 *     common flow prefix.
 *  A document without ids to learn from gets the default style: pascal
 *  bodies, the bpmn-cli prefixes, hashed unnamed elements and flows.
 *
 *  style.next(req, registry) returns a free id for a request (kindRequest /
 *  typeRequest / connectionRequest) and whether it was derived from the
 *  name. Name-derived ids get `_2`, `_3` on a collision (W_ID_SUFFIXED);
 *  hashed ids hash the request's stable inputs (kind, name, seed = the
 *  placement or owner, the ends of a connection) and re-hash with a salt on a
 *  collision, so the same edit always gives the same id and independent
 *  edits on two branches of a file do not collide; numbered ids take the
 *  highest number of their prefix + 1. The same request on the same
 *  document always gives the same id.
 *  style.derivedBase(req) is the name-derived id before collision handling
 *  (undefined for hashed and numbered styles); style.joinId(gatewayId) the
 *  id of a split's join gateway in a name-derived style.
 */
import { camelSlug, hash7, nameWords, pascalSnakeSlug, slugify, snakeSlug, type IdRegistry } from './ids.js';
import { kindOf, triggerOf, type KindDef } from './kinds.js';
import { is, isBpmnElement, walk, type El } from './model.js';

export type Body = 'pascal' | 'camel' | 'snake' | 'pascalSnake' | 'hash' | 'numbered';
export type FlowForm = 'hash' | 'numbered' | 'stemTo' | 'idPair' | 'stemSnake' | 'idSnake';

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
  /** stable inputs that tell this element apart from others of its kind (placement, owner); hashed for hash-style ids */
  seed?: string;
  /** connections (sequence / message flows): the ids of the ends */
  source?: string;
  target?: string;
}

export interface IdStyleInfo {
  body: Body;
  unnamed: 'hash' | 'numbered';
  sequenceFlow: { form: FlowForm; prefix: string };
  messageFlow: { form: FlowForm; prefix: string };
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
export function kindRequest(def: KindDef, opts: { trigger?: string; name?: string; seed?: string } = {}): IdRequest {
  return { key: def.kind, prefix: def.prefix, typeNames: kindTypeNames(def), ...opts };
}

/** The request for an element of another BPMN type (bpmn:Message, bpmn:LaneSet, bpmn:Association, ...). */
export function typeRequest(type: string, opts: { name?: string; seed?: string; prefix?: string } = {}): IdRequest {
  const { prefix, ...rest } = opts;
  return { key: type, prefix: prefix ?? localName(type), typeNames: [lcfirst(localName(type))], ...rest };
}

/** The request for a sequence flow or message flow from `source` to `target`. */
export function connectionRequest(type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source: string, target: string, name?: string): IdRequest {
  return { key: type, prefix: 'Flow', typeNames: [lcfirst(localName(type))], source, target, ...(name ? { name } : {}) };
}

const CONNECTIONS = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);

/* ------------------------------------------------------------------ */
/* classification                                                       */
/* ------------------------------------------------------------------ */

const PREFIXED = /^([A-Za-z][A-Za-z0-9]*)_(.+)$/;

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

type BodyClass = Body | 'lower' | 'other';

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

/** The flow forms an id matches, given its ends (none: only its prefix counts). */
function flowForms(id: string, source: string, target: string): Array<{ form: FlowForm; prefix: string }> {
  const m = PREFIXED.exec(id);
  if (!m) return [];
  const prefix = m[1]!;
  const rest = m[2]!;
  if (HASH.test(rest)) return [{ form: 'hash', prefix }];
  if (/^\d+$/.test(rest)) return [{ form: 'numbered', prefix }];
  const out: Array<{ form: FlowForm; prefix: string }> = [];
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
  unnamed: 'hash' | 'numbered';
  flows: Map<string, { form: FlowForm; prefix: string }>;
  /** the file's ids are mostly prefixed (see MIN_EVIDENCE): one id is evidence for its kind and family */
  strong: boolean;
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
  /** a flow node (task, event, gateway, sub-process, call activity) */
  flowNode: boolean;
}

const FLOW_NODE_FAMILIES = new Set(['task', 'subProcess', 'callActivity', 'gateway', 'event']);

/** BPMN elements whose ids say nothing about the conventions (tool defaults, ids nobody chooses). */
const IGNORED = ['bpmn:Definitions', 'bpmn:Process', 'bpmn:EventDefinition', 'bpmn:Expression', 'bpmn:ExtensionElements', 'bpmn:Documentation', 'bpmn:LoopCharacteristics', 'bpmn:InputOutputSpecification', 'bpmn:InputSet', 'bpmn:OutputSet'];

function sampleOf(el: El, id: string): Sample | undefined {
  if (IGNORED.some((t) => is(el, t))) return undefined;
  const name = el.get<string | undefined>('name');
  const named = !!name && nameWords(name).length > 0;
  const def = kindOf(el);
  if (def) {
    const trigger = triggerOf(el);
    return { key: def.kind, family: def.prefix, typeNames: kindTypeNames(def), ...(trigger && trigger !== 'none' ? { trigger } : {}), id, named, flowNode: FLOW_NODE_FAMILIES.has(def.family) };
  }
  const local = localName(el.$type);
  return { key: el.$type, family: local, typeNames: [lcfirst(local)], id, named, flowNode: false };
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
    unnamed: 'hash',
    flows: new Map(),
    strong: false,
  };
  let samples = 0;
  let prefixed = 0;
  const nodeBodies = new Tally<BodyClass>();
  const otherBodies = new Tally<BodyClass>();
  const unnamed = new Tally<BodyClass>();
  const flowVotes = new Map<string, { n: number; forms: Tally<FlowForm>; prefixes: Map<FlowForm, Tally<string>>; any: Tally<string> }>();

  for (const el of defs ? walk(defs, { bpmnOnly: true }) : []) {
    if (!isBpmnElement(el) || /^(bpmndi|dc|di):/.test(el.$type)) continue;
    const id = el.get<string | undefined>('id');
    if (!id) continue;
    if (CONNECTIONS.has(el.$type)) {
      const source = el.get<El | undefined>('sourceRef')?.get<string | undefined>('id');
      const target = el.get<El | undefined>('targetRef')?.get<string | undefined>('id');
      let v = flowVotes.get(el.$type);
      if (!v) flowVotes.set(el.$type, (v = { n: 0, forms: new Tally(), prefixes: new Map(), any: new Tally() }));
      v.n++;
      const p = PREFIXED.exec(id)?.[1];
      if (p) v.any.add(p);
      if (!source || !target) continue;
      for (const f of flowForms(id, source, target)) {
        v.forms.add(f.form);
        let t = v.prefixes.get(f.form);
        if (!t) v.prefixes.set(f.form, (t = new Tally()));
        t.add(f.prefix);
      }
      continue;
    }
    if (TOOL_DEFAULTS.has(id)) continue;
    const s = sampleOf(el, id);
    if (!s) continue;
    samples++;
    const m = PREFIXED.exec(id);
    if (!m) continue;
    prefixed++;
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
    let fam = l.family.get(s.family);
    if (!fam) l.family.set(s.family, (fam = { kindish: new Tally(), generic: new Tally() }));
    if (cls !== 'literal') fam.kindish.add(cls === 'triggerKind' ? 'triggerKind' : 'kind');
    else if (!isSpecific(prefix, s.typeNames, s.trigger, s.family)) fam.generic.add(prefix);
    (s.named ? (s.flowNode ? nodeBodies : otherBodies) : unnamed).add(bodyClass(body));
  }

  l.strong = prefixed >= 3 && prefixed * 2 >= samples;

  // body of named elements: the flow nodes' when they show one (pools, lanes, messages often keep tool ids);
  // a single lower-case word fits camel and snake alike
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
    ['hash', bodies.get('hash')],
    ['numbered', bodies.get('numbered')],
  ];
  let best: [Body, number] = ['pascal', MIN_EVIDENCE - 1];
  for (const v of votes) if (v[1] > best[1]) best = v;
  l.body = best[0];
  const numbered = unnamed.get('numbered');
  l.unnamed = l.body === 'numbered' || l.body === 'hash' ? l.body : numbered >= 2 && numbered > unnamed.get('hash') ? 'numbered' : 'hash';

  for (const [type, v] of flowVotes) {
    const form = v.forms.top();
    const prefix = form ? v.prefixes.get(form)!.top() : undefined;
    if (form && prefix && v.forms.get(form) * 2 >= v.n) l.flows.set(type, { form, prefix });
    else l.flows.set(type, { form: 'hash', prefix: v.any.top() ?? 'Flow' });
  }
  return l;
}

/* ------------------------------------------------------------------ */
/* the style                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_FLOW = { form: 'hash' as FlowForm, prefix: 'Flow' };

export class IdStyle {
  private constructor(private readonly l: Learned) {}

  /** The bpmn-cli default: pascal bodies, bpmn-cli prefixes, hashed unnamed elements and flows. */
  static readonly DEFAULT = new IdStyle(learn(undefined));

  /** Learns the conventions of a document (see the module contract). */
  static infer(defs: El): IdStyle {
    return new IdStyle(learn(defs));
  }

  info(): IdStyleInfo {
    const sequenceFlow = this.flowOf('bpmn:SequenceFlow');
    return { body: this.l.body, unnamed: this.l.unnamed, sequenceFlow, messageFlow: this.flowOf('bpmn:MessageFlow') };
  }

  private flowOf(type: string): { form: FlowForm; prefix: string } {
    return this.l.flows.get(type) ?? this.l.flows.get('bpmn:SequenceFlow') ?? DEFAULT_FLOW;
  }

  private caseLike(name: string, lowerFirst: boolean): string {
    return lowerFirst ? lcfirst(name) : ucfirst(name);
  }

  /** The prefix a new element of the request's kind gets (see the module contract). */
  prefixFor(req: IdRequest): string {
    const l = this.l;
    const lowerFile = l.lowerFirst >= MIN_EVIDENCE && l.lowerFirst > l.upperFirst;
    const min = l.strong ? 1 : MIN_EVIDENCE;
    const typeName = req.typeNames[0]!;
    const withTrigger = (lowerFirst: boolean): string => this.caseLike(req.trigger ? `${req.trigger}${ucfirst(typeName)}` : typeName, lowerFirst);
    if (req.trigger) {
      const exact = l.byKeyTrigger.get(`${req.key}|${req.trigger}`)?.top(min);
      if (exact) return exact;
    }
    const own = l.byKey.get(req.key);
    const ownTop = own?.top(min);
    if (ownTop) {
      const cls = l.classByKey.get(req.key)!;
      if (cls.get('triggerKind') > cls.get('kind') && cls.get('triggerKind') >= cls.get('literal')) return withTrigger(/^[a-z]/.test(ownTop));
      return ownTop;
    }
    const fam = l.family.get(req.prefix);
    if (fam) {
      const generic = fam.generic.top(min);
      const kindish = fam.kindish.total;
      if (generic && fam.generic.get(generic) >= kindish) return generic;
      if (kindish >= MIN_EVIDENCE) return fam.kindish.get('triggerKind') > fam.kindish.get('kind') ? withTrigger(lowerFile) : this.caseLike(typeName, lowerFile);
    }
    const kindish = l.classes.get('kind') + l.classes.get('triggerKind');
    if (kindish >= MIN_EVIDENCE && kindish > l.classes.get('literal')) return this.caseLike(typeName, lowerFile);
    return this.caseLike(req.prefix, lowerFile);
  }

  /** The body of a name in a name-derived style ('' when the name has no usable words or the style is not name-derived). */
  private nameBody(name: string | undefined): string {
    switch (this.l.body) {
      case 'pascal':
        return slugify(name);
      case 'camel':
        return camelSlug(name);
      case 'snake':
        return snakeSlug(name);
      case 'pascalSnake':
        return pascalSnakeSlug(name);
      default:
        return '';
    }
  }

  /** The name-derived id of a request before collision handling, or undefined (no name, a hashed or numbered style, a connection). */
  derivedBase(req: IdRequest): string | undefined {
    if (CONNECTIONS.has(req.key)) return undefined;
    const body = this.nameBody(req.name);
    return body ? `${this.prefixFor(req)}_${body}` : undefined;
  }

  /** The id of the join gateway of a split whose gateway is `gatewayId`, in a name-derived style (`<id>_join`, camel `<id>Join`). */
  joinId(gatewayId: string): string | undefined {
    switch (this.l.body) {
      case 'pascal':
      case 'snake':
        return `${gatewayId}_join`;
      case 'camel':
        return `${gatewayId}Join`;
      case 'pascalSnake':
        return `${gatewayId}_Join`;
      default:
        return undefined;
    }
  }

  /** A free id for the request (not claimed); `derived` when it comes from the name. */
  next(req: IdRequest, ids: IdRegistry): { id: string; derived: boolean } {
    if (CONNECTIONS.has(req.key) && req.source !== undefined && req.target !== undefined) return { id: this.nextConnection(req, ids), derived: false };
    const prefix = this.prefixFor(req);
    const body = this.nameBody(req.name);
    if (body) {
      const base = `${prefix}_${body}`;
      let id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}_${n}`;
      return { id, derived: true };
    }
    const unnamed = !nameWords(req.name).length;
    const style = unnamed ? this.l.unnamed : this.l.body;
    if (style === 'numbered') return { id: numbered(prefix, ids), derived: false };
    return { id: hashed(prefix, `${req.key}|${req.trigger ?? ''}|${nameWords(req.name).join(' ')}|${req.seed ?? ''}`, ids), derived: false };
  }

  private nextConnection(req: IdRequest, ids: IdRegistry): string {
    const { form, prefix } = this.flowOf(req.key);
    const s = req.source!;
    const t = req.target!;
    const free = (base: string, sep: string): string => {
      let id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}${sep}${n}`;
      return id;
    };
    switch (form) {
      case 'numbered':
        return numbered(prefix, ids);
      case 'stemTo':
        return free(`${prefix}_${lcfirst(stem(s))}To${ucfirst(stem(t))}`, '');
      case 'idPair':
        return free(`${prefix}_${s}_${t}`, '_');
      case 'stemSnake':
        return free(`${prefix}_${stem(s)}_to_${stem(t)}`, '_');
      case 'idSnake':
        return free(`${prefix}_${s}_to_${t}`, '_');
      default:
        return hashed(prefix, `${s}->${t}`, ids);
    }
  }
}

/** `<prefix>_<n>` with n = the highest number of the prefix + 1. */
function numbered(prefix: string, ids: IdRegistry): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`);
  let max = 0;
  for (const id of ids.values()) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let id = `${prefix}_${max + 1}`;
  for (let n = max + 2; ids.has(id); n++) id = `${prefix}_${n}`;
  return id;
}

/** `<prefix>_<hash7(seed)>`, re-hashed with a salt while taken. */
function hashed(prefix: string, seed: string, ids: IdRegistry): string {
  let id = `${prefix}_${hash7(seed)}`;
  for (let n = 2; ids.has(id); n++) id = `${prefix}_${hash7(`${seed}#${n}`)}`;
  return id;
}
