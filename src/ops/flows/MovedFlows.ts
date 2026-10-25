import type { Doc } from '../../model/Doc.js';
import { type Warning } from '../../shared/CliError.js';
import { is, type El } from '../../model/utils/moddle.js';
import { ChangeSet } from '../../model/ChangeSet.js';
import { idOf } from '../../model/utils/elements.js';
import type { BridgedFlow } from './Bridge.js';

/**
 * A flow the detach took out (flow ids kept). `label`: what no bridge took; given back when the
 * flow returns to `target`, else dropped with a warning.
 */
interface SpareFlow {
  flow: El;
  target: El;
  label?: FlowLabel;
}

interface FlowLabel {
  name: string | undefined;
  condition: El | undefined;
  isDefault: boolean;
}

/** A dropped label and its warnings: a later node of the chain may put the flow back after all. */
interface DroppedLabel {
  node: El;
  flow: El;
  target: El;
  label: FlowLabel;
  warnings: Warning[];
}

interface BridgeMade {
  node: El;
  target: El;
  bridge: BridgedFlow;
}

interface LabelBefore {
  name: string | undefined;
  condition: El | undefined;
  associations: El[];
}

/**
 * The flows a `move` takes out at the old place and puts back at the new one (flow ids kept), and
 * what becomes of their names, conditions and default markers: given back, kept by a bridge, or
 * dropped with a warning.
 */
export class MovedFlows {
  private readonly spare = new Map<El, SpareFlow>();
  private readonly dropped: DroppedLabel[] = [];
  private readonly bridges: BridgeMade[] = [];
  private readonly before: Map<El, LabelBefore> | undefined;

  constructor(
    private readonly doc: Doc,
    private readonly cs: ChangeSet,
    nodes: El[],
  ) {
    this.before = doc.edit.followFlowEnds ? undefined : MovedFlows.labelsBefore(doc, nodes);
  }

  /** The flow taken out at `source`, to put back where the placement connects it. */
  spareOf(source: El): El | undefined {
    return this.spare.get(source)?.flow;
  }

  hasSpare(source: El): boolean {
    return this.spare.has(source);
  }

  /** `label`: what no bridge took; given back when the flow returns to `target`. */
  takeOut(source: El, flow: El, target: El, label?: FlowLabel): void {
    this.spare.set(source, { flow, target, ...(label ? { label } : {}) });
  }

  bridged(node: El, bridge: BridgedFlow): void {
    this.bridges.push({ node, target: bridge.flow.get<El>('targetRef'), bridge });
  }

  /** After the last node of the chain moved. */
  finish(): void {
    this.giveBackLate();
    if (this.before) this.reportBridgesKept(this.before);
  }

  static labelOf(flow: El, source: El): FlowLabel {
    return { name: flow.get<string | undefined>('name'), condition: flow.get<El | undefined>('conditionExpression'), isDefault: source.get<El | undefined>('default') === flow };
  }


  /** A put-back flow is reported as one changed entry, not as removed plus created. */
  putBack(): void {
    const cs = this.cs;
    const spare = this.spare;
    for (const [node, { flow, target, label }] of spare) {
      if (this.doc.get(idOf(flow)) !== flow) continue;
      spare.delete(node);
      const id = idOf(flow);
      const back = flow.get<El>('targetRef') === target;
      const lost = label && back ? MovedFlows.giveBack(node, flow, label, cs) : '';
      cs.removed = cs.removed.filter((c) => c.id !== id);
      cs.created = cs.created.filter((c) => c.id !== id);
      cs.change(ChangeSet.flowEntryOf(flow, `${ChangeSet.flowEntryOf(flow).detail}${back ? lost : ` (was -> ${idOf(target)})`}`));
      if (!label || back) continue;
      const why = `while moving ${idOf(node)}: ${idOf(node)} was not bridged, so nothing at its old place took it, and ${id} was put back at its new place without it`;
      const warnings: Warning[] = [];
      if (label.name) warnings.push({ code: 'W_LABEL_DROPPED', message: `Flow label "${label.name}" of ${id} was dropped ${why}`, element: id });
      if (label.condition) warnings.push({ code: 'W_CONDITION_DROPPED', message: `Condition of ${id} was dropped ${why}`, element: id });
      for (const w of warnings) cs.warn(w);
      this.dropped.push({ node, flow, target, label, warnings });
    }
  }

  /** A default flow has no condition, so a flow the placement made the default keeps none. */
  private static giveBack(node: El, flow: El, label: FlowLabel, cs: ChangeSet): string {
    const id = idOf(flow);
    if (label.name && !flow.get<string | undefined>('name')) flow.set('name', label.name);
    if (label.condition && !flow.get<El | undefined>('conditionExpression')) {
      if (node.get<El | undefined>('default') === flow) {
        cs.warn({
          code: 'W_CONDITION_DROPPED',
          message: `Condition of ${id} was dropped while moving ${idOf(node)}: ${id} is now the default flow of ${idOf(node)}`,
          element: id,
          hint: `A default flow has no condition; use \`bpmn set <file> ${id} condition=...\` if the condition should replace the default marker.`,
        });
      } else {
        flow.set('conditionExpression', label.condition);
        label.condition.$parent = flow;
      }
    }
    if (!label.isDefault || node.get<El | undefined>('default') === flow) return '';
    if (!node.get<El | undefined>('default') && !flow.get<El | undefined>('conditionExpression')) {
      node.set('default', flow);
      return '';
    }
    return ` (no longer the default flow of ${idOf(node)})`;
  }

