import type { EditSession } from '../../document/EditSession.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import { ElementLabels, type AnchorContext } from '../../document/ids/ElementLabels.js';
import { kindRequest, type IdRequest } from '../../document/utils/requests.js';
import type { ContextWord } from '../../document/utils/id-words.js';
import { FLOW_NODE_FAMILIES, isEventSubProcess, kindLabel, parseKindToAdd, type KindDef, type Trigger } from '../../document/Kinds.js';
import { addTo, is, many, typeLabel, type El, idOf } from '../../document/utils/moddle.js';
import { ChangeSet, type Change } from '../../document/ChangeSet.js';
import { renamedNote } from '../../document/utils/renames.js';
import { Associations } from '../connections/Associations.js';
import { Artifacts } from './Artifacts.js';
import { Lanes } from './Lanes.js';
import { Pools } from './Pools.js';
import { EventTrigger } from '../events/EventTrigger.js';
import { LaneInheritance } from './LaneInheritance.js';
import { Camunda8Defaults } from '../../document/vendor/Camunda8Defaults.js';
import { FlowOptions } from '../connections/FlowOptions.js';
import type { AddElement, TriggerOptions } from '../../commands/types.js';
import { StaleFlowReport } from '../connections/StaleFlowReport.js';
import { NodePlacement } from './NodePlacement.js';
import { EventGatewayRule } from '../events/EventGatewayRule.js';
import { FlowRules } from '../../document/FlowRules.js';
import { EventDefinitions } from '../events/EventDefinitions.js';
import { RootElements } from '../events/RootElements.js';
import { Properties } from '../properties/Properties.js';

const PLACEMENT_KEYS = ['after', 'before', 'flow', 'on', 'in'] as const;

/**
 * Runs the `add` op: creates one element and wires it into the model.
 * Collapse requests go to Doc.layoutRequests because `expanded` lives in DI.
 */
export class ElementCreation {
  constructor(private readonly edit: EditSession) {}

  /** What tells an unnamed element's id apart: its placement (`After <anchor>`, `On <host>`). */
  private placementContext(command: AddElement): AnchorContext | undefined {
    const at = (word: ContextWord, id: string | undefined): AnchorContext => {
      const el = id ? this.edit.doc.get(id) : undefined;
      return el ? new ElementLabels(el).anchorContext(word) : { context: word };
    };
    switch (NodePlacement.modeOf(command)) {
      case 'after':
      case 'between':
        return at('After', command.after);
      case 'before':
        return at('Before', command.before);
      case 'flow': {
        const source = this.edit.doc.get(command.flow!)?.get<El | undefined>('sourceRef');
        return source ? new ElementLabels(source).anchorContext('After') : undefined;
      }
      case 'on':
        return at('On', command.on);
      default: {
        const scope = command.in ? this.edit.doc.get(command.in) : undefined;
        if (!scope) return undefined;
        return is(scope, 'bpmn:SubProcess') || this.edit.doc.processes().length > 1 ? new ElementLabels(scope).anchorContext('In') : undefined;
      }
    }
  }

  private elementRequest(def: KindDef, trigger: Trigger | undefined, command: AddElement, context?: AnchorContext): IdRequest {
    const where = context ?? this.placementContext(command);
    return kindRequest(def, {
      ...(def.family === 'event' && trigger && trigger !== 'none' ? { trigger } : {}),
      ...(command.name ? { name: command.name } : {}),
      ...(where ? { context: where.context, ...(where.anchorKind ? { anchorKind: where.anchorKind } : {}) } : {}),
    });
  }

  private bindOutAs(command: AddElement, alias: string, node: El, changes: ChangeSet): void {
    const id = idOf(node);
    const out = this.edit.doc.outgoing(node);
    if (out.length === 1) {
      changes.bind(alias, out[0]);
      return;
    }
    const mode = NodePlacement.modeOf(command);
    if (!out.length) {
      const why = mode === 'after' ? `--after ${command.after} appends it` : mode === 'none' ? 'no placement' : `--${mode}`;
      throw usageError(`outAs ${alias}: ${id} gets no flow out of it from this placement (${why})`, {
        element: id,
        hint: 'outAs names the flow an add creates out of the new node: a splice, a prepend or "to" creates one. Otherwise connect the node with a connect op that has "as".',
      });
    }
    const ends = out.map((flow) => `${idOf(flow)} to ${idOf(flow.get<El>('targetRef'))}`).join(', ');
    throw usageError(`outAs ${alias}: ${id} gets ${out.length} flows out of it from this placement (${ends})`, {
      element: id,
      related: out.map(idOf),
      hint: `outAs names one flow: drop "to" and connect ${id} to ${command.to} with a connect op that has "as" (outAs then names the other flow).`,
    });
  }

