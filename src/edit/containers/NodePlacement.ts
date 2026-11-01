import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet, ElementText, Kinds } from '../../model/index.js';
import { DeclarationOrder } from '../flows/DeclarationOrder.js';
import { FlowOptions, type FlowOptionValues } from '../flows/FlowOptions.js';
import { SequenceFlows } from '../flows/SequenceFlows.js';
import type { EditSession } from '../session/EditSession.js';

export interface Placement {
  after?: string | undefined;
  before?: string | undefined;
  flow?: string | undefined;
  in?: string | undefined;
  on?: string | undefined;
}

export type PlacementOptions = Placement & FlowOptionValues & { to?: string | undefined };

export type PlacementMode = 'after' | 'before' | 'between' | 'flow' | 'in' | 'on' | 'none';

export class NodePlacement {
  constructor(
    private readonly edit: EditSession,
    private readonly placement: PlacementOptions,
  ) {}

  static modeOf(placement: Placement): PlacementMode {
    if (placement.after && placement.before) {
      return 'between';
    }
    if (placement.after) {
      return 'after';
    }
    if (placement.before) {
      return 'before';
    }
    if (placement.flow) {
      return 'flow';
    }
    if (placement.on) {
      return 'on';
    }
    if (placement.in) {
      return 'in';
    }
    return 'none';
  }

  get mode(): PlacementMode {
    return NodePlacement.modeOf(this.placement);
  }

  scope(): BpmnElement {
    const { placement } = this;
    const document = this.edit.document;
    switch (this.mode) {
      case 'after':
      case 'between':
        return document.scopes.scopeOf(this.edit.require(placement.after!, 'bpmn:FlowNode')) ?? document.scopes.defaultScope();
      case 'before':
        return document.scopes.scopeOf(this.edit.require(placement.before!, 'bpmn:FlowNode')) ?? document.scopes.defaultScope();
      case 'flow':
        return document.scopes.scopeOf(this.edit.require(placement.flow!, 'bpmn:SequenceFlow', 'sequence flow')) ?? document.scopes.defaultScope();
      case 'on':
        return document.scopes.scopeOf(this.edit.require(placement.on!, 'bpmn:Activity', 'activity')) ?? document.scopes.defaultScope();
      case 'in':
        return this.edit.requireScope(placement.in);
      default:
        return document.scopes.defaultScope();
    }
  }

  place(node: BpmnElement, changes: ChangeSet): BpmnElement | undefined {
    const entryFlow = this.attach(node, this.scope(), changes);
    if (this.placement.to) {
      this.connectTo(node, this.placement.to, changes);
    }
    this.edit.document.tree.invalidate();
    return entryFlow;
  }

  private attach(node: BpmnElement, scope: BpmnElement, changes: ChangeSet): BpmnElement | undefined {
    const { placement } = this;
    const { mode } = this;
    if (mode === 'on') {
      this.attachBoundary(node, scope, changes);
      return undefined;
    }
    if (node.is('bpmn:BoundaryEvent')) {
      throw BpmnError.model('E_INVALID_PLACEMENT', 'Boundary events must be placed with --on <activityId>', { element: node.id });
    }
    if (mode === 'in' || mode === 'none') {
      new DeclarationOrder(scope).insertAfter(undefined, node);
      return undefined;
    }
    if (mode === 'flow') {
      return this.spliceWithOptions(node, this.edit.require(placement.flow!, 'bpmn:SequenceFlow', 'sequence flow'), changes);
    }
    if (mode === 'between') {
      const afterNode = this.edit.require(placement.after!, 'bpmn:FlowNode');
      const beforeNode = this.edit.require(placement.before!, 'bpmn:FlowNode');
      return this.spliceWithOptions(node, this.requireFlowBetween(afterNode, beforeNode), changes);
    }
    return mode === 'after' ? this.placeAfter(node, scope, changes) : this.placeBefore(node, scope, changes);
  }

