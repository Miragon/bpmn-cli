import { type AnchorContext, type BpmnElement, BpmnError, ChangeEntries, ChangeSet, type Family, type IdRequest, IdRequests, type KindDefinition, KindParser, Kinds, type Trigger } from '../model/index.js';
import type { AddOperation } from '../operations/index.js';
import { AddPlacement } from './containers/AddPlacement.js';
import { Artifacts } from './containers/Artifacts.js';
import { FlowAliases } from './containers/FlowAliases.js';
import { LaneInheritance } from './containers/LaneInheritance.js';
import { NodePlacement } from './containers/NodePlacement.js';
import { Pools } from './containers/Pools.js';
import { Camunda8Defaults } from './events/Camunda8Defaults.js';
import { EventDefinitions } from './events/EventDefinitions.js';
import { EventGatewayRule } from './events/EventGatewayRule.js';
import { RootElements } from './events/RootElements.js';
import { type ElementKeys, TriggerKeys } from './events/TriggerKeys.js';
import { Associations } from './flows/Associations.js';
import { LaneMembership } from './LaneMembership.js';
import { PropertyCoercer } from './properties/PropertyCoercer.js';
import { PropertyEditor } from './PropertyEditor.js';
import type { EditSession } from './session/EditSession.js';

interface NewNode {
  command: AddOperation;
  def: KindDefinition;
  trigger: Trigger | undefined;
  keys: ElementKeys;
  changes: ChangeSet;
}

export class ElementCreation {
  constructor(private readonly edit: EditSession) {}

  private static takesMessage(def: KindDefinition): boolean {
    return def.kind === 'sendTask' || def.kind === 'receiveTask';
  }

  private static consumedKeys(def: KindDefinition): readonly string[] {
    const triggerKeys = def.family === 'event' || def.kind === 'eventSubProcess' ? TriggerKeys.ALL : [];
    const taskMessage = ElementCreation.takesMessage(def) ? ['message'] : [];
    const expanded = def.family === 'subProcess' ? ['expanded'] : [];
    const text = def.kind === 'textAnnotation' ? ['text'] : [];
    return ['doc', ...triggerKeys, ...taskMessage, ...expanded, ...text];
  }

  add(command: AddOperation, idContext?: AnchorContext): ChangeSet {
    const changes = new ChangeSet();
    const { def, trigger } = KindParser.parseToAdd(command.kind);
    const existing = command.ifAbsent && command.id ? this.edit.document.tree.byId(command.id) : undefined;
    if (existing) {
      return this.keepExisting(command, existing, def, changes);
    }
    const keys = command.set ?? {};
    const element = this.createOfFamily({ command, def, trigger, keys, changes }, idContext);
    if (!Kinds.FLOW_NODE_FAMILIES.has(def.family)) {
      this.finishWithoutLane(element, command, keys, def, changes);
    }
    const rest = TriggerKeys.remainingKeys(keys, ElementCreation.consumedKeys(def));
    if (Object.keys(rest).length) {
      changes.merge(new PropertyEditor(this.edit).set({ op: 'set', id: element.id, set: { ...rest } }));
    }
    changes.bind(command.as, element);
    RootElements.bindRefAs(changes, command.refAs, element);
    this.edit.allocator.reportSuffixed(changes);
    this.edit.document.tree.invalidate();
    return changes;
  }

  private keepExisting(command: AddOperation, existing: BpmnElement, def: KindDefinition, changes: ChangeSet): ChangeSet {
    const label = Kinds.label(existing);
    changes.note(`${command.id} already exists (${label}); nothing to do`);
    changes.bind(command.as, existing);
    if (command.flowAs) {
      changes.bind(command.flowAs, this.edit.document.flows.incoming(existing)[0]);
    }
    if (command.outAs) {
      new FlowAliases(this.edit).bindExistingOutAs(command.outAs, existing, changes);
    }
    RootElements.bindRefAs(changes, command.refAs, existing);
    if (label !== def.kind && !label.startsWith(`${def.kind}:`)) {
      changes.warn({ code: 'W_KIND_MISMATCH', message: `${command.id} exists but is a ${label}, not a ${def.kind}`, element: command.id!, hint: 'Use `retype` to change its kind, or pick another id.' });
    }
    return changes;
  }

  private createOfFamily(node: NewNode, idContext: AnchorContext | undefined): BpmnElement {
    const creators: Partial<Record<Family, () => BpmnElement>> = {
      participant: () => this.addParticipant(node),
      lane: () => this.addLane(node),
      data: () => this.addData(node),
      artifact: () => this.addArtifact(node),
    };
    return creators[node.def.family]?.() ?? this.addFlowNode(node, idContext);
  }

  private addParticipant({ command, changes }: NewNode): BpmnElement {
    AddPlacement.reject(command, [], 'participant');
    const before = new Set(this.edit.document.tree.processes());
    const participant = new Pools(this.edit).createParticipant(command, changes);
    for (const process of this.edit.document.tree.processes()) {
      if (!before.has(process)) {
        this.edit.document.initProcess(process, this.edit.platform());
      }
    }
    return participant;
  }

