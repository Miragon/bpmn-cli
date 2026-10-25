import type { Doc } from '../model/Doc.js';
import { usageError } from '../shared/utils/errors.js';
import { kindLabel, triggerOf } from '../model/utils/kinds.js';
import { diExpansionState } from '../drawing/utils/expansion.js';
import { is, list, peek, shownId, type El } from '../model/utils/moddle.js';
import { laneOf } from '../model/utils/lanes.js';
import { FlowOrder } from '../validate/FlowOrder.js';
import { AROUND_DEFAULT_DEPTH, type AroundNode, type AroundOptions, type AroundScope, type AroundView } from './context.js';
import { ElementFacts } from './ElementFacts.js';
import { ElementLinks } from './ElementLinks.js';
import type { ViewAnnotation, ViewData, ViewMessageFlow } from './model-view.js';
import { compact, labelOf, nonEmpty, ownNameOf, scopesWithin } from './utils/view.js';

/**
 * `show <file> --around <id>`: the neighbourhood of one element, `depth` flow steps both ways.
 * A boundary event and its host are neighbours, as are link events of one name; the window
 * leaves a sub-process through its first and last nodes, and enters one only with `inner`.
 */
export class AroundWindow {
  private readonly links: ElementLinks;

  constructor(
    private readonly doc: Doc,
    private readonly id: string,
    private readonly opts: AroundOptions = {},
  ) {
    this.links = new ElementLinks(doc);
  }

