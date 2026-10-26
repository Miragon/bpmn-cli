import type { Doc } from '../document/Doc.js';
import { usageError } from '../document/utils/errors.js';
import { kindLabel, kindOrTypeLabel, triggerOf } from '../document/utils/kinds.js';
import { diExpansionState } from '../diagram/utils/expansion.js';
import { is, list, peek, shownId, type El } from '../document/utils/moddle.js';
import { laneOf } from '../document/utils/lanes.js';
import { FlowOrder } from '../validation/FlowOrder.js';
import { AROUND_DEFAULT_DEPTH, type AroundNode, type AroundOptions, type AroundScope, type AroundView } from './context.js';
import { ElementFacts } from './ElementFacts.js';
import { ElementLinks } from './ElementLinks.js';
import type { ViewAnnotation, ViewData, ViewMessageFlow } from './model-view.js';
import { compact, nonEmpty, ownNameOf, scopesWithin } from './utils/view.js';

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

  /**
   * Lists the window in tree order: boundary events after their host, a sub-process's window
   * after it; a sub-process outside the window that holds window nodes gets a heading, then its
   * window. A node's zeebe settings are left to `impl`, complete (no job= next to zeebe:taskDefinition type=...).
   */
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
    for (const seed of seeds) distance.set(seed, 0);
    for (let step = 1; step <= depth && frontier.length; step++) {
      const next: El[] = [];
      for (const node of frontier) {
        for (const neighbour of this.neighbours(node, inner)) {
          if (distance.has(neighbour) || !is(neighbour, 'bpmn:FlowNode')) continue;
          distance.set(neighbour, step);
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    const inWindow = (candidate: El | undefined): candidate is El => !!candidate && distance.has(candidate);

    const scopeSet = new Set<El>([process]);
    for (const node of distance.keys()) {
      let scope = doc.scopeOf(node);
      while (scope && !scopeSet.has(scope)) {
        scopeSet.add(scope);
        scope = doc.scopeOf(scope);
      }
    }
    const expansion = diExpansionState(doc.definitions);
    const scopes: AroundScope[] = [];
    const nodes: AroundNode[] = [];

    const nodeOf = (node: El): AroundNode => {
      const facts = new ElementFacts(node);
      const sub = is(node, 'bpmn:SubProcess');
      const children = sub ? doc.flowNodes(node).filter((child) => !is(child, 'bpmn:BoundaryEvent')) : [];
      const from = doc
        .incoming(node)
        .filter((flow) => !inWindow(peek<El>(flow, 'sourceRef')))
        .map((flow) => compact({ id: shownId(flow), source: shownId(peek<El>(flow, 'sourceRef')), name: ownNameOf(flow) }));
      return compact<AroundNode>({
        id: shownId(node),
        kind: kindLabel(node),
        name: ownNameOf(node),
        scope: shownId(doc.scopeOf(node)),
        distance: distance.get(node)!,
        host: is(node, 'bpmn:BoundaryEvent') ? shownId(peek<El>(node, 'attachedToRef')) : undefined,
        lane: is(node, 'bpmn:BoundaryEvent') ? undefined : laneOf(doc, node)?.get<string>('id'),
        trigger: is(node, 'bpmn:Event') ? facts.trigger() : undefined,
        nonInterrupting: facts.nonInterrupting(),
        expanded: sub ? expansion.get(shownId(node)) !== false : undefined,
        content: sub && children.length && !children.some((child) => inWindow(child)) ? children.length : undefined,
        props: facts.props({ zeebe: false }),
        impl: facts.implementation(),
        documentation: facts.documentation(),
        outgoing: doc.outgoing(node).map((flow) => new ElementFacts(flow).flow()),
        from: nonEmpty(from),
      });
    };

    const visitScope = (scope: El): void => {
      const ordered = new FlowOrder(doc, scope).ordered;
      const placed = new Set<El>();
      const emit = (node: El): void => {
        if (placed.has(node)) return;
        placed.add(node);
        nodes.push(nodeOf(node));
        if (is(node, 'bpmn:Activity')) for (const boundaryEvent of doc.boundaryEventsOf(node)) if (inWindow(boundaryEvent)) emit(boundaryEvent);
        if (is(node, 'bpmn:SubProcess') && scopeSet.has(node)) {
          scopes.push(scopeEntry(node, true));
          visitScope(node);
        }
      };
      for (const node of ordered) if (inWindow(node)) emit(node);
      for (const node of doc.flowNodes(scope)) if (inWindow(node) && is(node, 'bpmn:BoundaryEvent')) emit(node);
      for (const node of doc.flowNodes(scope)) {
        if (!is(node, 'bpmn:SubProcess') || inWindow(node) || !scopeSet.has(node)) continue;
        scopes.push(scopeEntry(node, false));
        visitScope(node);
      }
    };
    const scopeEntry = (scope: El, shown: boolean): AroundScope =>
      compact<AroundScope>({
        id: shownId(scope),
        kind: is(scope, 'bpmn:Process') ? 'process' : kindLabel(scope),
        name: ownNameOf(scope),
        parent: is(scope, 'bpmn:Process') ? undefined : shownId(doc.scopeOf(scope)),
        lane: is(scope, 'bpmn:Process') ? undefined : this.links.effectiveLane(scope)?.lane.get<string>('id'),
        inWindow: shown,
      });
    scopes.push(scopeEntry(process, false));
    visitScope(process);

    const content = this.processContent(process);
    const shownFlows = content.flows.filter((flow) => inWindow(peek<El>(flow, 'sourceRef')) && inWindow(peek<El>(flow, 'targetRef'))).length;
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

  /**
   * The first and last nodes of a sub-process lead out to the sub-process; with `inner`, a
   * sub-process also leads into its first and last nodes.
   */
  private neighbours(node: El, inner: boolean): El[] {
    const doc = this.doc;
    const out: El[] = [];
    for (const flow of doc.outgoing(node)) {
      const target = peek<El>(flow, 'targetRef');
      if (target) out.push(target);
    }
    for (const flow of doc.incoming(node)) {
      const source = peek<El>(flow, 'sourceRef');
      if (source) out.push(source);
    }
    if (is(node, 'bpmn:Activity')) out.push(...doc.boundaryEventsOf(node));
    const host = is(node, 'bpmn:BoundaryEvent') ? peek<El>(node, 'attachedToRef') : undefined;
    if (host) out.push(host);
    const scope = doc.scopeOf(node);
    if (scope && (AroundWindow.isLink(node, 'throw') || AroundWindow.isLink(node, 'catch'))) {
      const name = AroundWindow.linkName(node);
      const other = AroundWindow.isLink(node, 'throw') ? 'catch' : 'throw';
      if (name) out.push(...doc.flowNodes(scope).filter((candidate) => AroundWindow.isLink(candidate, other) && AroundWindow.linkName(candidate) === name));
    }
    if (scope && is(scope, 'bpmn:SubProcess') && this.isEntryOrExit(node)) out.push(scope);
    if (inner && is(node, 'bpmn:SubProcess')) out.push(...doc.flowNodes(node).filter((child) => this.isEntryOrExit(child)));
    return out;
  }

  private seedsOf(el: El): El[] {
    if (is(el, 'bpmn:FlowNode')) return [el];
    if (is(el, 'bpmn:SequenceFlow')) return [peek<El>(el, 'sourceRef'), peek<El>(el, 'targetRef')].filter((endpoint): endpoint is El => !!endpoint);
    throw usageError(`--around needs a flow node or a sequence flow; "${this.id}" is a ${kindOrTypeLabel(el)}`, {
      hint: is(el, 'bpmn:Process') || is(el, 'bpmn:Participant') || is(el, 'bpmn:SubProcess') ? 'Use `bpmn show <file> --scope <id>` for a whole process, pool or sub-process.' : 'Pick a node it belongs to (`bpmn show <file> <id>` names it).',
    });
  }

  private processContent(process: El): { nodes: El[]; flows: El[] } {
    const scopes = scopesWithin(process);
    return { nodes: scopes.flatMap((scope) => this.doc.flowNodes(scope)), flows: scopes.flatMap((scope) => this.doc.sequenceFlows(scope)) };
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
    for (const element of windowEls) {
      for (const annotation of this.links.annotationsOf(element)) {
        const known = annotations.find((existing) => existing.id === annotation.id);
        if (known) known.attachedTo.push(shownId(element));
        else annotations.push(compact<ViewAnnotation>({ id: annotation.id, text: annotation.text, attachedTo: [shownId(element)] }));
      }
    }
    return annotations;
  }

  private data(windowEls: El[]): ViewData[] {
    const data: ViewData[] = [];
    for (const element of windowEls) {
      const links = this.links.dataLinksOf(element);
      for (const [side, refs] of [['to', links?.reads ?? []], ['from', links?.writes ?? []]] as const) {
        for (const dataRef of refs) {
          const ref = this.doc.get(dataRef.id);
          let entry = data.find((dataEntry) => dataEntry.id === dataRef.id);
          if (!entry) {
            entry = compact<ViewData>({ id: dataRef.id, kind: ref && is(ref, 'bpmn:DataStoreReference') ? 'dataStore' : 'dataObject', name: dataRef.name, from: [], to: [] });
            data.push(entry);
          }
          entry[side].push(shownId(element));
        }
      }
    }
    return data;
  }

  private static isLink(el: El, side: 'throw' | 'catch'): boolean {
    return is(el, side === 'throw' ? 'bpmn:IntermediateThrowEvent' : 'bpmn:IntermediateCatchEvent') && triggerOf(el) === 'link';
  }

  private static linkName(el: El): string | undefined {
    const def = list(el, 'eventDefinitions').find((definition) => is(definition, 'bpmn:LinkEventDefinition'));
    const name = def ? peek<unknown>(def, 'name') : undefined;
    return typeof name === 'string' && name ? name : undefined;
  }
}