  /**
   * Binds only when exactly one flow leaves the existing node, so a re-run never guesses:
   * a spliced gateway gets more branches later, in any order.
   */
  private bindExistingOutAs(alias: string, existing: El, changes: ChangeSet): void {
    const id = idOf(existing);
    const flowNode = is(existing, 'bpmn:FlowNode');
    const out = flowNode ? this.edit.doc.outgoing(existing) : [];
    if (out.length === 1) {
      changes.bind(alias, out[0]);
      return;
    }
    const ids = out.map(idOf);
    const what = !flowNode ? `is a ${kindLabel(existing)}, no flow node` : out.length ? `has ${out.length} flows out of it (${ids.join(', ')})` : 'has no flow out of it';
    throw usageError(`outAs ${alias}: ${id} already exists and ${what}`, {
      element: id,
      ...(ids.length ? { related: ids, candidates: ids } : {}),
      hint: 'With ifAbsent, outAs binds the flow out of an existing node only when exactly one leaves it: drop "outAs" there and use the flow\'s id.',
    });
  }

  private static rejectPlacement(command: AddElement, allowed: ReadonlyArray<(typeof PLACEMENT_KEYS)[number] | 'to'>, kind: string): void {
    for (const key of [...PLACEMENT_KEYS, 'to'] as const) {
      if (command[key] !== undefined && !allowed.includes(key)) {
        throw modelError('E_INVALID_PLACEMENT', `--${key} does not apply to ${kind}`, {
          hint: allowed.length ? `${kind} accepts ${allowed.map((option) => `--${option}`).join(', ')} only.` : `${kind} takes no placement options.`,
        });
      }
    }
  }

  private addDocumentation(el: El, text: string | undefined): void {
    if (!text) return;
    addTo(el, 'documentation', this.edit.doc.moddle.create('bpmn:Documentation', { text }));
  }

  private static inferTrigger(opts: TriggerOptions): Trigger | undefined {
    if (opts.timer !== undefined) return 'timer';
    if (opts.message !== undefined) return 'message';
    if (opts.error !== undefined || opts.errorCode !== undefined) return 'error';
    if (opts.signal !== undefined) return 'signal';
    if (opts.escalation !== undefined || opts.escalationCode !== undefined) return 'escalation';
    if (opts.when !== undefined) return 'conditional';
    if (opts.link !== undefined) return 'link';
    return undefined;
  }

  private static hasTriggerOptions(opts: TriggerOptions): boolean {
    return ElementCreation.inferTrigger(opts) !== undefined || opts.nonInterrupting !== undefined;
  }

  private static takesMessage(def: KindDef): boolean {
    return def.kind === 'sendTask' || def.kind === 'receiveTask';
  }

  private checkFlowOptions(command: AddElement): void {
    new FlowOptions(command).assertConsistent();
    new FlowRules(this.edit.doc).assertCondition(command.condition);
  }

  /** Warns about flow options the add ignored; op.flowId counts as used when a spliced flow without id took it. */
  private warnIgnoredFlowOptions(command: AddElement, node: El, entryFlow: El | undefined, changes: ChangeSet): void {
    const id = idOf(node);
    const mode = NodePlacement.modeOf(command);
    if (mode === 'in' || mode === 'none' || mode === 'on') {
      const given = new FlowOptions(command).flags;
      if (given.length) {
        const why = mode === 'on' ? '--on attaches the event, it' : mode === 'in' ? '--in' : 'a placement without --after/--before/--flow';
        changes.warn({
          code: 'W_OPTION_IGNORED',
          message: `${given.join(', ')} ignored for ${id}: ${why} creates no sequence flow into the node`,
          element: id,
          hint: 'Place the node with --after / --before / --flow, or connect it afterwards with `bpmn connect`.',
        });
      }
      return;
    }
    const named = (change: Change): boolean => change.kind === 'sequenceFlow' && change.id === command.flowId;
    if (command.flowId && !changes.created.some(named) && !changes.changed.some((change) => named(change) && !!change.detail?.endsWith(renamedNote('')))) {
      const entry = entryFlow ?? this.edit.doc.incoming(node)[0];
      const kept = !!entry && this.edit.preferFlowId(entry, command.flowId, node);
      changes.warn({
        code: 'W_OPTION_IGNORED',
        message: `--flow-id ${command.flowId} ignored: the flow into ${id} is the existing ${entry ? idOf(entry) : 'flow'}, which keeps its id`,
        element: id,
        ...(entry ? { related: [idOf(entry)] } : {}),
        hint: StaleFlowReport.flowIdIgnoredHint(command.flowId, entry && idOf(entry), kept),
      });
    }
  }