  /** A flow a later node of the chain took back between its old ends gets its label back. */
  private giveBackLate(): void {
    const cs = this.cs;
    for (const { node, flow, target, label, warnings } of this.dropped) {
      if (this.doc.get(idOf(flow)) !== flow || flow.get<El>('sourceRef') !== node || flow.get<El>('targetRef') !== target) continue;
      cs.warnings = cs.warnings.filter((w) => !warnings.includes(w));
      const lost = MovedFlows.giveBack(node, flow, label, cs);
      const change = ChangeSet.flowEntryOf(flow);
      cs.changed = cs.changed.filter((c) => c.id !== change.id);
      cs.change(ChangeSet.flowEntryOf(flow, `${change.detail}${lost}`));
    }
  }

  private static labelsBefore(doc: Doc, nodes: El[]): Map<El, LabelBefore> {
    const out = new Map<El, LabelBefore>();
    for (const n of nodes) {
      for (const f of doc.outgoing(n)) if (doc.edit.keepsFlowId(f)) out.set(f, { name: f.get<string | undefined>('name'), condition: f.get<El | undefined>('conditionExpression'), associations: [] });
    }
    if (!out.size) return out;
    for (const a of doc.byId().values()) {
      if (!is(a, 'bpmn:Association')) continue;
      for (const end of ['sourceRef', 'targetRef']) out.get(a.get<El>(end))?.associations.push(a);
    }
    return out;
  }

  /**
   * Tells on a put-back flow's change entry which bridge kept its label:
   * `(was -> C; its name stays with the bridge Flow_AToB)`.
   */
  private reportBridgesKept(before: Map<El, LabelBefore>): void {
    const cs = this.cs;
    const made = this.bridges;
    const alive = (el: El): boolean => this.doc.get(idOf(el)) === el;
    made.forEach(({ node, target, bridge }, i) => {
      const flow = bridge.from;
      const had = before.get(flow);
      if (!had || !alive(flow)) return;
      const holder = (took: (b: BridgedFlow) => boolean): El | undefined => {
        let at = bridge.flow;
        for (const later of made.slice(i + 1)) {
          if (later.bridge.from !== at) continue;
          if (!took(later.bridge)) return undefined;
          at = later.bridge.flow;
        }
        return at;
      };
      const kept = new Map<El, string[]>();
      const keep = (at: El, what: string): void => {
        kept.set(at, [...(kept.get(at) ?? []), what]);
      };
      const lost: Array<{ what: 'name' | 'condition'; at: El }> = [];
      const { name, condition, associations } = bridge.took;
      if (name !== undefined && name === had.name && flow.get<string | undefined>('name') !== name) {
        const at = holder((b) => b.took.name === name);
        if (at && !alive(at)) lost.push({ what: 'name', at });
        else if (at?.get<string | undefined>('name') === name) keep(at, 'name');
      }
      if (condition && condition === had.condition && flow.get<El | undefined>('conditionExpression') !== condition) {
        const at = holder((b) => b.took.condition === condition);
        if (at && !alive(at)) lost.push({ what: 'condition', at });
        else if (at?.get<El | undefined>('conditionExpression') === condition) keep(at, 'condition');
      }
      for (const a of associations) {
        if (!had.associations.includes(a) || !alive(a)) continue;
        const at = holder((b) => b.took.associations.includes(a));
        if (at && alive(at) && (a.get<El>('sourceRef') === at || a.get<El>('targetRef') === at)) keep(at, 'annotation');
      }
      const id = idOf(flow);
      const back = flow.get<El>('sourceRef') === node && flow.get<El>('targetRef') === target;
      const returned = lost.filter(({ what }) => back && !flow.get(what === 'name' ? 'name' : 'conditionExpression'));
      if (returned.length) {
        MovedFlows.giveBack(node, flow, { name: returned.some((l) => l.what === 'name') ? name : undefined, condition: returned.some((l) => l.what === 'condition') ? condition : undefined, isDefault: false }, cs);
        cs.changed = cs.changed.filter((c) => c.id !== id);
        cs.change(ChangeSet.flowEntryOf(flow));
      }
      for (const { what, at } of lost.filter((l) => !returned.includes(l))) {
        const why = `while moving ${idOf(node)}: the bridge ${idOf(at)} took it, and a later node of the move removed ${idOf(at)}`;
        if (what === 'name') cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${name}" of ${id} was dropped ${why}`, element: id, related: [idOf(at)] });
        else cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${id} was dropped ${why}`, element: id, related: [idOf(at)] });
      }
      if (!kept.size) return;
      const clause = [...kept].map(([at, what]) => {
        const notes = what.filter((w) => w === 'annotation').length;
        const items = [...what.filter((w) => w !== 'annotation'), ...(notes ? [notes > 1 ? 'annotations' : 'annotation'] : [])];
        const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]!;
        return `its ${list} ${items.length > 1 || notes > 1 ? 'stay' : 'stays'} with the bridge ${idOf(at)}`;
      }).join('; ');
      const last = cs.changed.map((c) => c.id).lastIndexOf(id);
      const entry = last === -1 ? ChangeSet.flowEntryOf(flow) : cs.changed[last]!;
      const detail = entry.detail ?? '';
      const said = /\(was -> [^()]*\)$/.test(detail) ? `${detail.slice(0, -1)}; ${clause})` : `${detail}${detail ? ' ' : ''}(${clause})`;
      if (last === -1) cs.change(ChangeSet.about({ ...entry, detail: said }, flow));
      else cs.changed[last] = ChangeSet.about({ ...entry, detail: said }, flow);
    });
  }
}
