import { IdRegistry } from '../ids/IdRegistry.js';
import { IdStyle } from '../ids/IdStyle.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { kindRequest, typeRequest, type IdRequest } from '../ids/utils/requests.js';
import { kindLabel, kindOf, triggerOf } from '../model/utils/kinds.js';
import { indexById, is, isDiElement, walk, type El } from '../model/utils/moddle.js';

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
  kind: string;
  name?: string;
}

/**
 * Gives ids to the id-less elements a full redraw draws. DI refers to elements by id, so id-less
 * ones would become `bpmnElement="undefined"`, which bpmn-moddle cannot read back.
 */
export class DrawnElementIds {
  constructor(private readonly defs: El) {}

  private idOf(el: El | undefined): string | undefined {
    const id = (el as unknown as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' && id ? id : undefined;
  }

  private lcfirst(s: string): string {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  private endsOf(el: El): [El | undefined, El | undefined] {
    const source = el.get<El | El[] | undefined>('sourceRef');
    return [Array.isArray(source) ? source[0] : source, el.get<El | undefined>('targetRef')];
  }

  /** `context` (`In <parent>`) tells an unnamed element apart. */
  private requestFor(el: El, context: string): IdRequest {
    const name = el.get<string | undefined>('name');
    const named = typeof name === 'string' && name.trim() ? { name } : {};
    if (CONNECTIONS.some((t) => is(el, t))) {
      const [source, target] = this.endsOf(el);
      if (source && target && this.idOf(source) && this.idOf(target) && (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow'))) {
        return ElementLabels.flowRequest(el.$type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source, target, named.name);
      }
      const label = (end: El | undefined): string => (end && this.idOf(end) ? new ElementLabels(end).label() : '');
      return typeRequest(el.$type, { context: source || target ? `${label(source)} To ${label(target)}` : context });
    }
    const def = kindOf(el);
    if (def) {
      const trigger = triggerOf(el);
      return kindRequest(def, { ...(def.family === 'event' && trigger && trigger !== 'none' ? { trigger } : {}), ...named, context });
    }
    return typeRequest(el.$type, { ...named, context });
  }

  /** A collaboration is told apart by its first process, a process by its pool. */
  private contextOf(el: El): string {
    if (is(el, 'bpmn:Collaboration')) {
      const participants = el.get<El[] | undefined>('participants') ?? [];
      const process = participants.map((p) => p.get<El | undefined>('processRef')).find(Boolean) ?? (this.defs.get<El[] | undefined>('rootElements') ?? []).find((r) => is(r, 'bpmn:Process'));
      return process ? new ElementLabels(process).label() : '';
    }
    if (is(el, 'bpmn:Process')) {
      const pool = [...walk(this.defs, { bpmnOnly: true })].find((p) => is(p, 'bpmn:Participant') && p.get<El | undefined>('processRef') === el);
      return pool && (this.idOf(pool) || pool.get<string | undefined>('name')) ? new ElementLabels(pool).label() : '';
    }
    // a lane set or an id-less parent names nothing
    let parent = el.$parent as El | undefined;
    while (parent && (!this.idOf(parent) || is(parent, 'bpmn:LaneSet')) && !is(parent, 'bpmn:Definitions')) parent = parent.$parent as El | undefined;
    return parent && !is(parent, 'bpmn:Definitions') ? new ElementLabels(parent).context('In') : '';
  }

  /** Returns the given ids in document order; extension elements and DI are never touched. */
  give(allocate?: (req: IdRequest) => string): GivenId[] {
    const idless: El[] = [];
    for (const el of walk(this.defs, { bpmnOnly: true })) {
      if (isDiElement(el) || this.idOf(el) || !DRAWN.some((t) => is(el, t))) continue;
      idless.push(el);
    }
    if (!idless.length) return [];
    let next = allocate;
    if (!next) {
      const style = IdStyle.infer(this.defs);
      const registry = new IdRegistry(indexById(this.defs).keys());
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
      const id = next(this.requestFor(el, this.contextOf(el)));
      el.set('id', id);
      const name = el.get<string | undefined>('name');
      given.push({ id, kind: kindOf(el) ? kindLabel(el) : this.lcfirst(el.$type.slice(el.$type.indexOf(':') + 1)), ...(typeof name === 'string' && name.trim() ? { name } : {}) });
    }
    return given;
  }
}
