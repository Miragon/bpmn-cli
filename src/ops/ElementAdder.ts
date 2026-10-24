/**
 * `add`: create one element and wire it in.
 *
 *  - parseKind(op.kind); rejected/unknown kinds -> E_UNSUPPORTED_KIND / E_UNKNOWN_KIND
 *  - id: op.id (claimId) or a speaking id in the file's style
 *    (doc.allocateId with kindRequest: kind, trigger, name, and the placement
 *    as the context of an unnamed element: Gateway_AfterCheckInvoice,
 *    Event_TimerOnReview; src/ids/IdStyle.ts); a taken id gets a `_2` suffix
 *    (W_ID_SUFFIXED, reported by OpRunner).
 *  - op.ifAbsent with op.id and the element exists -> empty ChangeSet with a note;
 *    ifAbsent without an id is E_USAGE (same rule as `apply`).
 *  - flow options: default + condition -> E_USAGE, an empty condition ->
 *    E_INVALID_VALUE (before anything is mutated); options the placement
 *    cannot apply (no flow created by --in/--on, or --flow-id when the flow
 *    into the node already existed; a spliced flow without id takes it)
 *    -> W_OPTION_IGNORED.
 *  - eventSubProcess: a trigger (`eventSubProcess:<trigger>` or inferred from
 *    --error/--message/--timer/...) also creates the triggered start event
 *    inside it (an unnamed event: Event_<Trigger>StartIn<SubProcess> by default), so the event sub-process is valid in one op.
 *  - send / receive tasks: --message <name> references a root bpmn:Message
 *    (found by id or name, created when missing), like a message event.
 *  - participants: a new process gets the platform defaults (Doc.initProcess:
 *    camunda:historyTimeToLive in a Camunda 7 file); a user task of a Camunda 8
 *    file gets zeebe:userTask (platform/Camunda8Defaults.ts).
 *  - flow nodes: create with name (+ def.props), placeNode() from ./flows.js,
 *    EventDefinitions.apply() for events (default trigger 'none'; boundary events and
 *    event sub-process start events require a trigger -> E_TRIGGER_REQUIRED;
 *    a missing trigger is inferred from --timer/--message/... when given),
 *    documentation (op.doc), sub-process expansion (op.collapsed ->
 *    Doc.layoutRequests), lane: op.lane -> assignLane, else inherit the lane of
 *    the after/before anchor (or of the host for boundary events; --flow:
 *    of the flow's source). A splice into a flow whose ends are in different
 *    lanes takes the lane of the row the incremental layout puts the node
 *    on (diagram/place.ts: the target's row after a branching source, so
 *    then the target's lane; else the anchor's) and warns W_LANE_INHERITED
 *    naming the other lane (decided before the placement, which may rename
 *    the flow).
 *  - participant / lane -> containers.ts; dataObject / dataStore /
 *    textAnnotation -> artifacts.ts (scope from --in or default; `--after`
 *    etc. are invalid for them: E_INVALID_PLACEMENT; `--to` connects them);
 *    group -> artifacts.ts createGroup (op.members; no placement options).
 *  - op.set -> PropertySetter.set() on the new element.
 *  - batch aliases (ops/aliases.ts): op.as binds the new element (with
 *    --if-absent and an existing one: that one), op.flowAs the flow the flow
 *    options describe (into the node; a prepend before a join / unconnected
 *    node: out of it); flowAs without such a flow is E_USAGE. op.outAs binds
 *    the one sequence flow the add creates out of the node (a splice: to
 *    the old successor; a prepend: to the anchor; else: to op.to); none
 *    (an append, --in / --on / no placement without --to, a node that is
 *    no flow node) or two (a splice or prepend with --to) is E_USAGE. With
 *    --if-absent and an existing node it binds the one flow out of it; none
 *    or several (a gateway's branches) is E_USAGE too, never a guess.
 *  - a new flow out of an event-based gateway (--after, --flow, --before,
 *    or the node is the gateway) to a target BPMN 2.0 does not allow there:
 *    W_EVENT_GATEWAY_TARGET once the trigger is set (plain files; Camunda 7
 *    files get the profile's W_C7_DEPLOY_EVENT_GATEWAY, flows.ts).
 *  - ChangeSet: the node's create entry comes first, flows follow (placeNode),
 *    root Message/Error/Signal/Escalation elements created by the trigger are
 *    reported too.
 *
 * Because 'expanded' lives in DI, explicit collapse requests are recorded with
 * the Doc (Doc.layoutRequests) so the pipeline can hand them to the layouter.
 */