  view(): AroundView {
    const { doc, id, opts } = this;
    const depth = opts.depth ?? AROUND_DEFAULT_DEPTH;
    if (!Number.isInteger(depth) || depth < 0) throw usageError(`--depth must be a whole number >= 0, got ${String(opts.depth)}`);
    const inner = !!opts.inner;
    const el = doc.require(id);
    const seeds = this.seedsOf(el);
    const process = doc.processOf(seeds[0] ?? el);
    if (!process) throw usageError(`"${id}" is in no process`);

    const distance = new Map<El, number>();
    let frontier = seeds;
    for (const s of seeds) distance.set(s, 0);
    for (let step = 1; step <= depth && frontier.length; step++) {
      const next: El[] = [];
      for (const node of frontier) {
        for (const n of this.neighbours(node, inner)) {
          if (distance.has(n) || !is(n, 'bpmn:FlowNode')) continue;
          distance.set(n, step);
          next.push(n);
        }
      }
      frontier = next;
    }
    const inWindow = (n: El | undefined): n is El => !!n && distance.has(n);

    const scopeSet = new Set<El>([process]);
    for (const n of distance.keys()) {
      let s = doc.scopeOf(n);
      while (s && !scopeSet.has(s)) {
        scopeSet.add(s);
        s = doc.scopeOf(s);
      }
    }
    const expansion = diExpansionState(doc.definitions);
    const scopes: AroundScope[] = [];
    const nodes: AroundNode[] = [];

    const nodeOf = (n: El): AroundNode => {
      const facts = new ElementFacts(n);
      const sub = is(n, 'bpmn:SubProcess');
      const children = sub ? doc.flowNodes(n).filter((c) => !is(c, 'bpmn:BoundaryEvent')) : [];
      const from = doc
        .incoming(n)
        .filter((f) => !inWindow(peek<El>(f, 'sourceRef')))
        .map((f) => compact({ id: shownId(f), source: shownId(peek<El>(f, 'sourceRef')), name: ownNameOf(f) }));
      return compact<AroundNode>({
        id: shownId(n),
        kind: kindLabel(n),
        name: ownNameOf(n),
        scope: shownId(doc.scopeOf(n)),
        distance: distance.get(n)!,
        host: is(n, 'bpmn:BoundaryEvent') ? shownId(peek<El>(n, 'attachedToRef')) : undefined,
        lane: is(n, 'bpmn:BoundaryEvent') ? undefined : laneOf(doc, n)?.get<string>('id'),
        trigger: is(n, 'bpmn:Event') ? facts.trigger() : undefined,
        nonInterrupting: facts.nonInterrupting(),
        expanded: sub ? expansion.get(shownId(n)) !== false : undefined,
        content: sub && children.length && !children.some((c) => inWindow(c)) ? children.length : undefined,
        // the zeebe settings are in impl, complete (no job= next to zeebe:taskDefinition type=...)
        props: facts.props({ zeebe: false }),
        impl: facts.implementation(),
        documentation: facts.documentation(),
        outgoing: doc.outgoing(n).map((f) => new ElementFacts(f).flow()),
        from: nonEmpty(from),
      });
    };

    // tree order: boundary events after their host, a sub-process's window after it
    const visitScope = (scope: El): void => {
      const ordered = new FlowOrder(doc, scope).ordered;
      const placed = new Set<El>();
      const emit = (n: El): void => {
        if (placed.has(n)) return;
        placed.add(n);
        nodes.push(nodeOf(n));
        if (is(n, 'bpmn:Activity')) for (const b of doc.boundaryEventsOf(n)) if (inWindow(b)) emit(b);
        if (is(n, 'bpmn:SubProcess') && scopeSet.has(n)) {
          scopes.push(scopeEntry(n, true));
          visitScope(n);
        }
      };
      for (const n of ordered) if (inWindow(n)) emit(n);
      for (const n of doc.flowNodes(scope)) if (inWindow(n) && is(n, 'bpmn:BoundaryEvent')) emit(n);
      // sub-processes outside the window that hold window nodes: a heading, then their window
      for (const n of doc.flowNodes(scope)) {
        if (!is(n, 'bpmn:SubProcess') || inWindow(n) || !scopeSet.has(n)) continue;
        scopes.push(scopeEntry(n, false));
        visitScope(n);
      }
    };
    const scopeEntry = (s: El, shown: boolean): AroundScope =>
      compact<AroundScope>({
        id: shownId(s),
        kind: is(s, 'bpmn:Process') ? 'process' : kindLabel(s),
        name: ownNameOf(s),
        parent: is(s, 'bpmn:Process') ? undefined : shownId(doc.scopeOf(s)),
        lane: is(s, 'bpmn:Process') ? undefined : this.links.effectiveLane(s)?.lane.get<string>('id'),
        inWindow: shown,
      });
    scopes.push(scopeEntry(process, false));
    visitScope(process);

    const content = this.processContent(process);
    const shownFlows = content.flows.filter((f) => inWindow(peek<El>(f, 'sourceRef')) && inWindow(peek<El>(f, 'targetRef'))).length;
    const windowEls = [...distance.keys()];
    const participant = doc.participantOf(process);

    return compact<AroundView>({
      file: doc.file,
      around: id,
      depth,
      inner,
      process: compact({ id: shownId(process), name: ownNameOf(process), participant: participant ? shownId(participant) : undefined, participantName: ownNameOf(participant) }),
      scopes,
      nodes,
      messageFlows: this.messageFlows(windowEls),
      annotations: this.annotations(windowEls),
      data: this.data(windowEls),
      shown: { nodes: nodes.length, flows: shownFlows },
      omitted: { nodes: content.nodes.length - nodes.length, flows: content.flows.length - shownFlows },
    });
  }

  private isEntryOrExit(node: El): boolean {
    if (is(node, 'bpmn:BoundaryEvent')) return false;
    return this.doc.incoming(node).length === 0 || this.doc.outgoing(node).length === 0;
  }

  private neighbours(node: El, inner: boolean): El[] {
    const doc = this.doc;
    const out: El[] = [];
    for (const f of doc.outgoing(node)) {
      const t = peek<El>(f, 'targetRef');
      if (t) out.push(t);
    }
    for (const f of doc.incoming(node)) {
      const s = peek<El>(f, 'sourceRef');
      if (s) out.push(s);
    }
    if (is(node, 'bpmn:Activity')) out.push(...doc.boundaryEventsOf(node));
    const host = is(node, 'bpmn:BoundaryEvent') ? peek<El>(node, 'attachedToRef') : undefined;
    if (host) out.push(host);
    const scope = doc.scopeOf(node);
    if (scope && (AroundWindow.isLink(node, 'throw') || AroundWindow.isLink(node, 'catch'))) {
      const name = AroundWindow.linkName(node);
      const other = AroundWindow.isLink(node, 'throw') ? 'catch' : 'throw';
      if (name) out.push(...doc.flowNodes(scope).filter((n) => AroundWindow.isLink(n, other) && AroundWindow.linkName(n) === name));
    }
    // leaving a sub-process: its first and last nodes lead to the sub-process
    if (scope && is(scope, 'bpmn:SubProcess') && this.isEntryOrExit(node)) out.push(scope);
    // entering one (inner): the sub-process leads to its first and last nodes
    if (inner && is(node, 'bpmn:SubProcess')) out.push(...doc.flowNodes(node).filter((n) => this.isEntryOrExit(n)));
    return out;
  }

