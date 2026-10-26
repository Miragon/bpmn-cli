import type { Doc } from '../document/Doc.js';
import { CliError } from '../document/CliError.js';
import { modelError, usageError } from '../document/utils/errors.js';
import { ElementLabels, type AnchorContext } from '../document/ids/ElementLabels.js';
import { kindRequest, type IdRequest } from '../document/utils/requests.js';
import type { ContextWord } from '../document/utils/id-words.js';
import { FLOW_NODE_FAMILIES, isEventSubProcess, kindByName, kindLabel, normalizeTrigger, parseKind, type KindDef, type ParsedKind, type Trigger } from '../document/utils/kinds.js';
import { KindError } from '../document/KindError.js';
import { addTo, is, many, type El, idOf } from '../document/utils/moddle.js';
import { typeLabel } from '../document/utils/elements.js';
import { ChangeSet, type Change } from '../document/ChangeSet.js';
import { renamedNote } from '../document/utils/renames.js';
import { AssociationService } from './AssociationService.js';
import { ArtifactService } from './ArtifactService.js';
import { LaneService } from './participants/LaneService.js';
import { PoolService } from './participants/PoolService.js';
import { EventTrigger } from './events/EventTrigger.js';
import { LaneInheritance } from './participants/LaneInheritance.js';
import { Camunda8Defaults } from '../document/vendor/Camunda8Defaults.js';
import { FlowOptions } from './flows/FlowOptions.js';
import type { AddElement, TriggerOptions } from '../commands/types.js';
import { StaleFlowReport } from './flows/StaleFlowReport.js';
import { NodePlacementService } from './NodePlacementService.js';
import { EventGatewayRule } from './events/EventGatewayRule.js';
import { FlowRules } from '../document/FlowRules.js';
import { EventDefinitionService } from './events/EventDefinitionService.js';
import { RootElementService } from './events/RootElementService.js';
import { PropertyService } from './PropertyService.js';

const EVENT_SUBPROCESS_TRIGGERS: Trigger[] = (kindByName('startEvent')?.triggers ?? []).filter((trigger) => trigger !== 'none');

const PLACEMENT_KEYS = ['after', 'before', 'flow', 'on', 'in'] as const;

/**
 * Runs the `add` op: creates one element and wires it into the model.
 * Collapse requests go to Doc.layoutRequests because `expanded` lives in DI.
 */
export class ElementCreationService {
  constructor(private readonly doc: Doc) {}

  private static parseEventSubProcessKind(token: string): ParsedKind | undefined {
    const idx = token.indexOf(':');
    if (idx < 0) return undefined;
    let base: ParsedKind;
    try {
      base = parseKind(token.slice(0, idx));
    } catch {
      return undefined;
    }
    if (base.def.kind !== 'eventSubProcess') return undefined;
    const raw = token.slice(idx + 1);
    const trigger = normalizeTrigger(raw);
    if (!trigger || !EVENT_SUBPROCESS_TRIGGERS.includes(trigger)) {
      throw new CliError('E_INVALID_TRIGGER', `Trigger "${raw}" is not allowed on eventSubProcess. Allowed: ${EVENT_SUBPROCESS_TRIGGERS.join(', ')}`, 'usage', {
        candidates: EVENT_SUBPROCESS_TRIGGERS,
        hint: 'eventSubProcess:<trigger> creates the event sub-process with a startEvent:<trigger> inside, e.g. eventSubProcess:error --error PaymentFailed.',
      });
    }
    return { def: base.def, trigger };
  }

  private static resolveKind(token: string): ParsedKind {
    try {
      return parseKind(token);
    } catch (err) {
      if (!(err instanceof KindError)) throw err;
      const sub = ElementCreationService.parseEventSubProcessKind(token);
      if (sub) return sub;
      const msg = err.message;
      if (/is rejected/.test(msg)) throw new CliError('E_UNSUPPORTED_KIND', msg, 'usage', { hint: 'Run `bpmn kinds` for the supported kinds.' });
      if (/^Unknown kind/.test(msg)) throw new CliError('E_UNKNOWN_KIND', msg, 'usage', { candidates: err.candidates, hint: 'Run `bpmn kinds` for the full list.' });
      throw new CliError('E_INVALID_TRIGGER', msg, 'usage', { hint: 'Use kind:trigger, e.g. startEvent:message or boundaryEvent:timer.' });
    }
  }