  private attachBoundary(node: BpmnElement, scope: BpmnElement, changes: ChangeSet): void {
    const host = this.edit.require(this.placement.on!, 'bpmn:Activity', 'activity');
    if (!node.is('bpmn:BoundaryEvent')) {
      throw BpmnError.model('E_INVALID_PLACEMENT', `--on attaches boundary events only; ${Kinds.label(node)} cannot be attached to ${host.id}`, {
        element: node.id,
        hint: 'Use --after / --before / --in for other nodes.',
      });
    }
    this.assertBoundaryHost(host, node);
    node.set('attachedToRef', host);
    const boundaries = this.edit.document.scopes.boundaryEventsOf(host);
    new DeclarationOrder(scope).insertAfter(boundaries[boundaries.length - 1] ?? host, node);
    changes.note(`attached to ${host.id}`);
  }

  private placeAfter(node: BpmnElement, scope: BpmnElement, changes: ChangeSet): BpmnElement {
    const { placement } = this;
    const anchor = this.edit.require(placement.after!, 'bpmn:FlowNode');
    const out = this.edit.document.flows.outgoing(anchor);
    if (anchor.is('bpmn:Gateway') || out.length === 0) {
      const order = new DeclarationOrder(scope);
      order.insertAfter(order.lastFlowOf(anchor) ?? anchor, node);
      const entryFlow = new SequenceFlows(this.edit).create(anchor, node, new FlowOptions(placement).toAttrs(), node);
      changes.create(ChangeEntries.ofFlow(entryFlow));
      changes.note(`appended after ${anchor.id}`);
      return entryFlow;
    }
    if (out.length === 1) {
      return this.spliceWithOptions(node, out[0]!, changes);
    }
    throw BpmnError.model('E_HAS_SUCCESSOR', `${anchor.id} already has ${out.length} outgoing flows; say which one to insert into`, {
      element: anchor.id,
      candidates: out.map((element) => element.id),
      hint: `Use --flow <flowId> (one of ${out.map((element) => element.id).join(', ')}) or --after ${anchor.id} --before <targetId>.`,
    });
  }

  private placeBefore(node: BpmnElement, scope: BpmnElement, changes: ChangeSet): BpmnElement | undefined {
    const anchor = this.edit.require(this.placement.before!, 'bpmn:FlowNode');
    const inc = this.edit.document.flows.incoming(anchor);
    const isJoin = anchor.is('bpmn:Gateway') && inc.length >= 2;
    if (inc.length === 0 || isJoin) {
      this.prepend(node, anchor, isJoin, scope, changes);
      return undefined;
    }
    if (inc.length === 1) {
      return this.spliceWithOptions(node, inc[0]!, changes);
    }
    throw BpmnError.model('E_HAS_PREDECESSOR', `${anchor.id} already has ${inc.length} incoming flows; say which one to insert into`, {
      element: anchor.id,
      candidates: inc.map((element) => element.id),
      hint: `Use --flow <flowId> (one of ${inc.map((element) => element.id).join(', ')}) or --after <sourceId> --before ${anchor.id}.`,
    });
  }

  private prepend(node: BpmnElement, anchor: BpmnElement, isJoin: boolean, scope: BpmnElement, changes: ChangeSet): void {
    const { placement } = this;
    new DeclarationOrder(scope).insertBefore(anchor, node);
    const flow = new SequenceFlows(this.edit).create(node, anchor, new FlowOptions(placement).toAttrs(), node);
    changes.create(ChangeEntries.ofFlow(flow));
    changes.note(`prepended before ${anchor.id}`);
    const used = new FlowOptions(placement).flags;
    if (used.length) {
      changes.note(`${used.join(', ')} applied to ${flow.id} (${node.id} -> ${anchor.id}): ${anchor.id} ${isJoin ? 'is a join gateway' : 'had no incoming flow'}, so no flow into ${node.id} was created`);
    }
  }

  private connectTo(node: BpmnElement, targetId: string, changes: ChangeSet): void {
    const { flows } = this.edit.document;
    const target = this.edit.require(targetId, 'bpmn:FlowNode');
    const flow = new SequenceFlows(this.edit).create(node, target, {}, undefined);
    changes.create(ChangeEntries.ofFlow(flow));
    if (!target.is('bpmn:Gateway') && flows.incoming(target).length > 1) {
      changes.warn({
        code: 'W_IMPLICIT_JOIN',
        message: `${target.id} now has ${flows.incoming(target).length} incoming flows (implicit join)`,
        element: target.id,
        hint: 'Consider joining through a gateway.',
      });
    }
  }