  private reportNewRoots(changes: ChangeSet, fn: () => void): void {
    const before = new Set(many(this.edit.doc.definitions, 'rootElements'));
    fn();
    for (const root of many(this.edit.doc.definitions, 'rootElements')) {
      if (before.has(root)) continue;
      const name = root.get<string | undefined>('name');
      changes.create({ id: idOf(root), kind: typeLabel(root), ...(name ? { name } : {}), detail: 'root element' });
    }
  }

  private placementDetail(command: AddElement): string {
    switch (NodePlacement.modeOf(command)) {
      case 'between':
        return `between ${command.after} and ${command.before}`;
      case 'after':
        return `after ${command.after}`;
      case 'before':
        return `before ${command.before}`;
      case 'flow':
        return `in flow ${command.flow}`;
      case 'on':
        return `on ${command.on}`;
      default:
        return `in ${idOf(new NodePlacement(this.edit, command).scope())}`;
    }
  }

  private resolveLane(command: AddElement): El | undefined {
    if (!command.lane) return undefined;
    const lane = this.edit.require(command.lane, 'bpmn:Lane', 'lane');
    const scope = new NodePlacement(this.edit, command).scope();
    if (!is(scope, 'bpmn:Process')) {
      throw modelError('E_INVALID_LANE_MEMBERSHIP', `Nodes inside sub-process ${idOf(scope)} cannot be lane members`, {
        element: command.lane,
        hint: 'Only nodes directly in the process can be assigned to lanes; drop --lane.',
      });
    }
    return lane;
  }