  /** What tells an unnamed element's id apart: its placement (`After <anchor>`, `On <host>`). */
  private placementContext(op: AddElement): AnchorContext | undefined {
    const at = (word: ContextWord, id: string | undefined): AnchorContext => {
      const el = id ? this.doc.get(id) : undefined;
      return el ? new ElementLabels(el).anchorContext(word) : { context: word };
    };
    switch (NodePlacementService.modeOf(op)) {
      case 'after':
      case 'between':
        return at('After', op.after);
      case 'before':
        return at('Before', op.before);
      case 'flow': {
        const source = this.doc.get(op.flow!)?.get<El | undefined>('sourceRef');
        return source ? new ElementLabels(source).anchorContext('After') : undefined;
      }
      case 'on':
        return at('On', op.on);
      default: {
        const scope = op.in ? this.doc.get(op.in) : undefined;
        if (!scope) return undefined;
        return is(scope, 'bpmn:SubProcess') || this.doc.processes().length > 1 ? new ElementLabels(scope).anchorContext('In') : undefined;
      }
    }
  }

  private elementRequest(def: KindDef, trigger: Trigger | undefined, op: AddElement, context?: AnchorContext): IdRequest {
    const where = context ?? this.placementContext(op);
    return kindRequest(def, {
      ...(def.family === 'event' && trigger && trigger !== 'none' ? { trigger } : {}),
      ...(op.name ? { name: op.name } : {}),
      ...(where ? { context: where.context, ...(where.anchorKind ? { anchorKind: where.anchorKind } : {}) } : {}),
    });
  }

  private bindOutAs(op: AddElement, alias: string, node: El, cs: ChangeSet): void {
    const id = idOf(node);
    const out = this.doc.outgoing(node);
    if (out.length === 1) {
      cs.bind(alias, out[0]);
      return;
    }
    const mode = NodePlacementService.modeOf(op);
    if (!out.length) {
      const why = mode === 'after' ? `--after ${op.after} appends it` : mode === 'none' ? 'no placement' : `--${mode}`;
      throw usageError(`outAs ${alias}: ${id} gets no flow out of it from this placement (${why})`, {
        element: id,
        hint: 'outAs names the flow an add creates out of the new node: a splice, a prepend or "to" creates one. Otherwise connect the node with a connect op that has "as".',
      });
    }
    const ends = out.map((flow) => `${idOf(flow)} to ${idOf(flow.get<El>('targetRef'))}`).join(', ');
    throw usageError(`outAs ${alias}: ${id} gets ${out.length} flows out of it from this placement (${ends})`, {
      element: id,
      related: out.map(idOf),
      hint: `outAs names one flow: drop "to" and connect ${id} to ${op.to} with a connect op that has "as" (outAs then names the other flow).`,
    });
  }

