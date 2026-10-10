/**
 * Ids for the elements a full redraw draws.
 *
 * Diagram interchange refers to a BPMN element by its id (`bpmnElement`),
 * and both layout engines key shapes and edges by element id. An element
 * without id (BPMN allows it; hand-written files have id-less message
 * flows, participants, processes or collaborations) would be drawn with
 * `bpmnElement="undefined"` and DI ids such as `BPMNEdge_undefined`,
 * repeated for every such element, which bpmn-moddle cannot read back.
 *
 * CONTRACT
 *  giveDrawnElementsIds(defs, allocate?) gives every element a full redraw
 *  draws or keys by id (processes, collaborations, participants, lanes,
 *  flow nodes, sequence and message flows, data object / store references,
 *  text annotations, groups, associations, data associations) that has no
 *  id one in the file's id style (src/idstyle.ts; `allocate` claims it in
 *  the caller's registry, by default a registry of every id of `defs`), and
 *  returns them in document order: its name, else its kind and `In <parent>`;
 *  a connection names its ends. Nodes and containers get theirs first, so
 *  a connection between two id-less ends is named after the ends' new ids.
 *  Elements inside extension elements and DI are never touched. Without
 *  id-less elements it changes nothing. The incremental layout does not
 *  need it: it never draws an element without id (the element keeps no DI).
 */
import { IdRegistry } from '../ids.js';
import { contextOf as placeOf, flowRequest, IdStyle, kindRequest, labelOf, typeRequest, type IdRequest } from '../idstyle.js';
import { kindLabel, kindOf, triggerOf } from '../kinds.js';
import { indexById, is, isDiElement, walk, type El } from '../model.js';

/** Element types a full redraw draws (shape, edge or plane) or keys by id. */
const DRAWN = [
  'bpmn:Process',
  'bpmn:Collaboration',
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:FlowNode',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:TextAnnotation',
  'bpmn:Group',
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
];

const CONNECTIONS = ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation'];

export interface GivenId {
  id: string;
  /** kind label (`messageFlow`, `participant`, `userTask`, ...) */
  kind: string;
  name?: string;
}

const idOf = (el: El | undefined): string | undefined => {
  const id = (el as unknown as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' && id ? id : undefined;
};

const lcfirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** The ends of a connection (a data association's source is a list). */
function endsOf(el: El): [El | undefined, El | undefined] {
  const source = el.get<El | El[] | undefined>('sourceRef');
  return [Array.isArray(source) ? source[0] : source, el.get<El | undefined>('targetRef')];
}

/** The id request for an element (see the module contract); `context` (`In <parent>`) tells an unnamed one apart. */
function requestFor(el: El, context: string): IdRequest {
  const name = el.get<string | undefined>('name');
  const named = typeof name === 'string' && name.trim() ? { name } : {};
  if (CONNECTIONS.some((t) => is(el, t))) {
    const [source, target] = endsOf(el);
    if (source && target && idOf(source) && idOf(target) && (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow'))) {
      return flowRequest(el.$type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source, target, named.name);
    }
    const label = (end: El | undefined): string => (end && idOf(end) ? labelOf(end) : '');
    return typeRequest(el.$type, { context: source || target ? `${label(source)} To ${label(target)}` : context });
  }
  const def = kindOf(el);
  if (def) {
    const trigger = triggerOf(el);
    return kindRequest(def, { ...(def.family === 'event' && trigger && trigger !== 'none' ? { trigger } : {}), ...named, context });
  }
  return typeRequest(el.$type, { ...named, context });
}

/** What tells an id-less element apart: `In <parent>`; a collaboration: its (first) process; a process: its pool. */
function contextOf(defs: El, el: El): string {
  if (is(el, 'bpmn:Collaboration')) {
    const participants = el.get<El[] | undefined>('participants') ?? [];
    const process = participants.map((p) => p.get<El | undefined>('processRef')).find(Boolean) ?? (defs.get<El[] | undefined>('rootElements') ?? []).find((r) => is(r, 'bpmn:Process'));
    return process ? labelOf(process) : '';
  }
  if (is(el, 'bpmn:Process')) {
    const pool = [...walk(defs, { bpmnOnly: true })].find((p) => is(p, 'bpmn:Participant') && p.get<El | undefined>('processRef') === el);
    return pool && (idOf(pool) || pool.get<string | undefined>('name')) ? labelOf(pool) : '';
  }
  // the nearest container that names something (a lane set or an id-less parent says nothing)
  let parent = el.$parent as El | undefined;
  while (parent && (!idOf(parent) || is(parent, 'bpmn:LaneSet')) && !is(parent, 'bpmn:Definitions')) parent = parent.$parent as El | undefined;
  return parent && !is(parent, 'bpmn:Definitions') ? placeOf('In', parent) : '';
}

/** Gives the id-less elements a full redraw draws an id in the file's style (see the module contract). */
export function giveDrawnElementsIds(defs: El, allocate?: (req: IdRequest) => string): GivenId[] {
  const idless: El[] = [];
  for (const el of walk(defs, { bpmnOnly: true })) {
    if (isDiElement(el) || idOf(el) || !DRAWN.some((t) => is(el, t))) continue;
    idless.push(el);
  }
  if (!idless.length) return [];
  let next = allocate;
  if (!next) {
    const style = IdStyle.infer(defs);
    const registry = new IdRegistry(indexById(defs).keys());
    next = (req) => {
      const { id } = style.next(req, registry);
      registry.claim(id);
      return id;
    };
  }
  // nodes and containers first: a connection is named after its ends
  const ordered = [...idless.filter((el) => !CONNECTIONS.some((t) => is(el, t))), ...idless.filter((el) => CONNECTIONS.some((t) => is(el, t)))];
  const given: GivenId[] = [];
  for (const el of ordered) {
    const id = next(requestFor(el, contextOf(defs, el)));
    el.set('id', id);
    const name = el.get<string | undefined>('name');
    given.push({ id, kind: kindOf(el) ? kindLabel(el) : lcfirst(el.$type.slice(el.$type.indexOf(':') + 1)), ...(typeof name === 'string' && name.trim() ? { name } : {}) });
  }
  return given;
}