import type { Doc } from '../model/Doc.js';
import { CliError } from '../shared/CliError.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { ElementLabels, type AnchorContext } from '../ids/ElementLabels.js';
import { kindRequest, type IdRequest } from '../ids/utils/requests.js';
import type { ContextWord } from '../ids/utils/id-words.js';
import { FLOW_NODE_FAMILIES, KindError, kindByName, kindLabel, normalizeTrigger, parseKind, type KindDef, type ParsedKind, type Trigger } from '../model/kinds.js';
import { addTo, is, many, type El, idOf } from '../model/utils/moddle.js';
import { typeLabel } from './utils/elements.js';
import { ChangeSet, type Change } from '../model/ChangeSet.js';
import { renamedNote } from '../model/utils/renames.js';
import { createAssociation, createDataAssociation, createDataObject, createDataStore, createGroup, createTextAnnotation } from './artifacts.js';
import { assignLane, createLane, createParticipant } from './containers.js';
import { EventTrigger } from './EventTrigger.js';
import { LaneInheritance } from './LaneInheritance.js';
import { Camunda8Defaults } from '../platform/Camunda8Defaults.js';
import { FlowOptions } from './FlowOptions.js';
import type { AddOp, TriggerOptions } from './types.js';
import { StaleFlowReport } from './StaleFlowReport.js';
import { NodePlacement } from './NodePlacement.js';
import { EventGatewayRule } from './EventGatewayRule.js';
import { FlowRules } from '../model/FlowRules.js';
import { EventDefinitions } from './EventDefinitions.js';
import { RootElements } from './RootElements.js';
import { PropertySetter } from './PropertySetter.js';

/** Start triggers an event sub-process can be created with (`eventSubProcess:<trigger>`). */
const EVENT_SUBPROCESS_TRIGGERS: Trigger[] = (kindByName('startEvent')?.triggers ?? []).filter((t) => t !== 'none');

const PLACEMENT_KEYS = ['after', 'before', 'flow', 'on', 'in'] as const;

export class ElementAdder {
  constructor(private readonly doc: Doc) {}

  /** `eventSubProcess:<trigger>`: the trigger of the start event created inside it. */
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

  /** A bad kind token is a usage error (exit 1; test/cli.test.ts pins this for `add`). */
  private static resolveKind(token: string): ParsedKind {
    try {
      return parseKind(token);
    } catch (err) {
      if (!(err instanceof KindError)) throw err;
      const sub = ElementAdder.parseEventSubProcessKind(token);
      if (sub) return sub;
      const msg = err.message;
      if (/is rejected/.test(msg)) throw new CliError('E_UNSUPPORTED_KIND', msg, 'usage', { hint: 'Run `bpmn kinds` for the supported kinds.' });
      if (/^Unknown kind/.test(msg)) throw new CliError('E_UNKNOWN_KIND', msg, 'usage', { candidates: err.candidates, hint: 'Run `bpmn kinds` for the full list.' });
      throw new CliError('E_INVALID_TRIGGER', msg, 'usage', { hint: 'Use kind:trigger, e.g. startEvent:message or boundaryEvent:timer.' });
    }
  }

