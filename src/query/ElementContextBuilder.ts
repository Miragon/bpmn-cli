import type { Doc } from '../model/Doc.js';
import { is, list, peek, shownId, walk, type El } from '../model/utils/moddle.js';
import type { ContextCatch, ContextEventSubProcess, ContextLink, ContextMessage, ContextRef, ElementContext } from './context.js';
import { ElementFacts } from './ElementFacts.js';
import { ElementLinks } from './ElementLinks.js';
import type { DetailMessageFlow } from './model-view.js';
import { compact, isEventSubProcess, labelOf, nonEmpty, ownNameOf } from './utils/view.js';

const USER_PROPS: Array<[string, string]> = [
  ['bpmn:Message', 'messageRef'],
  ['bpmn:Signal', 'signalRef'],
  ['bpmn:Error', 'errorRef'],
  ['bpmn:Escalation', 'escalationRef'],
];

/**
 * `show <file> <id> --context`: where an element is, its effective lane, its neighbours, what
 * catches for it, its messages and data, and its implementation in one line.
 */
export class ElementContextBuilder {
  private readonly links: ElementLinks;

  constructor(
    private readonly doc: Doc,
    private readonly id: string,
  ) {
    this.links = new ElementLinks(doc);
  }

  build(): ElementContext {
    const doc = this.doc;
    const el = doc.require(this.id);
    const facts = new ElementFacts(el);
    const isFlow = is(el, 'bpmn:SequenceFlow');
    const chain: El[] = [];
    let scope = doc.scopeOf(el);
    while (scope) {
      chain.push(scope);
      scope = is(scope, 'bpmn:SubProcess') ? doc.scopeOf(scope) : undefined;
    }
    const process = doc.processOf(el);
    if (process && !chain.includes(process) && process !== el) chain.push(process);
    const ancestors = [...chain].reverse().map((s) => (is(s, 'bpmn:Process') ? compact<ContextRef>({ id: shownId(s), kind: 'process', name: ownNameOf(s) }) : ElementContextBuilder.refOf(s)));
    const isMessageFlow = is(el, 'bpmn:MessageFlow');
    // a message flow lives in the collaboration
    const collaboration = isMessageFlow ? (el.$parent as El | undefined) : undefined;
    if (collaboration && is(collaboration, 'bpmn:Collaboration')) ancestors.push(ElementContextBuilder.refOf(collaboration));
    const pool = this.links.poolOf(el);
    const lane = is(el, 'bpmn:FlowNode') ? this.links.effectiveLane(el) : undefined;
    const host = is(el, 'bpmn:BoundaryEvent') ? peek<El>(el, 'attachedToRef') : undefined;

    let from: ContextLink[] = [];
    let to: ContextLink[] = [];
    if (isFlow) {
      const s = peek<El>(el, 'sourceRef');
      const t = peek<El>(el, 'targetRef');
      if (s) from = [ElementContextBuilder.linkOf(s, el)];
      if (t) to = [ElementContextBuilder.linkOf(t, el)];
    } else if (isMessageFlow) {
      const s = peek<El>(el, 'sourceRef');
      const t = peek<El>(el, 'targetRef');
      if (s) from = [this.messageEndOf(s, el)];
      if (t) to = [this.messageEndOf(t, el)];
    } else if (is(el, 'bpmn:FlowNode')) {
      from = doc.incoming(el).flatMap((f) => (peek<El>(f, 'sourceRef') ? [ElementContextBuilder.linkOf(peek<El>(f, 'sourceRef')!, f)] : []));
      to = doc.outgoing(el).flatMap((f) => (peek<El>(f, 'targetRef') ? [ElementContextBuilder.linkOf(peek<El>(f, 'targetRef')!, f)] : []));
    }

    const boundary = is(el, 'bpmn:Activity') ? doc.boundaryEventsOf(el).map((b) => this.catchOf(b)) : [];
    const caughtBy: ContextCatch[] = [];
    for (const s of chain) if (is(s, 'bpmn:SubProcess')) for (const b of doc.boundaryEventsOf(s)) caughtBy.push(this.catchOf(b));
    const message = ElementContextBuilder.messageOf(el);
    const eventSubProcesses: ContextEventSubProcess[] = [];
    for (const s of chain) {
      for (const n of doc.flowNodes(s)) {
        // the element itself, or an event sub-process it is inside of, does not catch it
        if (!isEventSubProcess(n) || n === el || chain.includes(n)) continue;
        const start = doc.flowNodes(n).find((c) => is(c, 'bpmn:StartEvent'));
        eventSubProcesses.push(compact<ContextEventSubProcess>({ ...ElementContextBuilder.refOf(n), in: shownId(s), start: start ? this.catchOf(start) : undefined }));
      }
    }

    const laneEl = lane?.lane;
    const parents = laneEl ? ElementContextBuilder.parentLanes(laneEl).map((l) => compact({ id: shownId(l), name: ownNameOf(l) })) : [];
    return compact<ElementContext>({
      id: shownId(el),
      kind: labelOf(el),
      name: ownNameOf(el),
      trigger: is(el, 'bpmn:Event') ? facts.trigger() : undefined,
      nonInterrupting: facts.nonInterrupting(),
      // a send / receive task's message is the `message` line (with its id), not a prop
      props: message ? ElementContextBuilder.withoutKey(facts.props({ zeebe: false }), 'message') : facts.props({ zeebe: false }),
      documentation: facts.documentation(),
      implementation: facts.implementation(),
      ancestors,
      pool: pool && pool !== el ? compact({ id: shownId(pool), name: ownNameOf(pool) }) : undefined,
      lane: laneEl ? compact({ id: shownId(laneEl), name: ownNameOf(laneEl), via: lane?.via ? shownId(lane.via) : undefined, parents: nonEmpty(parents) }) : undefined,
      host: host ? ElementContextBuilder.refOf(host) : undefined,
      from,
      to,
      boundary,
      caughtBy,
      eventSubProcesses,
      annotations: this.links.annotationsOf(el),
      messageFlows: isMessageFlow ? [] : [...this.links.messageFlowsOf(el), ...this.poolMessageFlows(el)],
      message: message ? compact<ContextMessage>({ id: shownId(message), name: ownNameOf(message), correlationKey: new ElementFacts(message).correlationKey() }) : undefined,
      usedBy: nonEmpty(this.usersOf(el) ?? []),
      data: this.links.dataLinksOf(el),
    });
  }