  private addLane({ command, changes }: NewNode): BpmnElement {
    AddPlacement.reject(command, ['in'], 'lane');
    return new LaneMembership(this.edit).createLane(command, changes);
  }

  private addData({ command, def, changes }: NewNode): BpmnElement {
    AddPlacement.reject(command, ['in', 'to'], def.kind);
    const scope = this.edit.requireScope(command.in);
    const options = { ...(command.id ? { id: command.id } : {}), ...(command.name ? { name: command.name } : {}) };
    const artifacts = new Artifacts(this.edit);
    const reference = def.kind === 'dataStore' ? artifacts.createDataStore(scope, options, changes) : artifacts.createDataObject(scope, options, changes);
    if (command.to) {
      new Associations(this.edit).createDataAssociation(reference, this.edit.require(command.to), {}, changes);
    }
    return reference;
  }

  private addArtifact({ command, def, keys, changes }: NewNode): BpmnElement {
    const identity = { ...(command.id ? { id: command.id } : {}), ...(command.name ? { name: command.name } : {}) };
    if (def.kind === 'group') {
      AddPlacement.reject(command, [], def.kind);
      return new Artifacts(this.edit).createGroup({ ...identity, ...(command.members ? { members: command.members } : {}) }, changes);
    }
    AddPlacement.reject(command, ['in', 'to'], def.kind);
    const scope = this.edit.requireScope(command.in);
    const text = keys['text'] ?? command.name;
    const annotation = new Artifacts(this.edit).createTextAnnotation(scope, { ...identity, ...(text ? { text } : {}) }, changes);
    if (command.to) {
      new Associations(this.edit).createAssociation(this.edit.require(command.to), annotation, {}, changes);
    }
    return annotation;
  }

  private finishWithoutLane(element: BpmnElement, command: AddOperation, keys: ElementKeys, def: KindDefinition, changes: ChangeSet): void {
    this.addDocumentation(element, keys['doc']);
    if (command.lane) {
      changes.warn({ code: 'W_OPTION_IGNORED', message: `--lane is ignored for ${def.kind} ${element.id}`, element: element.id, hint: 'Only flow nodes can be lane members.' });
    }
  }

  private addDocumentation(element: BpmnElement, text: string | undefined): void {
    if (text) {
      element.add('documentation', this.edit.document.tree.build('bpmn:Documentation', { text }));
    }
  }

  private idRequest({ command, def }: NewNode, resolved: Trigger | undefined, context: AnchorContext | undefined): IdRequest {
    const where = context ?? new AddPlacement(this.edit, command).context();
    return IdRequests.kindRequest(def, {
      ...(def.family === 'event' && resolved && resolved !== 'none' ? { trigger: resolved } : {}),
      ...(command.name ? { name: command.name } : {}),
      ...(where ? { context: where.context, ...(where.anchorKind ? { anchorKind: where.anchorKind } : {}) } : {}),
    });
  }

  private addFlowNode(node: NewNode, context: AnchorContext | undefined): BpmnElement {
    const { command, def, trigger, keys, changes } = node;
    this.edit.document.flowRules.assertCondition(command.condition);
    const explicitLane = this.resolveLane(command);
    const named = trigger ?? TriggerKeys.impliedTrigger(keys);
    const id = this.edit.allocator.explicitOr(command.id, this.idRequest(node, named, context));
    const element = this.edit.document.tree.create(def.type, { id, ...(command.name ? { name: command.name } : {}), ...(def.props ?? {}) });
    const entry = { id, kind: def.kind, ...(command.name ? { name: command.name } : {}), detail: new AddPlacement(this.edit, command).detail() };
    changes.create(entry);
    const inherited = explicitLane ? LaneInheritance.NONE : LaneInheritance.of(this.edit.document, command);
    const entryFlow = new NodePlacement(this.edit, command).place(element, changes);
    this.warnIgnoredFlowId(command, element, entryFlow, changes);
    new FlowAliases(this.edit).bindFlowAs(command, element, entryFlow, changes);
    new FlowAliases(this.edit).bindOutAs(command, element, changes);
    if (def.family === 'event') {
      entry.kind = this.setEventTrigger(node, element, named) ?? entry.kind;
    }
    this.writeContent(node, element);
    this.joinLane(element, explicitLane, inherited, changes);
    if (def.kind === 'eventSubProcess' && named) {
      this.addStartEvent(id, named, keys, changes);
    }
    return element;
  }

  private setEventTrigger({ def, keys, changes }: NewNode, event: BpmnElement, named: Trigger | undefined): string | undefined {
    const resolved = named ?? this.defaultTrigger(event, def);
    const roots = new Set(this.edit.document.tree.definitions.list('rootElements'));
    new EventDefinitions(this.edit).setTrigger(event, resolved, TriggerKeys.optionsOf(keys, event));
    this.reportNewRoots(roots, changes);
    return resolved === 'none' ? undefined : Kinds.label(event);
  }