  /**
   * Adds a flow node. An event sub-process gets its start trigger here, so it is valid in one op;
   * the inherited lane is read before the placement, as a splice may rename the flow op.flow
   * names; the event-based gateway rule checks the node's flows once the trigger is set.
   */
  private addFlowNode(command: AddElement, def: KindDef, trigger: Trigger | undefined, changes: ChangeSet, context: AnchorContext | undefined): El {
    this.checkFlowOptions(command);
    const explicitLane = this.resolveLane(command);
    const id = this.edit.allocator.explicitOr(command.id, this.elementRequest(def, trigger ?? ElementCreation.inferTrigger(command), command, context));
    const el = this.edit.doc.create(def.type, { id, ...(command.name ? { name: command.name } : {}), ...(def.props ?? {}) });
    const isEvent = def.family === 'event';
    const isEventSub = def.kind === 'eventSubProcess';
    const startTrigger = isEventSub ? (trigger ?? ElementCreation.inferTrigger(command)) : undefined;
    const messageTask = ElementCreation.takesMessage(def) && command.message !== undefined;
    if (!isEvent && !startTrigger && ElementCreation.hasTriggerOptions(messageTask ? { ...command, message: undefined } : command)) {
      changes.warn({
        code: 'W_OPTION_IGNORED',
        message: isEventSub ? `Trigger options are ignored for eventSubProcess ${id}: no trigger given` : `Trigger options are ignored for ${def.kind} ${id}`,
        element: id,
        hint: isEventSub
          ? 'Use eventSubProcess:<trigger> or --error/--message/--timer/... to create the start event with the sub-process.'
          : `Trigger options apply to events only${ElementCreation.takesMessage(def) ? ' (a send / receive task takes --message)' : ''}.`,
      });
    }
    if (command.collapsed && def.family !== 'subProcess') {
      changes.warn({ code: 'W_OPTION_IGNORED', message: `--collapsed is ignored for ${def.kind} ${id}`, element: id, hint: '--collapsed applies to sub-processes only.' });
    }

    const entry = { id, kind: def.kind, ...(command.name ? { name: command.name } : {}), detail: this.placementDetail(command) };
    changes.create(entry);
    const inherited = explicitLane ? LaneInheritance.NONE : LaneInheritance.of(this.edit.doc, command);
    const entryFlow = new NodePlacement(this.edit, command).place(el, changes);
    this.warnIgnoredFlowOptions(command, el, entryFlow, changes);
    if (command.flowAs) {
      const flow = entryFlow ?? (NodePlacement.modeOf(command) === 'before' ? this.edit.doc.outgoing(el)[0] : undefined);
      if (!flow) {
        throw usageError(`flowAs ${command.flowAs}: ${id} gets no flow from this placement (${NodePlacement.modeOf(command) === 'none' ? 'no placement' : `--${NodePlacement.modeOf(command)}`})`, {
          element: id,
          hint: 'Place the node with after / before / flow, or connect it with a connect op that has "as".',
        });
      }
      changes.bind(command.flowAs, flow);
    }
    if (command.outAs) this.bindOutAs(command, command.outAs, el, changes);

    if (isEvent) {
      let resolved = trigger ?? ElementCreation.inferTrigger(command);
      if (!resolved) {
        const scope = this.edit.doc.scopeOf(el);
        if (is(el, 'bpmn:BoundaryEvent')) {
          throw modelError('E_TRIGGER_REQUIRED', `Boundary event ${id} needs a trigger`, {
            element: id,
            candidates: def.triggers ?? [],
            hint: `Use boundaryEvent:<trigger>, e.g. boundaryEvent:timer --timer P2D or boundaryEvent:error --error PaymentFailed.`,
          });
        }
        if (is(el, 'bpmn:StartEvent') && isEventSubProcess(scope)) {
          throw modelError('E_TRIGGER_REQUIRED', `Start event ${id} inside event sub-process ${idOf(scope!)} needs a trigger`, {
            element: id,
            candidates: (def.triggers ?? []).filter((kindTrigger) => kindTrigger !== 'none'),
            hint: 'Use startEvent:<trigger>, e.g. startEvent:error --error PaymentFailed or startEvent:timer --timer R/PT1H.',
          });
        }
        resolved = 'none';
      }
      this.reportNewRoots(changes, () => new EventDefinitions(this.edit).setTrigger(el, resolved, command));
      if (resolved !== 'none') entry.kind = kindLabel(el);
    }
    if (messageTask) new Properties(this.edit).setTaskMessage(el, command.message ?? '', changes);
    if (new Camunda8Defaults(this.edit).userTask(el)) changes.note(`${id} is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them`);
    for (const flow of new Set([...this.edit.doc.incoming(el), ...this.edit.doc.outgoing(el)])) new EventGatewayRule(this.edit).warnFlow(flow, changes);
    if (command.collapsed && def.family === 'subProcess') {
      this.edit.doc.layoutRequests.collapse(id);
      changes.note(`${id} will be laid out collapsed`);
    }
    this.addDocumentation(el, command.doc);

    if (explicitLane) {
      new Lanes(this.edit).assign(el, explicitLane, changes);
    } else {
      const scope = this.edit.doc.scopeOf(el);
      if (inherited.lane && scope && is(scope, 'bpmn:Process')) {
        new Lanes(this.edit).assign(el, inherited.lane, changes);
        const warning = inherited.warning(id);
        if (warning) changes.warn(warning);
      }
    }
    if (startTrigger) {
      const startCs = this.add({ op: 'add', kind: `startEvent:${startTrigger}`, in: id, ...EventTrigger.optionsOf(command) });
      const start = startCs.created[0];
      if (start) start.detail = `start of event sub-process ${id}`;
      changes.merge(startCs);
    }
    return el;
  }