  /**
   * What tells an unnamed element apart: its placement (`After <anchor>`,
   * `Before <anchor>`, `After <source of the flow>`, `On <host>`; `In <scope>`
   * for a sub-process, or a pool / process of a file with several), in the
   * words of ElementLabels.anchorContext (the nearest named anchor, once; the kind of an
   * unnamed anchor it names past, for when the id would repeat the anchor's).
   */
  private placementContext(op: AddOp): AnchorContext | undefined {
    const at = (word: ContextWord, id: string | undefined): AnchorContext => {
      const el = id ? this.doc.get(id) : undefined;
      return el ? new ElementLabels(el).anchorContext(word) : { context: word };
    };
    switch (NodePlacement.modeOf(op)) {
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

  /** The id request of a new element of `def` (the --if-absent hint recomputes it); `context` replaces the placement's. */
  private elementRequest(def: KindDef, trigger: Trigger | undefined, op: AddOp, context?: AnchorContext): IdRequest {
    const where = context ?? this.placementContext(op);
    return kindRequest(def, {
      ...(def.family === 'event' && trigger && trigger !== 'none' ? { trigger } : {}),
      ...(op.name ? { name: op.name } : {}),
      ...(where ? { context: where.context, ...(where.anchorKind ? { anchorKind: where.anchorKind } : {}) } : {}),
    });
  }

  /**
   * Binds `alias` (op.outAs) to the one sequence flow the placement created
   * out of `node`, which was unconnected before it: on a splice the flow to
   * the old successor, on a prepend the flow to the anchor, else the flow to
   * op.to. None or two (a splice or prepend together with `to`) is E_USAGE.
   */
  private bindOutAs(op: AddOp, alias: string, node: El, cs: ChangeSet): void {
    const id = idOf(node);
    const out = this.doc.outgoing(node);
    if (out.length === 1) {
      cs.bind(alias, out[0]);
      return;
    }
    const mode = NodePlacement.modeOf(op);
    if (!out.length) {
      const why = mode === 'after' ? `--after ${op.after} appends it` : mode === 'none' ? 'no placement' : `--${mode}`;
      throw usageError(`outAs ${alias}: ${id} gets no flow out of it from this placement (${why})`, {
        element: id,
        hint: 'outAs names the flow an add creates out of the new node: a splice, a prepend or "to" creates one. Otherwise connect the node with a connect op that has "as".',
      });
    }
    const ends = out.map((f) => `${idOf(f)} to ${idOf(f.get<El>('targetRef'))}`).join(', ');
    throw usageError(`outAs ${alias}: ${id} gets ${out.length} flows out of it from this placement (${ends})`, {
      element: id,
      related: out.map(idOf),
      hint: `outAs names one flow: drop "to" and connect ${id} to ${op.to} with a connect op that has "as" (outAs then names the other flow).`,
    });
  }

  /**
   * --if-absent with an existing element: binds `alias` (op.outAs) to its out-flow
   * only when exactly one leaves it, so a re-run never guesses (a spliced gateway
   * gets more branches later, in any order). None, several or no flow node is E_USAGE.
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

  private static rejectPlacement(op: AddOp, allowed: ReadonlyArray<(typeof PLACEMENT_KEYS)[number] | 'to'>, kind: string): void {
    for (const key of [...PLACEMENT_KEYS, 'to'] as const) {
      if (op[key] !== undefined && !allowed.includes(key)) {
        throw modelError('E_INVALID_PLACEMENT', `--${key} does not apply to ${kind}`, {
          hint: allowed.length ? `${kind} accepts ${allowed.map((k) => `--${k}`).join(', ')} only.` : `${kind} takes no placement options.`,
        });
      }
    }
  }

  private addDocumentation(el: El, text: string | undefined): void {
    if (!text) return;
    addTo(el, 'documentation', this.doc.moddle.create('bpmn:Documentation', { text }));
  }

  /** Trigger implied by the trigger options (e.g. --timer without :timer). */
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
    return ElementAdder.inferTrigger(opts) !== undefined || opts.nonInterrupting !== undefined;
  }

  /** Send and receive tasks reference a message like message events (`--message <name>`). */
  private static takesMessage(def: KindDef): boolean {
    return def.kind === 'sendTask' || def.kind === 'receiveTask';
  }

  /** Rejects contradictory or empty flow options before anything is mutated (same rules as `apply`). */
  private checkFlowOptions(op: AddOp): void {
    new FlowOptions(op).assertConsistent();
    new FlowRules(this.doc).assertCondition(op.condition);
  }

  /** W_OPTION_IGNORED for flow options the placement could not apply. */
  private warnIgnoredFlowOptions(op: AddOp, node: El, entryFlow: El | undefined, cs: ChangeSet): void {
    const id = idOf(node);
    const mode = NodePlacement.modeOf(op);
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
    // the flow add created, or a spliced flow without id that took it (ops/flows.ts followEnds: `id added`)
    const named = (c: Change): boolean => c.kind === 'sequenceFlow' && c.id === op.flowId;
    if (op.flowId && !cs.created.some(named) && !cs.changed.some((c) => named(c) && !!c.detail?.endsWith(renamedNote('')))) {
      const entry = entryFlow ?? this.doc.incoming(node)[0];
      // with flow ids kept, a splice kept the id of the flow into the node: its W_FLOW_ID_STALE suggests --flow-id, one command for one flow
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

  /** Reports root elements (messages, errors, ...) that appeared during `fn`. */
  private reportNewRoots(cs: ChangeSet, fn: () => void): void {
    const before = new Set(many(this.doc.definitions, 'rootElements'));
    fn();
    for (const root of many(this.doc.definitions, 'rootElements')) {
      if (before.has(root)) continue;
      const name = root.get<string | undefined>('name');
      cs.create({ id: idOf(root), kind: typeLabel(root), ...(name ? { name } : {}), detail: 'root element' });
    }
  }

  private static isEventSubProcess(el: El | undefined): boolean {
    return !!el && is(el, 'bpmn:SubProcess') && !!el.get<boolean | undefined>('triggeredByEvent');
  }

  private placementDetail(op: AddOp): string {
    switch (NodePlacement.modeOf(op)) {
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
        return `in ${idOf(new NodePlacement(this.doc, op).scope())}`;
    }
  }

  /** Resolves --lane before anything is mutated (the target scope must be a process). */
  private resolveLane(op: AddOp): El | undefined {
    if (!op.lane) return undefined;
    const lane = this.doc.require(op.lane, 'bpmn:Lane', 'lane');
    const scope = new NodePlacement(this.doc, op).scope();
    if (!is(scope, 'bpmn:Process')) {
      throw modelError('E_INVALID_LANE_MEMBERSHIP', `Nodes inside sub-process ${idOf(scope)} cannot be lane members`, {
        element: op.lane,
        hint: 'Only nodes directly in the process can be assigned to lanes; drop --lane.',
      });
    }
    return lane;
  }

  private addFlowNode(op: AddOp, def: KindDef, trigger: Trigger | undefined, cs: ChangeSet, context: AnchorContext | undefined): El {
    this.checkFlowOptions(op);
    const explicitLane = this.resolveLane(op);
    const id = this.doc.edit.allocator.explicitOr(op.id, this.elementRequest(def, trigger ?? ElementAdder.inferTrigger(op), op, context));
    const el = this.doc.create(def.type, { id, ...(op.name ? { name: op.name } : {}), ...(def.props ?? {}) });
    const isEvent = def.family === 'event';
    const isEventSub = def.kind === 'eventSubProcess';
    // an event sub-process created with a trigger gets its triggered start event in the same op
    const startTrigger = isEventSub ? (trigger ?? ElementAdder.inferTrigger(op)) : undefined;
    const messageTask = ElementAdder.takesMessage(def) && op.message !== undefined;
    if (!isEvent && !startTrigger && ElementAdder.hasTriggerOptions(messageTask ? { ...op, message: undefined } : op)) {
      cs.warn({
        code: 'W_OPTION_IGNORED',
        message: isEventSub ? `Trigger options are ignored for eventSubProcess ${id}: no trigger given` : `Trigger options are ignored for ${def.kind} ${id}`,
        element: id,
        hint: isEventSub
          ? 'Use eventSubProcess:<trigger> or --error/--message/--timer/... to create the start event with the sub-process.'
          : `Trigger options apply to events only${ElementAdder.takesMessage(def) ? ' (a send / receive task takes --message)' : ''}.`,
      });
    }
    if (op.collapsed && def.family !== 'subProcess') {
      cs.warn({ code: 'W_OPTION_IGNORED', message: `--collapsed is ignored for ${def.kind} ${id}`, element: id, hint: '--collapsed applies to sub-processes only.' });
    }

    const entry = { id, kind: def.kind, ...(op.name ? { name: op.name } : {}), detail: this.placementDetail(op) };
    cs.create(entry);
    // before the placement: a splice may rename the flow op.flow names
    const inherited = explicitLane ? LaneInheritance.NONE : LaneInheritance.of(this.doc, op);
    const entryFlow = new NodePlacement(this.doc, op).place(el, cs);
    this.warnIgnoredFlowOptions(op, el, entryFlow, cs);
    if (op.flowAs) {
      // the flow the flow options describe: into the node, or out of it when `before` prepended it
      const flow = entryFlow ?? (NodePlacement.modeOf(op) === 'before' ? this.doc.outgoing(el)[0] : undefined);
      if (!flow) {
        throw usageError(`flowAs ${op.flowAs}: ${id} gets no flow from this placement (${NodePlacement.modeOf(op) === 'none' ? 'no placement' : `--${NodePlacement.modeOf(op)}`})`, {
          element: id,
          hint: 'Place the node with after / before / flow, or connect it with a connect op that has "as".',
        });
      }
      cs.bind(op.flowAs, flow);
    }
    if (op.outAs) this.bindOutAs(op, op.outAs, el, cs);

    if (isEvent) {
      let resolved = trigger ?? ElementAdder.inferTrigger(op);
      if (!resolved) {
        const scope = this.doc.scopeOf(el);
        if (is(el, 'bpmn:BoundaryEvent')) {
          throw modelError('E_TRIGGER_REQUIRED', `Boundary event ${id} needs a trigger`, {
            element: id,
            candidates: def.triggers ?? [],
            hint: `Use boundaryEvent:<trigger>, e.g. boundaryEvent:timer --timer P2D or boundaryEvent:error --error PaymentFailed.`,
          });
        }
        if (is(el, 'bpmn:StartEvent') && ElementAdder.isEventSubProcess(scope)) {
          throw modelError('E_TRIGGER_REQUIRED', `Start event ${id} inside event sub-process ${idOf(scope!)} needs a trigger`, {
            element: id,
            candidates: (def.triggers ?? []).filter((t) => t !== 'none'),
            hint: 'Use startEvent:<trigger>, e.g. startEvent:error --error PaymentFailed or startEvent:timer --timer R/PT1H.',
          });
        }
        resolved = 'none';
      }
      this.reportNewRoots(cs, () => new EventDefinitions(this.doc, el).apply(resolved, op));
      if (resolved !== 'none') entry.kind = kindLabel(el);
    }
    if (messageTask) new PropertySetter(this.doc).setTaskMessage(el, op.message ?? '', cs);
    if (new Camunda8Defaults(this.doc).userTask(el)) cs.note(`${id} is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them`);
    // a flow out of an event-based gateway the new node now ends or starts (checked once the trigger is set)
    for (const f of new Set([...this.doc.incoming(el), ...this.doc.outgoing(el)])) new EventGatewayRule(this.doc).warnFlow(f, cs);
    if (op.collapsed && def.family === 'subProcess') {
      this.doc.layoutRequests.collapse(id);
      cs.note(`${id} will be laid out collapsed`);
    }
    this.addDocumentation(el, op.doc);

    if (explicitLane) {
      assignLane(this.doc, el, explicitLane, cs);
    } else {
      const scope = this.doc.scopeOf(el);
      if (inherited.lane && scope && is(scope, 'bpmn:Process')) {
        assignLane(this.doc, el, inherited.lane, cs);
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

  /** Creates one element according to `op` and returns what changed; `idContext` is the context of an unnamed element's id when the placement does not tell it (split: `After <anchor>`). */
  add(op: AddOp, idContext?: AnchorContext): ChangeSet {
    const cs = new ChangeSet();
    const { def, trigger } = ElementAdder.resolveKind(op.kind);

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
      new RootElements(this.doc).bindRefAs(cs, op.refAs, existing);
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
        ElementAdder.rejectPlacement(op, [], 'participant');
        const before = new Set(this.doc.processes());
        el = createParticipant(this.doc, op, cs);
        // platform defaults for the process a new pool brings (C7: history time to live)
        for (const p of this.doc.processes()) if (!before.has(p)) this.doc.initProcess(p);
        break;
      }
      case 'lane':
        ElementAdder.rejectPlacement(op, ['in'], 'lane');
        el = createLane(this.doc, op, cs);
        break;
      case 'data': {
        ElementAdder.rejectPlacement(op, ['in', 'to'], def.kind);
        const scope = this.doc.requireScope(op.in);
        const opts = { ...(op.id ? { id: op.id } : {}), ...(op.name ? { name: op.name } : {}) };
        el = def.kind === 'dataStore' ? createDataStore(this.doc, scope, opts, cs) : createDataObject(this.doc, scope, opts, cs);
        if (op.to) createDataAssociation(this.doc, el, this.doc.require(op.to), {}, cs);
        break;
      }
      case 'artifact': {
        if (def.kind === 'group') {
          ElementAdder.rejectPlacement(op, [], def.kind);
          el = createGroup(this.doc, { ...(op.id ? { id: op.id } : {}), ...(op.name ? { name: op.name } : {}), ...(op.members ? { members: op.members } : {}) }, cs);
          break;
        }
        ElementAdder.rejectPlacement(op, ['in', 'to'], def.kind);
        const scope = this.doc.requireScope(op.in);
        const text = op.text ?? op.name;
        el = createTextAnnotation(this.doc, scope, { ...(op.id ? { id: op.id } : {}), ...(op.name ? { name: op.name } : {}), ...(text ? { text } : {}) }, cs);
        if (op.to) createAssociation(this.doc, this.doc.require(op.to), el, {}, cs);
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
      cs.merge(new PropertySetter(this.doc).set({ op: 'set', id: idOf(el), values: op.set }));
    }
    cs.bind(op.as, el);
    new RootElements(this.doc).bindRefAs(cs, op.refAs, el);
    this.doc.edit.allocator.reportSuffixed(cs);
    this.doc.invalidate();
    return cs;
  }
}