  private assertBoundaryHost(host: BpmnElement, boundary: BpmnElement): void {
    if (host.get<boolean | undefined>('isForCompensation')) {
      throw BpmnError.model('E_INVALID_HOST', `${ElementText.labelOf(host)} is a compensation handler (isForCompensation=true); it cannot carry boundary events`, {
        element: boundary.id,
        related: [host.id],
        hint: `Attach the boundary event to the activity that is compensated, or make ${host.id} a normal activity first (\`bpmn set <file> ${host.id} isForCompensation=false\`).`,
      });
    }
    if (host.is('bpmn:SubProcess') && !!host.get<boolean | undefined>('triggeredByEvent')) {
      throw BpmnError.model('E_INVALID_HOST', `${ElementText.labelOf(host)} is an event sub-process; it cannot carry boundary events`, {
        element: boundary.id,
        related: [host.id],
        hint: `Attach the boundary event to an activity in the flow; an event sub-process is triggered by its start event (\`bpmn add <file> eventSubProcess:<trigger> "<Name>" --in <scope>\`).`,
      });
    }
  }

  private requireFlowBetween(from: BpmnElement, to: BpmnElement): BpmnElement {
    const flows = this.edit.document.flows.outgoing(from).filter((flow) => flow.get<BpmnElement | undefined>('targetRef') === to);
    if (flows.length === 1) {
      return flows[0]!;
    }
    if (!flows.length) {
      throw BpmnError.model('E_NO_FLOW', `There is no sequence flow ${from.id} -> ${to.id}`, { element: from.id, related: [to.id] });
    }
    throw BpmnError.model('E_AMBIGUOUS_FLOW', `There are ${flows.length} flows ${from.id} -> ${to.id}; use --flow <flowId>`, {
      element: from.id,
      candidates: flows.map((element) => element.id),
    });
  }

  private assertSpliceable(node: BpmnElement, flow: BpmnElement): void {
    const rules = this.edit.document.flowRules;
    const src = flow.get<BpmnElement>('sourceRef');
    const tgt = flow.get<BpmnElement>('targetRef');
    const scope = this.edit.document.scopes.scopeOf(flow);
    const scopeId = scope ? scope.id : '<scope>';
    const kind = Kinds.label(node);
    if (!rules.canStart(node)) {
      throw BpmnError.model('E_INVALID_PLACEMENT', `${kind} ${node.id} cannot be inserted into the flow ${src.id} -> ${tgt.id}: it cannot have outgoing sequence flows`, {
        element: node.id,
        related: [flow.id],
        hint: `${src.id} already flows to ${tgt.id}. Create the ${kind} unconnected and branch to it: \`bpmn add <file> ${kind} "<name>" --in ${scopeId}\` then \`bpmn connect <file> ${src.id} <newId>\`, or split ${src.id} with a gateway (\`apply\` op "split").`,
      });
    }
    if (!rules.canEnd(node)) {
      throw BpmnError.model('E_INVALID_PLACEMENT', `${kind} ${node.id} cannot be inserted into the flow ${src.id} -> ${tgt.id}: it cannot have incoming sequence flows`, {
        element: node.id,
        related: [flow.id],
        hint: `${tgt.id} already has the predecessor ${src.id}. Create the ${kind} unconnected: \`bpmn add <file> ${kind} "<name>" --in ${scopeId}\` then \`bpmn connect <file> <newId> ${tgt.id}\`.`,
      });
    }
  }

  private spliceWithOptions(node: BpmnElement, flow: BpmnElement, changes: ChangeSet): BpmnElement {
    this.assertSpliceable(node, flow);
    const src = flow.get<BpmnElement>('sourceRef');
    const tgt = flow.get<BpmnElement>('targetRef');
    const { second, renamedFrom } = new SequenceFlows(this.edit).splice(flow, node, this.placement.flowId);
    changes.create(ChangeEntries.ofFlow(second));
    changes.change(ChangeEntries.ofFlow(flow, `${src.id} -> ${node.id} (was -> ${tgt.id})${ChangeEntries.renamedNote(renamedFrom)}`));
    changes.note(`inserted between ${src.id} and ${tgt.id}`);
    new FlowOptions(this.placement).apply(this.edit, flow, changes);
    return flow;
  }
}