  /** `idContext` names an unnamed element's id when the placement cannot (split). */
  add(command: AddElement, idContext?: AnchorContext): ChangeSet {
    const changes = new ChangeSet();
    const { def, trigger } = parseKindToAdd(command.kind);

    if (command.ifAbsent && !command.id) {
      const base = this.edit.allocator.baseOf(this.elementRequest(def, trigger, command));
      throw usageError('--if-absent needs an explicit --id to check for', {
        hint: `Pass --id ${base} (the id add generates${command.name ? ` for "${command.name}"` : ''}), or drop --if-absent.`,
      });
    }
    if (command.ifAbsent && command.id && this.edit.doc.has(command.id)) {
      const existing = this.edit.doc.get(command.id)!;
      changes.note(`${command.id} already exists (${kindLabel(existing)}); nothing to do`);
      changes.bind(command.as, existing);
      if (command.flowAs) changes.bind(command.flowAs, this.edit.doc.incoming(existing)[0]);
      if (command.outAs) this.bindExistingOutAs(command.outAs, existing, changes);
      RootElements.bindRefAs(changes, command.refAs, existing);
      if (kindLabel(existing) !== def.kind && !kindLabel(existing).startsWith(`${def.kind}:`)) {
        changes.warn({
          code: 'W_KIND_MISMATCH',
          message: `${command.id} exists but is a ${kindLabel(existing)}, not a ${def.kind}`,
          element: command.id,
          hint: 'Use `retype` to change its kind, or pick another id.',
        });
      }
      return changes;
    }

    if (command.outAs && !FLOW_NODE_FAMILIES.has(def.family)) {
      throw usageError(`outAs ${command.outAs}: add ${def.kind} creates no sequence flow out of it`, {
        hint: 'outAs names the sequence flow an add creates out of a new flow node; drop it, and name a connection with a connect op that has "as".',
      });
    }
    let el: El;
    switch (def.family) {
      case 'participant': {
        ElementCreation.rejectPlacement(command, [], 'participant');
        const before = new Set(this.edit.doc.processes());
        el = new Pools(this.edit).createParticipant(command, changes);
        for (const process of this.edit.doc.processes()) if (!before.has(process)) this.edit.doc.initProcess(process, this.edit.platform());
        break;
      }
      case 'lane':
        ElementCreation.rejectPlacement(command, ['in'], 'lane');
        el = new Lanes(this.edit).createLane(command, changes);
        break;
      case 'data': {
        ElementCreation.rejectPlacement(command, ['in', 'to'], def.kind);
        const scope = this.edit.requireScope(command.in);
        const opts = { ...(command.id ? { id: command.id } : {}), ...(command.name ? { name: command.name } : {}) };
        el = def.kind === 'dataStore' ? new Artifacts(this.edit).createDataStore(scope, opts, changes) : new Artifacts(this.edit).createDataObject(scope, opts, changes);
        if (command.to) new Associations(this.edit).createDataAssociation(el, this.edit.require(command.to), {}, changes);
        break;
      }
      case 'artifact': {
        if (def.kind === 'group') {
          ElementCreation.rejectPlacement(command, [], def.kind);
          el = new Artifacts(this.edit).createGroup({ ...(command.id ? { id: command.id } : {}), ...(command.name ? { name: command.name } : {}), ...(command.members ? { members: command.members } : {}) }, changes);
          break;
        }
        ElementCreation.rejectPlacement(command, ['in', 'to'], def.kind);
        const scope = this.edit.requireScope(command.in);
        const text = command.text ?? command.name;
        el = new Artifacts(this.edit).createTextAnnotation(scope, { ...(command.id ? { id: command.id } : {}), ...(command.name ? { name: command.name } : {}), ...(text ? { text } : {}) }, changes);
        if (command.to) new Associations(this.edit).createAssociation(this.edit.require(command.to), el, {}, changes);
        break;
      }
      default:
        el = this.addFlowNode(command, def, trigger, changes, idContext);
        break;
    }

    if (!FLOW_NODE_FAMILIES.has(def.family)) {
      this.addDocumentation(el, command.doc);
      if (command.lane) {
        changes.warn({ code: 'W_OPTION_IGNORED', message: `--lane is ignored for ${def.kind} ${idOf(el)}`, element: idOf(el), hint: 'Only flow nodes can be lane members.' });
      }
    }
    if (command.set && Object.keys(command.set).length) {
      changes.merge(new Properties(this.edit).set({ op: 'set', id: idOf(el), values: command.set }));
    }
    changes.bind(command.as, el);
    RootElements.bindRefAs(changes, command.refAs, el);
    this.edit.allocator.reportSuffixed(changes);
    this.edit.doc.invalidate();
    return changes;
  }
}