  private seedsOf(el: El): El[] {
    if (is(el, 'bpmn:FlowNode')) return [el];
    if (is(el, 'bpmn:SequenceFlow')) return [peek<El>(el, 'sourceRef'), peek<El>(el, 'targetRef')].filter((n): n is El => !!n);
    throw usageError(`--around needs a flow node or a sequence flow; "${this.id}" is a ${labelOf(el)}`, {
      hint: is(el, 'bpmn:Process') || is(el, 'bpmn:Participant') || is(el, 'bpmn:SubProcess') ? 'Use `bpmn show <file> --scope <id>` for a whole process, pool or sub-process.' : 'Pick a node it belongs to (`bpmn show <file> <id>` names it).',
    });
  }

  private processContent(process: El): { nodes: El[]; flows: El[] } {
    const scopes = scopesWithin(process);
    return { nodes: scopes.flatMap((s) => this.doc.flowNodes(s)), flows: scopes.flatMap((s) => this.doc.sequenceFlows(s)) };
  }

  private messageFlows(windowEls: El[]): ViewMessageFlow[] {
    return this.doc
      .messageFlows()
      .filter((mf) => windowEls.includes(peek<El>(mf, 'sourceRef')!) || windowEls.includes(peek<El>(mf, 'targetRef')!))
      .map((mf) => {
        const source = peek<El>(mf, 'sourceRef');
        const target = peek<El>(mf, 'targetRef');
        const message = peek<El>(mf, 'messageRef');
        return compact<ViewMessageFlow>({
          id: shownId(mf),
          source: shownId(source),
          target: shownId(target),
          name: ownNameOf(mf),
          message: message ? (ownNameOf(message) ?? shownId(message)) : undefined,
          sourceName: ownNameOf(source),
          targetName: ownNameOf(target),
        });
      });
  }

  private annotations(windowEls: El[]): ViewAnnotation[] {
    const annotations: ViewAnnotation[] = [];
    for (const n of windowEls) {
      for (const a of this.links.annotationsOf(n)) {
        const known = annotations.find((x) => x.id === a.id);
        if (known) known.attachedTo.push(shownId(n));
        else annotations.push(compact<ViewAnnotation>({ id: a.id, text: a.text, attachedTo: [shownId(n)] }));
      }
    }
    return annotations;
  }

  private data(windowEls: El[]): ViewData[] {
    const data: ViewData[] = [];
    for (const n of windowEls) {
      const links = this.links.dataLinksOf(n);
      for (const [side, refs] of [['to', links?.reads ?? []], ['from', links?.writes ?? []]] as const) {
        for (const r of refs) {
          const ref = this.doc.get(r.id);
          let entry = data.find((d) => d.id === r.id);
          if (!entry) {
            entry = compact<ViewData>({ id: r.id, kind: ref && is(ref, 'bpmn:DataStoreReference') ? 'dataStore' : 'dataObject', name: r.name, from: [], to: [] });
            data.push(entry);
          }
          entry[side].push(shownId(n));
        }
      }
    }
    return data;
  }

  private static isLink(el: El, side: 'throw' | 'catch'): boolean {
    return is(el, side === 'throw' ? 'bpmn:IntermediateThrowEvent' : 'bpmn:IntermediateCatchEvent') && triggerOf(el) === 'link';
  }

  private static linkName(el: El): string | undefined {
    const def = list(el, 'eventDefinitions').find((d) => is(d, 'bpmn:LinkEventDefinition'));
    const name = def ? peek<unknown>(def, 'name') : undefined;
    return typeof name === 'string' && name ? name : undefined;
  }
}
