import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { is, type El } from '../model/utils/moddle.js';
import { kindFilter } from './utils/view.js';

export interface Selection {
  ids?: string[];
  path?: string[];
  via?: string[];
  kind?: string;
  branch?: string;
}

/**
 * The selectors of the format ops (`--path`, `--kind`, `--branch`), so an agent can colour the
 * happy path, align every end event or move a branch in one call.
 */
export class ElementSelector {
  constructor(private readonly doc: Doc) {}

  /** Default flow first, then declared order: the straight continuation of the drawing. */
  private steps(node: El): Array<{ flow?: El; to: El }> {
    const doc = this.doc;
    const out = doc.outgoing(node);
    const def = node.get<El | undefined>('default');
    const ordered = def && out.includes(def) ? [def, ...out.filter((flow) => flow !== def)] : out;
    const flows = ordered.map((flow) => ({ flow, to: flow.get<El>('targetRef') })).filter((step) => !!step.to);
    const boundaries = is(node, 'bpmn:Activity') ? doc.boundaryEventsOf(node).map((boundaryEvent) => ({ to: boundaryEvent })) : [];
    return [...flows, ...boundaries];
  }

  private shortest(start: El, goal: El): El[] | undefined {
    if (start === goal) return [];
    const prev = new Map<El, { from: El; flow?: El }>();
    const queue = [start];
    const seen = new Set([start]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const step of this.steps(cur)) {
        if (seen.has(step.to)) continue;
        seen.add(step.to);
        prev.set(step.to, { from: cur, ...(step.flow ? { flow: step.flow } : {}) });
        if (step.to === goal) {
          const out: El[] = [];
          for (let node: El = goal; node !== start; ) {
            const previous = prev.get(node)!;
            out.unshift(node);
            if (previous.flow) out.unshift(previous.flow);
            node = previous.from;
          }
          return out;
        }
        queue.push(step.to);
      }
    }
    return undefined;
  }

  /** The shortest sequence-flow path; `via` flows must lie on it in the given order. */
  path(fromId: string, toId: string, via: readonly string[] = []): El[] {
    const doc = this.doc;
    const from = doc.require(fromId, 'bpmn:FlowNode', 'flow node');
    const to = doc.require(toId, 'bpmn:FlowNode', 'flow node');
    const out: El[] = [from];
    let cur = from;
    for (const fid of via) {
      const flow = doc.require(fid, 'bpmn:SequenceFlow', 'sequence flow');
      const leg = this.shortest(cur, flow.get<El>('sourceRef'));
      if (!leg) throw ElementSelector.noMatch(`No sequence-flow path leads from ${ElementSelector.idOf(cur)} to ${fid}`, `Check the direction (--path <fromId> <toId>) and the order of --via; \`bpmn show <file>\` lists the flows of every node.`, fid);
      out.push(...leg, flow, flow.get<El>('targetRef'));
      cur = flow.get<El>('targetRef');
    }
    const last = this.shortest(cur, to);
    if (!last) throw ElementSelector.noMatch(`No sequence-flow path leads from ${ElementSelector.idOf(cur)} to ${toId}`, `Check the direction (--path <fromId> <toId>)${via.length ? ' and the --via flows' : ''}; \`bpmn show <file>\` lists the flows of every node.`, toId);
    out.push(...last);
    return out.filter((el, index) => out.indexOf(el) === index);
  }

  private reach(start: El, stop: El, forward: (from: El, to: El) => boolean): El[] {
    const seen = new Set<El>([start]);
    const order = [start];
    for (let index = 0; index < order.length; index++) {
      for (const step of this.steps(order[index]!)) {
        if (step.to === stop || seen.has(step.to) || !forward(order[index]!, step.to)) continue;
        seen.add(step.to);
        order.push(step.to);
      }
    }
    return order;
  }

  /**
   * The nodes reachable from the flow's target that no other outgoing flow of its source
   * reaches; a flow running left in the drawing is a loop back and ends the walk.
   */
  branch(flowId: string, centreX: (id: string) => number | undefined): El[] {
    const doc = this.doc;
    const flow = doc.require(flowId, 'bpmn:SequenceFlow', 'sequence flow');
    const source = flow.get<El>('sourceRef');
    const target = flow.get<El>('targetRef');
    const forward = (from: El, to: El): boolean => {
      const xa = centreX(ElementSelector.idOf(from) ?? '');
      const xb = centreX(ElementSelector.idOf(to) ?? '');
      return xa === undefined || xb === undefined || xb >= xa - 1;
    };
    const mine = this.reach(target, source, forward);
    const others = new Set(doc.outgoing(source).filter((sibling) => sibling !== flow).flatMap((sibling) => this.reach(sibling.get<El>('targetRef'), source, forward)));
    const nodes = mine.filter((node) => !others.has(node));
    if (!nodes.length) {
      throw ElementSelector.noMatch(`Nothing lies on the branch of ${flowId}: it leads to ${ElementSelector.idOf(target)}, which the other branches of ${ElementSelector.idOf(source)} reach too`, 'Name a flow that starts a branch with its own nodes (`bpmn show <file>` lists the outgoing flows of the gateway).', flowId);
    }
    const flows = nodes.flatMap((node) => doc.outgoing(node));
    return [flow, ...nodes, ...flows.filter((outgoing, index) => flows.indexOf(outgoing) === index)];
  }

  ofKind(kind: string): El[] {
    const match = kindFilter(kind);
    const out = [...this.doc.byId().values()].filter((el) => match(el));
    if (!out.length) throw ElementSelector.noMatch(`No element of kind ${kind} in the file`, '`bpmn find <file> "" --kind <kind>` lists the elements of a kind; `bpmn kinds` the kind names.');
    return out;
  }

  select(sel: Selection, opts: { shapesOnly: boolean; drawn: (id: string) => boolean; centreX: (id: string) => number | undefined }): string[] {
    if (sel.path && sel.path.length !== 2) throw usageError(`--path takes exactly two ids (from and to), got ${sel.path.length}`, { hint: 'Example: --path Event_Start Event_Done (with --via <flowId> to choose a branch).' });
    if (sel.via?.length && !sel.path) throw usageError('--via needs --path', { hint: 'Example: --path Event_Start Event_Done --via Flow_Yes.' });
    const found: El[] = [];
    if (sel.branch) found.push(...this.branch(sel.branch, opts.centreX));
    if (sel.path) found.push(...this.path(sel.path[0]!, sel.path[1]!, sel.via ?? []));
    if (sel.kind) found.push(...this.ofKind(sel.kind));
    const connection = (el: El): boolean => is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association') || is(el, 'bpmn:DataAssociation');
    // shape ops move hosts: boundary events follow them
    const picked = found
      .filter((el) => !opts.shapesOnly || (!connection(el) && !is(el, 'bpmn:BoundaryEvent')))
      .map((el) => ElementSelector.idOf(el)!)
      .filter((id) => !!id && opts.drawn(id));
    const all = [...(sel.ids ?? []), ...picked];
    const out = all.filter((id, index) => all.indexOf(id) === index);
    if (!out.length) {
      throw ElementSelector.noMatch('The selection names no drawn element', 'Name ids, or a --path / --kind / --branch that reaches drawn elements (`bpmn show <file> --layout` lists what is drawn).');
    }
    return out;
  }

  private static idOf(el: El | undefined): string | undefined {
    return el?.get<string | undefined>('id');
  }

  private static noMatch(message: string, hint: string, element?: string): Error {
    return modelError('E_NO_MATCH', message, { ...(element ? { element } : {}), hint });
  }
}