  /**
   * Binds only when exactly one flow leaves the existing node, so a re-run never guesses:
   * a spliced gateway gets more branches later, in any order.
   */
  private bindExistingOutAs(alias: string, existing: El, cs: ChangeSet): void {
    const id = idOf(existing);
    const flowNode = is(existing, 'bpmn:FlowNode');
    const out = flowNode ? this.doc.outgoing(existing) : [];
    if (out.length === 1) {
      cs.bind(alias, out[0]);
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

  private static rejectPlacement(op: AddElement, allowed: ReadonlyArray<(typeof PLACEMENT_KEYS)[number] | 'to'>, kind: string): void {
    for (const key of [...PLACEMENT_KEYS, 'to'] as const) {
      if (op[key] !== undefined && !allowed.includes(key)) {
        throw modelError('E_INVALID_PLACEMENT', `--${key} does not apply to ${kind}`, {
          hint: allowed.length ? `${kind} accepts ${allowed.map((option) => `--${option}`).join(', ')} only.` : `${kind} takes no placement options.`,
        });
      }
    }
  }

  private addDocumentation(el: El, text: string | undefined): void {
    if (!text) return;
    addTo(el, 'documentation', this.doc.moddle.create('bpmn:Documentation', { text }));
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
    return ElementCreationService.inferTrigger(opts) !== undefined || opts.nonInterrupting !== undefined;
  }

  private static takesMessage(def: KindDef): boolean {
    return def.kind === 'sendTask' || def.kind === 'receiveTask';
  }

  private checkFlowOptions(op: AddElement): void {
    new FlowOptions(op).assertConsistent();
    new FlowRules(this.doc).assertCondition(op.condition);
  }

  private warnIgnoredFlowOptions(op: AddElement, node: El, entryFlow: El | undefined, cs: ChangeSet): void {
    const id = idOf(node);
    const mode = NodePlacementService.modeOf(op);
    if (mode === 'in' || mode === 'none' || mode === 'on') {
      const given = new FlowOptions(op).flags;
      if (given.length) {
        const why = mode === 'on' ? '--on attaches the event, it' : mode === 'in' ? '--in' : 'a placement without --after/--before/--flow';
        cs.warn({
          code: 'W_OPTION_IGNORED',
          message: `${given.join(', ')} ignored for ${id}: ${why} creates no sequence flow into the node`,
          element: id,
          hint: 'Place the node with --after / --before / --flow, or connect it afterwards with `bpmn connect`.',
        });
      }
      return;
    }
    // a spliced flow without id takes op.flowId too
    const named = (change: Change): boolean => change.kind === 'sequenceFlow' && change.id === op.flowId;
    if (op.flowId && !cs.created.some(named) && !cs.changed.some((change) => named(change) && !!change.detail?.endsWith(renamedNote('')))) {
      const entry = entryFlow ?? this.doc.incoming(node)[0];
      const kept = !!entry && this.doc.edit.preferFlowId(entry, op.flowId, node);
      cs.warn({
        code: 'W_OPTION_IGNORED',
        message: `--flow-id ${op.flowId} ignored: the flow into ${id} is the existing ${entry ? idOf(entry) : 'flow'}, which keeps its id`,
        element: id,
        ...(entry ? { related: [idOf(entry)] } : {}),
        hint: StaleFlowReport.flowIdIgnoredHint(op.flowId, entry && idOf(entry), kept),
      });
    }
  }

  private reportNewRoots(cs: ChangeSet, fn: () => void): void {
    const before = new Set(many(this.doc.definitions, 'rootElements'));
    fn();
    for (const root of many(this.doc.definitions, 'rootElements')) {
      if (before.has(root)) continue;
      const name = root.get<string | undefined>('name');
      cs.create({ id: idOf(root), kind: typeLabel(root), ...(name ? { name } : {}), detail: 'root element' });
    }
  }

  private placementDetail(op: AddElement): string {
    switch (NodePlacementService.modeOf(op)) {
      case 'between':
        return `between ${op.after} and ${op.before}`;
      case 'after':
        return `after ${op.after}`;
      case 'before':
        return `before ${op.before}`;
      case 'flow':
        return `in flow ${op.flow}`;
      case 'on':
        return `on ${op.on}`;
      default:
        return `in ${idOf(new NodePlacementService(this.doc, op).scope())}`;
    }
  }

  private resolveLane(op: AddElement): El | undefined {
    if (!op.lane) return undefined;
    const lane = this.doc.require(op.lane, 'bpmn:Lane', 'lane');
    const scope = new NodePlacementService(this.doc, op).scope();
    if (!is(scope, 'bpmn:Process')) {
      throw modelError('E_INVALID_LANE_MEMBERSHIP', `Nodes inside sub-process ${idOf(scope)} cannot be lane members`, {
        element: op.lane,
        hint: 'Only nodes directly in the process can be assigned to lanes; drop --lane.',
      });
    }
    return lane;
  }

  private addFlowNode(op: AddElement, def: KindDef, trigger: Trigger | undefined, cs: ChangeSet, context: AnchorContext | undefined): El {
    this.checkFlowOptions(op);
    const explicitLane = this.resolveLane(op);
    const id = this.doc.edit.allocator.explicitOr(op.id, this.elementRequest(def, trigger ?? ElementCreationService.inferTrigger(op), op, context));
    const el = this.doc.create(def.type, { id, ...(op.name ? { name: op.name } : {}), ...(def.props ?? {}) });
    const isEvent = def.family === 'event';
    const isEventSub = def.kind === 'eventSubProcess';
    // so the event sub-process is valid in one op
    const startTrigger = isEventSub ? (trigger ?? ElementCreationService.inferTrigger(op)) : undefined;
    const messageTask = ElementCreationService.takesMessage(def) && op.message !== undefined;
    if (!isEvent && !startTrigger && ElementCreationService.hasTriggerOptions(messageTask ? { ...op, message: undefined } : op)) {
      cs.warn({
        code: 'W_OPTION_IGNORED',
        message: isEventSub ? `Trigger options are ignored for eventSubProcess ${id}: no trigger given` : `Trigger options are ignored for ${def.kind} ${id}`,
        element: id,
        hint: isEventSub
          ? 'Use eventSubProcess:<trigger> or --error/--message/--timer/... to create the start event with the sub-process.'
          : `Trigger options apply to events only${ElementCreationService.takesMessage(def) ? ' (a send / receive task takes --message)' : ''}.`,
      });
    }
    if (op.collapsed && def.family !== 'subProcess') {
      cs.warn({ code: 'W_OPTION_IGNORED', message: `--collapsed is ignored for ${def.kind} ${id}`, element: id, hint: '--collapsed applies to sub-processes only.' });
    }

    const entry = { id, kind: def.kind, ...(op.name ? { name: op.name } : {}), detail: this.placementDetail(op) };
    cs.create(entry);
    // before the placement: a splice may rename the flow op.flow names
    const inherited = explicitLane ? LaneInheritance.NONE : LaneInheritance.of(this.doc, op);
    const entryFlow = new NodePlacementService(this.doc, op).place(el, cs);
    this.warnIgnoredFlowOptions(op, el, entryFlow, cs);
    if (op.flowAs) {
      const flow = entryFlow ?? (NodePlacementService.modeOf(op) === 'before' ? this.doc.outgoing(el)[0] : undefined);
      if (!flow) {
        throw usageError(`flowAs ${op.flowAs}: ${id} gets no flow from this placement (${NodePlacementService.modeOf(op) === 'none' ? 'no placement' : `--${NodePlacementService.modeOf(op)}`})`, {
          element: id,
          hint: 'Place the node with after / before / flow, or connect it with a connect op that has "as".',
        });
      }
      cs.bind(op.flowAs, flow);
    }
    if (op.outAs) this.bindOutAs(op, op.outAs, el, cs);

    if (isEvent) {
      let resolved = trigger ?? ElementCreationService.inferTrigger(op);
      if (!resolved) {
        const scope = this.doc.scopeOf(el);
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
      this.reportNewRoots(cs, () => new EventDefinitionService(this.doc, el).apply(resolved, op));
      if (resolved !== 'none') entry.kind = kindLabel(el);
    }
    if (messageTask) new PropertyService(this.doc).setTaskMessage(el, op.message ?? '', cs);
    if (new Camunda8Defaults(this.doc).userTask(el)) cs.note(`${id} is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them`);
    // checked once the trigger is set
    for (const flow of new Set([...this.doc.incoming(el), ...this.doc.outgoing(el)])) new EventGatewayRule(this.doc).warnFlow(flow, cs);
    if (op.collapsed && def.family === 'subProcess') {
      this.doc.layoutRequests.collapse(id);
      cs.note(`${id} will be laid out collapsed`);
    }
    this.addDocumentation(el, op.doc);

    if (explicitLane) {
      new LaneService(this.doc).assign(el, explicitLane, cs);
    } else {
      const scope = this.doc.scopeOf(el);
      if (inherited.lane && scope && is(scope, 'bpmn:Process')) {
        new LaneService(this.doc).assign(el, inherited.lane, cs);
        const warning = inherited.warning(id);
        if (warning) cs.warn(warning);
      }
    }
    if (startTrigger) {
      const startCs = this.add({ op: 'add', kind: `startEvent:${startTrigger}`, in: id, ...EventTrigger.optionsOf(op) });
      const start = startCs.created[0];
      if (start) start.detail = `start of event sub-process ${id}`;
      cs.merge(startCs);
    }
    return el;
  }

  /** `idContext` names an unnamed element's id when the placement cannot (split). */
  add(op: AddElement, idContext?: AnchorContext): ChangeSet {
    const cs = new ChangeSet();
    const { def, trigger } = ElementCreationService.resolveKind(op.kind);

    if (op.ifAbsent && !op.id) {
      const base = this.doc.edit.allocator.baseOf(this.elementRequest(def, trigger, op));
      throw usageError('--if-absent needs an explicit --id to check for', {
        hint: `Pass --id ${base} (the id add generates${op.name ? ` for "${op.name}"` : ''}), or drop --if-absent.`,
      });
    }
    if (op.ifAbsent && op.id && this.doc.has(op.id)) {
      const existing = this.doc.get(op.id)!;
      cs.note(`${op.id} already exists (${kindLabel(existing)}); nothing to do`);
      cs.bind(op.as, existing);
      if (op.flowAs) cs.bind(op.flowAs, this.doc.incoming(existing)[0]);
      if (op.outAs) this.bindExistingOutAs(op.outAs, existing, cs);
      new RootElementService(this.doc).bindRefAs(cs, op.refAs, existing);
      if (kindLabel(existing) !== def.kind && !kindLabel(existing).startsWith(`${def.kind}:`)) {
        cs.warn({
          code: 'W_KIND_MISMATCH',
          message: `${op.id} exists but is a ${kindLabel(existing)}, not a ${def.kind}`,
          element: op.id,
          hint: 'Use `retype` to change its kind, or pick another id.',
        });
      }
      return cs;
    }

    if (op.outAs && !FLOW_NODE_FAMILIES.has(def.family)) {
      throw usageError(`outAs ${op.outAs}: add ${def.kind} creates no sequence flow out of it`, {
        hint: 'outAs names the sequence flow an add creates out of a new flow node; drop it, and name a connection with a connect op that has "as".',
      });
    }
    let el: El;
    switch (def.family) {
      case 'participant': {
        ElementCreationService.rejectPlacement(op, [], 'participant');
        const before = new Set(this.doc.processes());
        el = new PoolService(this.doc).createParticipant(op, cs);
        for (const process of this.doc.processes()) if (!before.has(process)) this.doc.initProcess(process);
        break;
      }
      case 'lane':
        ElementCreationService.rejectPlacement(op, ['in'], 'lane');
        el = new LaneService(this.doc).createLane(op, cs);
        break;
      case 'data': {
        ElementCreationService.rejectPlacement(op, ['in', 'to'], def.kind);
        const scope = this.doc.requireScope(op.in);
        const opts = { ...(op.id ? { id: op.id } : {}), ...(op.name ? { name: op.name } : {}) };
        el = def.kind === 'dataStore' ? new ArtifactService(this.doc).createDataStore(scope, opts, cs) : new ArtifactService(this.doc).createDataObject(scope, opts, cs);
        if (op.to) new AssociationService(this.doc).createDataAssociation(el, this.doc.require(op.to), {}, cs);
        break;
      }
      case 'artifact': {
        if (def.kind === 'group') {
          ElementCreationService.rejectPlacement(op, [], def.kind);
          el = new ArtifactService(this.doc).createGroup({ ...(op.id ? { id: op.id } : {}), ...(op.name ? { name: op.name } : {}), ...(op.members ? { members: op.members } : {}) }, cs);
          break;
        }
        ElementCreationService.rejectPlacement(op, ['in', 'to'], def.kind);
        const scope = this.doc.requireScope(op.in);
        const text = op.text ?? op.name;
        el = new ArtifactService(this.doc).createTextAnnotation(scope, { ...(op.id ? { id: op.id } : {}), ...(op.name ? { name: op.name } : {}), ...(text ? { text } : {}) }, cs);
        if (op.to) new AssociationService(this.doc).createAssociation(this.doc.require(op.to), el, {}, cs);
        break;
      }
      default:
        el = this.addFlowNode(op, def, trigger, cs, idContext);
        break;
    }

    if (!FLOW_NODE_FAMILIES.has(def.family)) {
      this.addDocumentation(el, op.doc);
      if (op.lane) {
        cs.warn({ code: 'W_OPTION_IGNORED', message: `--lane is ignored for ${def.kind} ${idOf(el)}`, element: idOf(el), hint: 'Only flow nodes can be lane members.' });
      }
    }
    if (op.set && Object.keys(op.set).length) {
      cs.merge(new PropertyService(this.doc).set({ op: 'set', id: idOf(el), values: op.set }));
    }
    cs.bind(op.as, el);
    new RootElementService(this.doc).bindRefAs(cs, op.refAs, el);
    this.doc.edit.allocator.reportSuffixed(cs);
    this.doc.invalidate();
    return cs;
  }
}