  private catchOf(ev: El): ContextCatch {
    const facts = new ElementFacts(ev);
    const host = is(ev, 'bpmn:BoundaryEvent') ? peek<El>(ev, 'attachedToRef') : undefined;
    const to = this.doc.outgoing(ev).map((f) => shownId(peek<El>(f, 'targetRef')));
    return compact<ContextCatch>({ ...ElementContextBuilder.refOf(ev), trigger: facts.trigger(), nonInterrupting: facts.nonInterrupting(), on: host ? shownId(host) : undefined, to: nonEmpty(to) });
  }

  private messageEndOf(node: El, flow: El): ContextLink {
    const pool = this.links.poolOf(node);
    const inPool = pool && pool !== node ? pool : undefined;
    return compact<ContextLink>({ ...ElementContextBuilder.refOf(node), flow: shownId(flow), pool: inPool ? shownId(inPool) : undefined, poolName: ownNameOf(inPool) });
  }

  /**
   * The flows of a message element's message drawn pool to pool instead of to the element;
   * a flow without a messageRef counts by carrying the message's name.
   */
  private poolMessageFlows(el: El): DetailMessageFlow[] {
    const direction = ElementContextBuilder.messageDirection(el);
    const message = ElementContextBuilder.messageOf(el);
    const pool = this.links.poolOf(el);
    if (!direction || !message || !pool || pool === el) return [];
    const name = ownNameOf(message);
    const out: DetailMessageFlow[] = [];
    for (const mf of this.doc.messageFlows()) {
      if (peek<El>(mf, direction === 'in' ? 'targetRef' : 'sourceRef') !== pool) continue;
      const ref = peek<El>(mf, 'messageRef');
      if (ref ? ref !== message : !name || ownNameOf(mf) !== name) continue;
      out.push({ ...this.links.messageFlowEntry(mf, direction), at: shownId(pool) });
    }
    return out;
  }

  private usersOf(root: El): ContextRef[] | undefined {
    const prop = USER_PROPS.find(([type]) => is(root, type))?.[1];
    if (!prop) return undefined;
    const users: El[] = [];
    for (const e of walk(this.doc.definitions, { bpmnOnly: true })) {
      if (peek<El>(e, prop) !== root) continue;
      const user = is(e, 'bpmn:EventDefinition') ? (e.$parent as El | undefined) : e;
      if (user && !users.includes(user)) users.push(user);
    }
    return users.map(ElementContextBuilder.refOf);
  }

  private static refOf(el: El): ContextRef {
    return compact<ContextRef>({ id: shownId(el), kind: labelOf(el), name: ownNameOf(el) });
  }

  private static conditionOf(flow: El): string | undefined {
    const body = peek<El>(flow, 'conditionExpression') ? peek<unknown>(peek<El>(flow, 'conditionExpression')!, 'body') : undefined;
    return typeof body === 'string' && body ? body : undefined;
  }

  private static linkOf(node: El, flow: El): ContextLink {
    const source = peek<El>(flow, 'sourceRef');
    return compact<ContextLink>({
      ...ElementContextBuilder.refOf(node),
      flow: shownId(flow),
      flowName: ownNameOf(flow),
      condition: ElementContextBuilder.conditionOf(flow),
      default: source && peek<El>(source, 'default') === flow ? true : undefined,
    });
  }

  private static messageOf(el: El): El | undefined {
    if (is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask') || is(el, 'bpmn:MessageFlow')) return peek<El>(el, 'messageRef');
    const def = list(el, 'eventDefinitions').find((d) => is(d, 'bpmn:MessageEventDefinition'));
    return def ? peek<El>(def, 'messageRef') : undefined;
  }

  private static messageDirection(el: El): 'in' | 'out' | undefined {
    if (is(el, 'bpmn:ReceiveTask')) return 'in';
    if (is(el, 'bpmn:SendTask')) return 'out';
    if (!list(el, 'eventDefinitions').some((d) => is(d, 'bpmn:MessageEventDefinition'))) return undefined;
    return is(el, 'bpmn:CatchEvent') ? 'in' : is(el, 'bpmn:ThrowEvent') ? 'out' : undefined;
  }

  private static parentLanes(lane: El): El[] {
    const out: El[] = [];
    let p = lane.$parent as El | undefined; // a laneSet
    while (p) {
      const owner = p.$parent as El | undefined;
      if (!owner || !is(owner, 'bpmn:Lane')) break;
      out.unshift(owner);
      p = owner.$parent as El | undefined;
    }
    return out;
  }

  private static withoutKey(obj: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
    if (!obj || !(key in obj)) return obj;
    const { [key]: _, ...rest } = obj;
    return Object.keys(rest).length ? rest : undefined;
  }
}