  private defaultTrigger(event: BpmnElement, def: KindDefinition): Trigger {
    const scope = this.edit.document.scopes.scopeOf(event);
    if (event.is('bpmn:BoundaryEvent')) {
      throw BpmnError.model('E_TRIGGER_REQUIRED', `Boundary event ${event.id} needs a trigger`, {
        element: event.id,
        candidates: def.triggers ?? [],
        hint: 'Use boundaryEvent:<trigger>, e.g. boundaryEvent:timer with set timer=P2D or boundaryEvent:error with set error=PaymentFailed.',
      });
    }
    if (event.is('bpmn:StartEvent') && Kinds.isEventSubProcess(scope)) {
      throw BpmnError.model('E_TRIGGER_REQUIRED', `Start event ${event.id} inside event sub-process ${scope!.id} needs a trigger`, {
        element: event.id,
        candidates: (def.triggers ?? []).filter((kindTrigger) => kindTrigger !== 'none'),
        hint: 'Use startEvent:<trigger>, e.g. startEvent:error with set error=PaymentFailed or startEvent:timer with set timer=R/PT1H.',
      });
    }
    return 'none';
  }

  private reportNewRoots(before: ReadonlySet<BpmnElement>, changes: ChangeSet): void {
    for (const root of this.edit.document.tree.definitions.list('rootElements')) {
      if (!before.has(root)) {
        const name = root.get<string | undefined>('name');
        changes.create({ id: root.id, kind: Kinds.typeLabel(root), ...(name ? { name } : {}), detail: 'root element' });
      }
    }
  }

  private writeContent({ def, keys, changes }: NewNode, element: BpmnElement): void {
    if (ElementCreation.takesMessage(def) && keys['message'] !== undefined) {
      new PropertyEditor(this.edit).setTaskMessage(element, keys['message'], changes);
    }
    if (new Camunda8Defaults(this.edit).userTask(element)) {
      changes.note(`${element.id} is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them`);
    }
    for (const flow of new Set([...this.edit.document.flows.incoming(element), ...this.edit.document.flows.outgoing(element)])) {
      new EventGatewayRule(this.edit).warnFlow(flow, changes);
    }
    if (def.family === 'subProcess' && keys['expanded'] !== undefined) {
      const expanded = PropertyCoercer.booleanOf(element, 'expanded', keys['expanded']);
      changes.expansions.expand(element.id, expanded);
      if (!expanded) {
        changes.note(`${element.id} will be laid out collapsed`);
      }
    }
    this.addDocumentation(element, keys['doc']);
  }

  private joinLane(element: BpmnElement, explicitLane: BpmnElement | undefined, inherited: LaneInheritance, changes: ChangeSet): void {
    if (explicitLane) {
      new LaneMembership(this.edit).assign(element, explicitLane, changes);
      return;
    }
    if (inherited.lane && this.edit.document.scopes.scopeOf(element)?.is('bpmn:Process')) {
      new LaneMembership(this.edit).assign(element, inherited.lane, changes);
      const warning = inherited.warning(element.id);
      if (warning) {
        changes.warn(warning);
      }
    }
  }

  private addStartEvent(id: string, trigger: Trigger, keys: ElementKeys, changes: ChangeSet): void {
    const start = this.add({ op: 'add', kind: `startEvent:${trigger}`, in: id, set: { ...TriggerKeys.present(keys) } });
    const entry = start.created[0];
    if (entry) {
      entry.detail = `start of event sub-process ${id}`;
    }
    changes.merge(start);
  }

  private resolveLane(command: AddOperation): BpmnElement | undefined {
    if (!command.lane) {
      return undefined;
    }
    const lane = this.edit.require(command.lane, 'bpmn:Lane', 'lane');
    const scope = new NodePlacement(this.edit, command).scope();
    if (!scope.is('bpmn:Process')) {
      throw BpmnError.model('E_INVALID_LANE_MEMBERSHIP', `Nodes inside sub-process ${scope.id} cannot be lane members`, {
        element: command.lane,
        hint: 'Only nodes directly in the process can be assigned to lanes; drop --lane.',
      });
    }
    return lane;
  }

  private warnIgnoredFlowId(command: AddOperation, node: BpmnElement, entryFlow: BpmnElement | undefined, changes: ChangeSet): void {
    const { flowId } = command;
    const mode = NodePlacement.modeOf(command);
    if (!flowId || mode === 'in' || mode === 'none' || mode === 'on') {
      return;
    }
    const named = (change: { kind: string; id: string }): boolean => change.kind === 'sequenceFlow' && change.id === flowId;
    if (changes.created.some(named) || changes.changed.some((change) => named(change) && !!change.detail?.endsWith(ChangeEntries.renamedNote('')))) {
      return;
    }
    const entry = entryFlow ?? this.edit.document.flows.incoming(node)[0];
    changes.warn({
      code: 'W_OPTION_IGNORED',
      message: `--flow-id ${flowId} ignored: the flow into ${node.id} is the existing ${entry ? entry.id : 'flow'}, which keeps its id`,
      element: node.id,
      ...(entry ? { related: [entry.id] } : {}),
      hint: `--flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node)${entry ? `; rename the existing one with \`bpmn set <file> ${entry.id} id=${flowId}\`` : ''}.`,
    });
  }
}
