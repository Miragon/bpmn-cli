/**
 * Sequence flows and node placement. This is the one place that knows the
 * placement grammar (--after / --before / --flow / --in / --on) and the
 * declaration-order conventions the layouter depends on.
 *
 * Associations on flows (e.g. a text annotation attached to a sequence
 * flow): when bridging replaces a flow by its predecessor flow, the
 * associations move along (carryAssociations, reported as changes); a flow
 * removed with a ChangeSet takes its associations with it (reported as
 * removed), so no association is ever left pointing at a removed flow.
 *
 * Speaking flow ids stay true: a flow whose id is the one the file's id
 * style gives a flow between its old ends (Flow_CheckInvoiceToDone, also
 * with a collision suffix: idNamesEnds) is renamed after its new ends when a
 * splice, a bridge, a move or `set source= / target=` changes them
 * (followEnds; its DI edge id follows when it was `<id>_di`, `BPMNEdge_<id>`
 * or `Edge_<id>`, also cut: diagram/write.ts followDiIds, which `set id=`
 * uses too). Every other id stays. With Doc.followFlowEnds false
 * (`--keep-flow-ids`, where flow ids are API) a flow the document had keeps
 * its id, and the batch reports each one whose id no longer names its ends
 * (W_FLOW_ID_STALE, reportStaleFlows). An end `set` gave another id or
 * name earlier in the batch (or the op on its own) is recognised by what it
 * was called too (Doc.recordFormerEnd), and by its name also where its id
 * speaks. A flow without id (valid BPMN, rare in files) whose ends change
 * gets an id from its new ends.
 */
import type { Doc, FlowEnds, FormerEnd, KeptFlow } from '../model/document.js';
import { followDiIds } from '../diagram/write.js';
import { modelError, type Warning } from '../shared/errors.js';
import { connectionRequest, flowRequest, formerLabels, labelOf, speakingStem, type IdRequest } from '../ids/style.js';
import { hasIdWords, IdRegistry, isSuffix, isValidId, slugify } from '../ids/slugs.js';
import { branchesByCondition, ignoresConditions, isLinkCatch, isLinkThrow, kindLabel, triggerOf } from '../model/kinds.js';
import { addTo, insertInto, is, many, removeFrom, type El } from '../model/moddle.js';
import { about, renamedNote, type ChangeSet } from '../model/change-set.js';
import type { FlowOptions, Placement } from './types.js';

export interface FlowAttrs {
  id?: string;
  name?: string;
  condition?: string;
  language?: string;
  isDefault?: boolean;
  /**
   * a sequence flow removeSequenceFlow took out, put back instead of a new
   * flow when no `id` is given (move with flow ids kept: the moved node's old
   * out-flow, ops/move.ts): it keeps its id, documentation and extensions;
   * name and condition are the ones given here
   */
  reuse?: El;
}

function idOf(el: El): string {
  return el.get<string>('id');
}

function label(el: El): string {
  const name = el.get<string | undefined>('name');
  return `${kindLabel(el)} ${idOf(el)}${name ? ` "${name}"` : ''}`;
}

/** The change entry of a sequence flow: its ends, or `detail` (the entry is about the flow: ChangeSet.rename). */
export function flowChange(flow: El, detail?: string): { id: string; kind: string; name?: string; detail: string } {
  const src = flow.get<El | undefined>('sourceRef');
  const tgt = flow.get<El | undefined>('targetRef');
  const name = flow.get<string | undefined>('name');
  return about(
    {
      id: idOf(flow),
      kind: 'sequenceFlow',
      ...(name ? { name } : {}),
      detail: detail ?? `${src ? idOf(src) : '?'} -> ${tgt ? idOf(tgt) : '?'}`,
    },
    flow,
  );
}

/* ------------------------------------------------------------------ */
/* declaration order                                                    */
/* ------------------------------------------------------------------ */

/** Inserts elements into a scope's flowElements right after `anchor` (or at the end). */
export function insertAfterInScope(scope: El, anchor: El | undefined, ...els: El[]): void {
  const list = many(scope, 'flowElements');
  for (const el of els) removeFrom(scope, 'flowElements', el);
  const idx = anchor ? list.indexOf(anchor) : -1;
  insertInto(scope, 'flowElements', idx === -1 ? list.length : idx + 1, ...els);
}

/** Inserts elements right before `anchor` (or at the end). */
export function insertBeforeInScope(scope: El, anchor: El | undefined, ...els: El[]): void {
  const list = many(scope, 'flowElements');
  for (const el of els) removeFrom(scope, 'flowElements', el);
  const idx = anchor ? list.indexOf(anchor) : -1;
  insertInto(scope, 'flowElements', idx === -1 ? list.length : idx, ...els);
}

/* ------------------------------------------------------------------ */
/* flow endpoints                                                       */
/* ------------------------------------------------------------------ */

function isEventSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess') && !!el.get<boolean | undefined>('triggeredByEvent');
}

/** True when the node may have outgoing sequence flows. */
export function canBeFlowSource(node: El): boolean {
  return is(node, 'bpmn:FlowNode') && !is(node, 'bpmn:EndEvent') && !isLinkThrow(node) && !isEventSubProcess(node);
}

/** True when the node may have incoming sequence flows. */
export function canBeFlowTarget(node: El): boolean {
  return is(node, 'bpmn:FlowNode') && !is(node, 'bpmn:StartEvent') && !is(node, 'bpmn:BoundaryEvent') && !isLinkCatch(node) && !isEventSubProcess(node);
}

/** The kind-based part of the endpoint rules (no scope check). */
export function assertFlowNodeRoles(source: El, target: El): void {
  if (!is(source, 'bpmn:FlowNode')) {
    throw modelError('E_INVALID_SOURCE', `${label(source)} cannot be the source of a sequence flow`, { element: idOf(source) });
  }
  if (!is(target, 'bpmn:FlowNode')) {
    throw modelError('E_INVALID_TARGET', `${label(target)} cannot be the target of a sequence flow`, { element: idOf(target) });
  }
  if (is(source, 'bpmn:EndEvent')) {
    throw modelError('E_INVALID_SOURCE', `End event ${idOf(source)} cannot have outgoing sequence flows`, { element: idOf(source) });
  }
  if (is(target, 'bpmn:StartEvent')) {
    throw modelError('E_INVALID_TARGET', `Start event ${idOf(target)} cannot have incoming sequence flows`, { element: idOf(target) });
  }
  if (isLinkThrow(source)) {
    throw modelError('E_INVALID_SOURCE', `Link throw event ${idOf(source)} cannot have outgoing sequence flows`, {
      element: idOf(source),
      hint: 'A link throw event ends its path; the flow continues at the link catch event of the same name. Connect from that catch event instead.',
    });
  }
  if (isLinkCatch(target)) {
    throw modelError('E_INVALID_TARGET', `Link catch event ${idOf(target)} cannot have incoming sequence flows`, {
      element: idOf(target),
      hint: 'A link catch event starts its path; the flow arrives through the link throw event of the same name. Connect to that throw event instead.',
    });
  }
  if (is(target, 'bpmn:BoundaryEvent')) {
    throw modelError('E_INVALID_TARGET', `Boundary event ${idOf(target)} cannot have incoming sequence flows`, { element: idOf(target) });
  }
  if (is(source, 'bpmn:SubProcess') && source.get<boolean | undefined>('triggeredByEvent')) {
    throw modelError('E_INVALID_SOURCE', `Event sub-process ${idOf(source)} cannot have sequence flows`, { element: idOf(source) });
  }
  if (is(target, 'bpmn:SubProcess') && target.get<boolean | undefined>('triggeredByEvent')) {
    throw modelError('E_INVALID_TARGET', `Event sub-process ${idOf(target)} cannot have sequence flows`, { element: idOf(target) });
  }
}

export function assertSequenceFlowEndpoints(doc: Doc, source: El, target: El): void {
  assertFlowNodeRoles(source, target);
  const sScope = doc.scopeOf(source);
  const tScope = doc.scopeOf(target);
  if (!sScope || !tScope || sScope !== tScope) {
    throw modelError(
      'E_CROSS_SCOPE',
      `Sequence flows cannot cross scopes: ${idOf(source)} is in ${sScope ? idOf(sScope) : '?'}, ${idOf(target)} in ${tScope ? idOf(tScope) : '?'}`,
      {
        element: idOf(source),
        related: [idOf(target)],
        hint: 'Use a message flow between pools, or move the node with `bpmn move <file> <id> --in <scope>`.',
      },
    );
  }
}

/* ------------------------------------------------------------------ */
/* event-based gateway targets                                          */
/* ------------------------------------------------------------------ */

/** Triggers an event-based gateway may wait for (an intermediate catch event with one of them). */
const EVENT_GATEWAY_TRIGGERS = ['message', 'timer', 'signal', 'conditional'];

/** Name of the message / signal a catch event waits for (the engines subscribe by name), else undefined. */
function subscriptionOf(event: El): { kind: 'message' | 'signal'; name: string } | undefined {
  const trigger = triggerOf(event);
  if (trigger !== 'message' && trigger !== 'signal') return undefined;
  const def = (event.get<El[] | undefined>('eventDefinitions') ?? [])[0];
  const ref = def?.get<El | undefined>(trigger === 'message' ? 'messageRef' : 'signalRef');
  if (!ref) return undefined;
  return { kind: trigger, name: ref.get<string | undefined>('name') ?? idOf(ref) };
}

/**
 * Why `target` cannot become the target of a new sequence flow from the
 * event-based gateway `gateway` (undefined = it can). The rule depends on the
 * file (eventGatewayRule):
 *
 * Camunda 7 files (Camunda 7, CIB seven and Operaton each reject the
 * deployment otherwise):
 *  - only an intermediateCatchEvent with a message, timer, signal or
 *    conditional trigger (not a receive task, task, end or throw event, plain
 *    or link catch event);
 *  - it has no other incoming sequence flow (also not a second one from the
 *    gateway);
 *  - no two branches wait for the same message name or signal name.
 *
 * Every other file follows BPMN 2.0 (10.6.6, Event-Based Gateway):
 *  - an intermediateCatchEvent whose triggers are message, timer, signal or
 *    conditional, or a receive task (without boundary events);
 *  - no other incoming sequence flow;
 *  - message catch events and receive tasks are not mixed behind one gateway.
 *
 * `leaving` are flows that disappear with the change (the flow into `target`
 * that a bridge replaces, the gateway's flow it re-points, a flow just created
 * for `target`).
 */
export function eventGatewayTargetProblem(doc: Doc, gateway: El, target: El, leaving: El[] = []): string | undefined {
  return eventGatewayRule(doc) === 'engines' ? engineTargetProblem(doc, gateway, target, leaving) : bpmnTargetProblem(doc, gateway, target, leaving);
}

/** Which event-gateway rule a file follows: the Camunda 7 engines' (a Camunda 7 / CIB seven / Operaton file) or BPMN 2.0's. */
export function eventGatewayRule(doc: Doc): 'engines' | 'bpmn' {
  return doc.platform() === 'camunda7' ? 'engines' : 'bpmn';
}

/** The other incoming flows of an event-gateway target (a problem text), or undefined. */
function otherIncoming(doc: Doc, target: El, leaving: El[], what: string): string | undefined {
  const others = doc.incoming(target).filter((f) => !leaving.includes(f));
  if (!others.length) return undefined;
  return `${label(target)} already has the incoming flow ${others.map(idOf).join(', ')}; ${what} after an event-based gateway can have no other incoming flow`;
}

function engineTargetProblem(doc: Doc, gateway: El, target: El, leaving: El[]): string | undefined {
  if (!is(target, 'bpmn:IntermediateCatchEvent')) {
    return `${label(target)} is not an intermediate catch event; an event-based gateway can only lead to message, timer, signal or conditional catch events`;
  }
  const trigger = triggerOf(target) ?? 'none';
  if (!EVENT_GATEWAY_TRIGGERS.includes(trigger)) {
    return `${label(target)} is a ${trigger === 'none' ? 'plain' : trigger} catch event; an event-based gateway can only wait for a message, timer, signal or condition`;
  }
  const incoming = otherIncoming(doc, target, leaving, 'a catch event');
  if (incoming) return incoming;
  const mine = subscriptionOf(target);
  if (mine) {
    for (const f of doc.outgoing(gateway)) {
      if (leaving.includes(f)) continue;
      const t = f.get<El | undefined>('targetRef');
      if (!t || t === target) continue;
      const theirs = subscriptionOf(t);
      if (theirs && theirs.kind === mine.kind && theirs.name === mine.name) {
        return `${idOf(t)} on another branch of ${idOf(gateway)} already waits for the ${mine.kind} "${mine.name}"; the engines allow one subscription per ${mine.kind} name and gateway`;
      }
    }
  }
  return undefined;
}

/** True for a catch event waiting for a message (any of its event definitions). */
function waitsForMessage(el: El): boolean {
  return is(el, 'bpmn:IntermediateCatchEvent') && (el.get<El[] | undefined>('eventDefinitions') ?? []).some((d) => is(d, 'bpmn:MessageEventDefinition'));
}

function bpmnTargetProblem(doc: Doc, gateway: El, target: El, leaving: El[]): string | undefined {
  const receive = is(target, 'bpmn:ReceiveTask');
  if (!receive && !is(target, 'bpmn:IntermediateCatchEvent')) {
    return `${label(target)} is neither an intermediate catch event nor a receive task; BPMN 2.0 lets an event-based gateway lead only to message, timer, signal or conditional catch events and receive tasks`;
  }
  if (!receive) {
    const defs = target.get<El[] | undefined>('eventDefinitions') ?? [];
    const allowed = ['bpmn:MessageEventDefinition', 'bpmn:TimerEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:ConditionalEventDefinition'];
    if (!defs.length || defs.some((d) => !allowed.some((t) => is(d, t)))) {
      const trigger = triggerOf(target) ?? 'none';
      return `${label(target)} is a ${trigger === 'none' ? 'plain' : trigger} catch event; after an event-based gateway BPMN 2.0 allows message, timer, signal and conditional catch events only`;
    }
  }
  const incoming = otherIncoming(doc, target, leaving, receive ? 'a receive task' : 'a catch event');
  if (incoming) return incoming;
  if (receive && doc.boundaryEventsOf(target).length) {
    return `${label(target)} has boundary events (${doc.boundaryEventsOf(target).map(idOf).join(', ')}); BPMN 2.0 does not allow them on a receive task after an event-based gateway`;
  }
  if (receive || waitsForMessage(target)) {
    for (const f of doc.outgoing(gateway)) {
      if (leaving.includes(f)) continue;
      const t = f.get<El | undefined>('targetRef');
      if (!t || t === target) continue;
      if (receive ? waitsForMessage(t) : is(t, 'bpmn:ReceiveTask')) {
        return `${idOf(t)} on another branch of ${idOf(gateway)} is a ${receive ? 'message catch event' : 'receive task'}; BPMN 2.0 does not mix receive tasks and message catch events behind one event-based gateway`;
      }
    }
  }
  return undefined;
}

/**
 * W_EVENT_GATEWAY_TARGET for a sequence flow just created out of an
 * event-based gateway (connect, add) to a target BPMN 2.0 does not allow
 * there. Camunda 7 files are left to the platform profile, which reports the
 * engines' rule (W_C7_DEPLOY_EVENT_GATEWAY) on every write; an explicit edge is
 * the agent's call and only warned about, a bridge that would create it is
 * refused (E_INVALID_BRIDGE, ops/remove.ts).
 */
export function warnEventGatewayFlow(doc: Doc, flow: El, cs: ChangeSet): void {
  const gateway = flow.get<El | undefined>('sourceRef');
  const target = flow.get<El | undefined>('targetRef');
  if (!gateway || !target || !is(gateway, 'bpmn:EventBasedGateway') || eventGatewayRule(doc) === 'engines') return;
  const problem = bpmnTargetProblem(doc, gateway, target, [flow]);
  if (!problem) return;
  cs.warn({
    code: 'W_EVENT_GATEWAY_TARGET',
    message: `Event-based gateway ${idOf(gateway)} now leads to ${idOf(target)} (${idOf(flow)}): ${problem}`,
    element: idOf(gateway),
    related: [idOf(target), idOf(flow)],
    hint: `Put a catch event in front of ${idOf(target)}: \`bpmn add <file> intermediateCatchEvent:timer "<Name>" --flow ${idOf(flow)} --timer PT1H\` (or :message --message <Name>), or remove the flow (\`bpmn remove <file> ${idOf(flow)}\`).`,
  });
}

/* ------------------------------------------------------------------ */
/* create / remove / redirect                                           */
/* ------------------------------------------------------------------ */

function conditionExpression(doc: Doc, expr: string, language?: string): El {
  return doc.moddle.create('bpmn:FormalExpression', { body: expr, ...(language ? { language } : {}) });
}

export function assertCondition(expr: string | undefined): void {
  if (expr !== undefined && !expr.trim()) {
    throw modelError('E_INVALID_VALUE', 'The condition expression is empty', {
      hint: 'Shell expansion may have eaten it: quote expressions with single quotes, e.g. --condition \'${ok}\'.',
    });
  }
}

function assertConditionTaken(source: El, expr: string | undefined, flowId?: string): void {
  if (!expr || !ignoresConditions(source)) return;
  throw modelError('E_INVALID_VALUE', `A flow out of ${idOf(source)} cannot have a condition: a ${kindLabel(source)} ${is(source, 'bpmn:ParallelGateway') ? 'always takes all of its outgoing paths' : 'takes the path of the event that happens first'}`, {
    ...(flowId ? { element: flowId } : {}),
    hint: `Branch by condition with an exclusive gateway instead: \`bpmn retype <file> ${idOf(source)} exclusiveGateway\`.`,
  });
}

/** Removes the condition of each flow out of `source` when it ignores conditions (parallel / event-based gateway): W_CONDITION_DROPPED. */
export function dropIgnoredConditions(doc: Doc, source: El, cs: ChangeSet, flows: El[] = doc.outgoing(source)): void {
  if (!ignoresConditions(source)) return;
  for (const flow of flows) {
    if (!flow.get<El | undefined>('conditionExpression')) continue;
    flow.set('conditionExpression', undefined);
    cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(flow)} was dropped: a ${kindLabel(source)} takes no conditions`, element: idOf(flow), related: [idOf(source)] });
  }
  doc.invalidate();
}

/**
 * Creates a sequence flow source -> target, maintains incoming/outgoing and
 * declaration order (the flow is declared right after its source unless
 * `declareAfter` says otherwise). With `attrs.reuse` (and no `attrs.id`)
 * that flow is put back instead and keeps its id (followEnds records it for
 * W_FLOW_ID_STALE when its id named its old ends).
 */
export function createSequenceFlow(doc: Doc, source: El, target: El, attrs: FlowAttrs = {}, declareAfter?: El): El {
  assertSequenceFlowEndpoints(doc, source, target);
  assertCondition(attrs.condition);
  assertConditionTaken(source, attrs.condition, attrs.id);
  const scope = doc.scopeOf(source)!;
  const reuse = attrs.id ? undefined : attrs.reuse;
  // the ends the put-back flow had: its id may name them (followEnds)
  const oldSource = reuse?.get<El | undefined>('sourceRef');
  const oldTarget = reuse?.get<El | undefined>('targetRef');
  let flow: El;
  if (reuse) {
    flow = reuse;
    if (idOf(flow)) doc.ids.claim(idOf(flow));
    flow.set('name', attrs.name || undefined);
    flow.set('conditionExpression', attrs.condition ? conditionExpression(doc, attrs.condition, attrs.language) : undefined);
    flow.set('sourceRef', source);
    flow.set('targetRef', target);
  } else {
    let id = attrs.id;
    if (id) doc.claimId(id);
    else id = doc.allocateId(flowRequest('bpmn:SequenceFlow', source, target)).id;
    flow = doc.create('bpmn:SequenceFlow', {
      id,
      ...(attrs.name ? { name: attrs.name } : {}),
      sourceRef: source,
      targetRef: target,
      ...(attrs.condition ? { conditionExpression: conditionExpression(doc, attrs.condition, attrs.language) } : {}),
    });
  }
  addTo(source, 'outgoing', flow);
  addTo(target, 'incoming', flow);
  insertAfterInScope(scope, declareAfter ?? lastFlowOf(scope, source) ?? source, flow);
  if (attrs.isDefault) setDefaultFlow(doc, flow, true);
  doc.invalidate();
  if (reuse) followEnds(doc, flow, oldSource, oldTarget);
  return flow;
}

/** The last declared outgoing flow of `source` inside `scope` (keeps branch order tidy). */
function lastFlowOf(scope: El, source: El): El | undefined {
  const list = many(scope, 'flowElements');
  let last: El | undefined;
  for (const el of list) {
    if (is(el, 'bpmn:SequenceFlow') && el.get<El | undefined>('sourceRef') === source) last = el;
  }
  return last;
}

/** Associations (e.g. of text annotations) attached to a flow. */
function associationsOf(doc: Doc, flow: El): El[] {
  return [...doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && (a.get<El | undefined>('sourceRef') === flow || a.get<El | undefined>('targetRef') === flow));
}

/**
 * Re-attaches the associations of `from` to `to` (bridging: the annotation
 * stays on the flow that replaces `from`). Returns the ones it re-attached.
 */
export function carryAssociations(doc: Doc, from: El, to: El, cs: ChangeSet): El[] {
  const carried = associationsOf(doc, from);
  for (const a of carried) {
    for (const end of ['sourceRef', 'targetRef']) if (a.get<El | undefined>(end) === from) a.set(end, to);
    cs.change({ id: idOf(a), kind: 'association', detail: `re-attached from ${idOf(from)} to ${idOf(to)}` });
  }
  doc.invalidate();
  return carried;
}

/** Removes the associations attached to a flow that is being removed (reported). */
function dropAssociations(doc: Doc, flow: El, cs: ChangeSet): void {
  for (const a of associationsOf(doc, flow)) {
    const parent = a.$parent as El | undefined;
    if (parent) removeFrom(parent, 'artifacts', a);
    doc.ids.release(idOf(a));
    cs.remove({ id: idOf(a), kind: 'association' });
  }
  doc.invalidate();
}

/**
 * Removes a sequence flow from its scope and from every mirror list of the
 * scope's nodes: its endpoints' and stale entries a modeler file may carry on
 * other nodes (which would otherwise dangle). With a ChangeSet, the
 * associations attached to it are removed too (reported); without one the
 * caller resolves them (remove's cascade).
 */
export function removeSequenceFlow(doc: Doc, flow: El, cs?: ChangeSet): void {
  if (cs) dropAssociations(doc, flow, cs);
  const source = flow.get<El | undefined>('sourceRef');
  if (source && source.get<El | undefined>('default') === flow) source.set('default', undefined);
  const scope = flow.$parent as El | undefined;
  const nodes = scope ? many(scope, 'flowElements').filter((n) => is(n, 'bpmn:FlowNode')) : [];
  for (const node of new Set([source, flow.get<El | undefined>('targetRef'), ...nodes])) {
    if (!node) continue;
    removeFrom(node, 'outgoing', flow);
    removeFrom(node, 'incoming', flow);
  }
  if (scope) removeFrom(scope, 'flowElements', flow);
  doc.ids.release(idOf(flow));
  doc.invalidate();
}

/**
 * The labels a flow id may name an end by (idNamesEnds): how ids name it
 * now (labelOf), the speaking part of its id (an end renamed since), its
 * name also where its id speaks (Activity_Verify, named Check, after `set
 * id=`; left out where it gives the same words as one of the others), and
 * how earlier versions named an unnamed end (formerLabels).
 */
export function endLabels(el: El): string[] {
  const labels = [labelOf(el), speakingStem(idOf(el)), ...formerLabels(el)].filter((l): l is string => !!l);
  const name = el.get<string | undefined>('name');
  if (hasIdWords(name) && !labels.some((l) => l === name || (!l.includes('_') && slugify(l) === slugify(name)))) labels.push(name!);
  return [...new Set(labels)];
}

/**
 * Records what `node` is called as a flow end before `set` gives it another
 * id or name (ops/set.ts; Doc.recordFormerEnd): a flow whose id named it so
 * is still renamed, or with ids kept reported, when a later op of the batch
 * changes its ends. Only a node with sequence flows.
 */
export function recordFormerEnd(doc: Doc, node: El): void {
  if (!is(node, 'bpmn:FlowNode') || !(many(node, 'incoming').length || many(node, 'outgoing').length)) return;
  doc.recordFormerEnd(node, { id: idOf(node), labels: endLabels(node) });
}

/**
 * Whether `id` is the id the file's style gives a sequence flow between
 * `source` and `target` (or the one any other flow prefix or form of the
 * file's flows gives it: also the `named` one earlier versions gave it, and
 * one under a prefix a tie outvoted), or such an id with a collision
 * suffix: the ends named by their names or (an end renamed since) by their
 * ids, also as earlier versions named an unnamed end (by its kind:
 * Flow_CheckToGateway), before the length cap and as 0.6 cut it
 * (IdStyle.derivedBases, given `id`: only the styles it can be of); an end
 * `set` renamed or named earlier in the batch also as it was called then
 * (its id and labels, Doc.formerEndsOf). False for a flow without id. The
 * one test behind a rename (followEnds) and a stale id (staleFlowWarning).
 */
export function idNamesEnds(doc: Doc, id: string | undefined, source: El, target: El): boolean {
  if (!id) return false;
  const derived = (base: string): boolean => id === base || (id.startsWith(base) && isSuffix(base, id.slice(base.length), 'either'));
  const names = (el: El): FormerEnd[] => [{ id: idOf(el), labels: endLabels(el) }, ...doc.formerEndsOf(el)];
  const targets = names(target);
  return names(source).some((s) =>
    targets.some((t) => s.labels.some((a) => t.labels.some((b) => doc.idStyle.derivedBases(connectionRequest('bpmn:SequenceFlow', s.id, t.id, { sourceLabel: a, targetLabel: b }), id).some(derived)))),
  );
}

/**
 * Renames a flow whose id named its old ends (idNamesEnds) after its new
 * ends, together with a DI edge id derived from it; returns the old id when
 * it renamed the flow. A flow with any other id keeps it. With ids kept
 * (Doc.followFlowEnds false) a flow the document had before the batch or the
 * op on its own (Doc.flowsBefore) keeps its id too and is recorded for
 * W_FLOW_ID_STALE (reportStaleFlows); one the batch created is nobody's API
 * yet and still follows its ends. A flow without id gets one in both modes
 * (its change entry and the layout name it by it): `wanted`, the id an op
 * asked for it (`add --flow-id` on a splice: the flow into the new node;
 * claimed like the id of a flow add creates), else one from its new ends;
 * returns `''` (renamedNote: `id added`).
 */
export function followEnds(doc: Doc, flow: El, oldSource: El | undefined, oldTarget: El | undefined, wanted?: string): string | undefined {
  if (!is(flow, 'bpmn:SequenceFlow') || !oldSource || !oldTarget) return undefined;
  const source = flow.get<El | undefined>('sourceRef');
  const target = flow.get<El | undefined>('targetRef');
  if (!source || !target || (source === oldSource && target === oldTarget)) return undefined;
  const old = idOf(flow);
  if (!old) {
    if (wanted) doc.claimId(wanted);
    flow.set('id', wanted || doc.allocateId(flowRequest('bpmn:SequenceFlow', source, target)).id);
    doc.invalidate();
    return '';
  }
  if (!idNamesEnds(doc, old, oldSource, oldTarget)) return undefined;
  const oldIds = [idOf(oldSource), idOf(oldTarget)] as const;
  if (doc.keepsFlowId(flow)) {
    doc.recordKeptFlow(flow, `${oldIds[0]} -> ${oldIds[1]}`);
    return undefined;
  }
  doc.ids.release(old);
  const id = doc.allocateId(flowRequest('bpmn:SequenceFlow', source, target)).id;
  if (id === old) return undefined;
  flow.set('id', id);
  doc.recordRename(old, id, `${oldIds[0]} -> ${oldIds[1]}`, flow);
  followEdgeId(doc, flow, old, id);
  return old;
}

/** The DI edge of a flow renamed `old` -> `id` follows where its id was derived from the flow's (`<id>_di`, `BPMNEdge_<id>`, `Edge_<id>`; diagram/write.ts followDiIds). */
function followEdgeId(doc: Doc, flow: El, old: string, id: string): void {
  followDiIds(doc.definitions, flow, old, id, doc.ids);
  doc.invalidate();
}

/** The request a connection's id is built from (its type, its ends). */
function connectionRequestOf(flow: El): IdRequest {
  return flowRequest(flow.$type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', flow.get<El>('sourceRef'), flow.get<El>('targetRef'));
}

/**
 * The sequence and message flows at `node` whose id the batch (or the op on
 * its own) generated from their ends as they are now (Doc.generatedBase is
 * the base their ends give): nobody's API yet, so they follow when the batch
 * gives `node` another id (ops/set.ts recordIdState; followRenamedEnd).
 * Call it before the rename.
 */
export function flowsNamedAfter(doc: Doc, node: El): El[] {
  const flows = new Set([...many(node, 'incoming'), ...many(node, 'outgoing')]);
  for (const root of many(doc.definitions, 'rootElements')) {
    if (!is(root, 'bpmn:Collaboration')) continue;
    for (const f of many(root, 'messageFlows')) if (f.get<El | undefined>('sourceRef') === node || f.get<El | undefined>('targetRef') === node) flows.add(f);
  }
  return [...flows].filter((f) => {
    const base = doc.generatedBase(idOf(f));
    return base !== undefined && !!f.get<El | undefined>('sourceRef') && !!f.get<El | undefined>('targetRef') && base === doc.idStyle.derivedBase(connectionRequestOf(f));
  });
}

/**
 * Renames a flow flowsNamedAfter found after its ends, once one of them
 * took another id (the regenerated id of an element the batch created and
 * retyped, ops/set.ts recordIdState): the id its ends give now (a taken
 * one with a suffix, W_ID_SUFFIXED), its DI edge id with it; `was`: the
 * ends before (`A -> B`). None where its ends give the id it has.
 */
export function followRenamedEnd(doc: Doc, flow: El, was: string): void {
  const old = idOf(flow);
  const req = connectionRequestOf(flow);
  if (doc.idStyle.derivedBase(req) === doc.generatedBase(old)) return;
  doc.ids.release(old);
  const id = doc.allocateId(req).id;
  if (id === old) return;
  flow.set('id', id);
  doc.recordRegenerated(old, id, was, flow);
  followEdgeId(doc, flow, old, id);
}

/**
 * W_FLOW_ID_STALE for a flow followEnds kept whose id named its ends `was`
 * (`A -> B`): undefined when the flow is gone, its id names its ends again
 * (a later op restored them), it ends where it did when the batch began
 * (`began`: it was stale before, this change did not make it so) or the
 * batch renamed it since (`set id=`: the id it chose). The hint names the id
 * its ends give now, or the id an op wanted for it while it still ends where
 * that op put it (`add --flow-id` on a splice: KeptFlow.preferred, a valid
 * id that is free), which the document does not claim: renaming it is the
 * human's call, together with the code that uses the id. `hinted`
 * (reportStaleFlows): the document's ids and those of the hints before; the
 * hint's id is free there and is added.
 */
export function staleFlowWarning(doc: Doc, flow: El, { was, id: keptId, preferred }: KeptFlow, hinted?: IdRegistry, began?: FlowEnds): Warning | undefined {
  const id = idOf(flow);
  const source = flow.get<El | undefined>('sourceRef');
  const target = flow.get<El | undefined>('targetRef');
  if (id !== keptId || doc.get(id) !== flow || !source || !target || idNamesEnds(doc, id, source, target)) return undefined;
  if (began?.[0] === source && began[1] === target) return undefined;
  const taken = hinted ?? doc.ids;
  const wanted = preferred?.target === target && isValidId(preferred.id) && !taken.has(preferred.id) && !doc.has(preferred.id) ? preferred.id : undefined;
  const suggested = wanted ?? doc.idStyle.next(flowRequest('bpmn:SequenceFlow', source, target), taken).id;
  hinted?.claim(suggested);
  return {
    code: 'W_FLOW_ID_STALE',
    message: `Flow ${id} kept its id, which names its old ends ${was}; it now runs ${idOf(source)} -> ${idOf(target)}`,
    element: id,
    related: [idOf(source), idOf(target)],
    hint: `Code and tests that use the id keep working; to rename it together with them: \`bpmn set <file> ${id} id=${suggested}\`.`,
  };
}

/**
 * W_FLOW_ID_STALE on `cs` for every flow kept since the last call whose id
 * no longer names its ends (ops/index.ts: once per batch, against its final
 * state; `before`: the flows and their ends when it began, Doc.flowsBefore).
 * Each hint's id is kept from the later ones, so two flows that now run
 * between the same ends get the id and the `_2` the default rename gives
 * them, and following every hint never collides.
 */
export function reportStaleFlows(doc: Doc, cs: ChangeSet, before?: ReadonlyMap<El, FlowEnds>): void {
  const kept = doc.takeKeptFlows();
  if (!kept.size) return;
  const hinted = new IdRegistry(doc.ids.values());
  for (const [flow, was] of kept) {
    const warning = staleFlowWarning(doc, flow, was, hinted, before?.get(flow));
    if (warning) cs.warn(warning);
    else if (was.preferred) restoreFlowIdHints(doc, cs, flow, was.id);
  }
}

/**
 * The hint of add's W_OPTION_IGNORED for `--flow-id <flowId>` on a splice,
 * whose flow into the node is the existing `entry`: the command that renames
 * it; `deferred` (with ids kept, a splice that kept the flow,
 * Doc.preferFlowId): that its W_FLOW_ID_STALE names the command, one for the
 * flow (reportStaleFlows puts the command back where none comes).
 */
export function flowIdIgnoredHint(flowId: string, entry: string | undefined, deferred = false): string {
  const rename = !entry ? '' : deferred ? `; W_FLOW_ID_STALE names the command that renames ${entry}` : `; rename the existing one with \`bpmn set <file> ${entry} id=${flowId}\``;
  return `--flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node)${rename}.`;
}

/**
 * A kept flow `id` gets no W_FLOW_ID_STALE (its id still names its ends, a
 * later op put it back or renamed it): the W_OPTION_IGNORED hints that
 * deferred to it (flowIdIgnoredHint) name the command that renames it
 * again, while the flow still has that id and the --flow-id is free, else
 * none.
 */
function restoreFlowIdHints(doc: Doc, cs: ChangeSet, flow: El, id: string): void {
  cs.warnings = cs.warnings.map((w) => {
    const flowId = w.code === 'W_OPTION_IGNORED' ? /^--flow-id (\S+) ignored/.exec(w.message)?.[1] : undefined;
    if (!flowId || w.hint !== flowIdIgnoredHint(flowId, id, true)) return w;
    const still = doc.get(id) === flow && !doc.has(flowId);
    return { ...w, hint: flowIdIgnoredHint(flowId, still ? id : undefined) };
  });
}

/** ` (renamed from <old>)` for a change detail when followEnds renamed the flow (model/change-set.ts, where a takeover drops it again). */
export { renamedNote };

export function redirectFlow(doc: Doc, flow: El, ends: { source?: El; target?: El }): string | undefined {
  const source = ends.source ?? flow.get<El>('sourceRef');
  const target = ends.target ?? flow.get<El>('targetRef');
  assertSequenceFlowEndpoints(doc, source, target);
  const oldSource = flow.get<El | undefined>('sourceRef');
  const oldTarget = flow.get<El | undefined>('targetRef');
  if (oldSource && oldSource !== source) {
    removeFrom(oldSource, 'outgoing', flow);
    if (oldSource.get<El | undefined>('default') === flow) oldSource.set('default', undefined);
  }
  if (oldTarget && oldTarget !== target) removeFrom(oldTarget, 'incoming', flow);
  flow.set('sourceRef', source);
  flow.set('targetRef', target);
  addTo(source, 'outgoing', flow);
  addTo(target, 'incoming', flow);
  doc.invalidate();
  return followEnds(doc, flow, oldSource, oldTarget);
}

export function setDefaultFlow(doc: Doc, flow: El, isDefault: boolean): void {
  const source = flow.get<El>('sourceRef');
  if (isDefault) {
    if (!branchesByCondition(source) && !is(source, 'bpmn:Activity')) {
      throw modelError('E_INVALID_DEFAULT', `Only exclusive/inclusive/complex gateways and activities can have a default flow (${idOf(source)} is a ${kindLabel(source)})`, {
        element: idOf(flow),
      });
    }
    source.set('default', flow);
    if (flow.get<El | undefined>('conditionExpression')) flow.set('conditionExpression', undefined);
  } else if (source.get<El | undefined>('default') === flow) {
    source.set('default', undefined);
  }
  doc.invalidate();
}

export function setFlowCondition(doc: Doc, flow: El, expr: string | undefined, language?: string): void {
  assertCondition(expr);
  assertConditionTaken(flow.get<El>('sourceRef'), expr, idOf(flow));
  if (expr) {
    flow.set('conditionExpression', conditionExpression(doc, expr, language));
    const source = flow.get<El | undefined>('sourceRef');
    if (source?.get<El | undefined>('default') === flow) source.set('default', undefined);
  } else {
    flow.set('conditionExpression', undefined);
  }
  doc.invalidate();
}

/* ------------------------------------------------------------------ */
/* splice / detach                                                      */
/* ------------------------------------------------------------------ */

/**
 * Inserts `node` into `flow` (A -> B becomes A -> node -> B). The original
 * flow keeps its attributes (and its id, unless the id named A and B:
 * followEnds; `renamedFrom`, `''` for a flow without id that got one,
 * `flowId` when given) and now ends at `node`; a new plain flow node -> B is
 * created, or `reuse` is put back as it (createSequenceFlow).
 */
export function spliceIntoFlow(doc: Doc, flow: El, node: El, reuse?: El, flowId?: string): { first: El; second: El; renamedFrom?: string } {
  const target = flow.get<El>('targetRef');
  const scope = doc.scopeOf(flow)!;
  const source = flow.get<El>('sourceRef');
  // never produce an invalid model: both new flows must be legal before anything is touched
  assertFlowNodeRoles(source, node);
  assertFlowNodeRoles(node, target);
  // declaration order: node right after the original flow's source, then the flows
  insertAfterInScope(scope, lastFlowOf(scope, source) ?? source, node);
  removeFrom(target, 'incoming', flow);
  flow.set('targetRef', node);
  addTo(node, 'incoming', flow);
  const renamedFrom = followEnds(doc, flow, source, target, flowId);
  const second = createSequenceFlow(doc, node, target, reuse ? { reuse } : {}, node);
  doc.invalidate();
  return { first: flow, second, ...(renamedFrom !== undefined ? { renamedFrom } : {}) };
}

/**
 * A bridge detachNode made: the node's in-flow (`flow`), now running to the
 * successor, the out-flow it replaced (`from`, removed) and what it took
 * over from that one: the name and the condition where it had none, the
 * associations of its annotations.
 */
export interface Bridge {
  flow: El;
  from: El;
  took: { name?: string; condition?: El; associations: El[] };
}

/**
 * Removes every sequence flow of `node`. With `bridge`, a node with exactly
 * one incoming and one outgoing flow is bypassed: the incoming flow is
 * retargeted to the successor (label/condition of the outgoing flow are
 * carried over when the incoming flow has none). Returns the bridge, or
 * undefined when it did not bridge.
 */
export function detachNode(doc: Doc, node: El, bridge: boolean, cs: ChangeSet): Bridge | undefined {
  const incoming = doc.incoming(node);
  const outgoing = doc.outgoing(node);
  if (bridge && incoming.length === 1 && outgoing.length === 1) {
    const inFlow = incoming[0]!;
    const outFlow = outgoing[0]!;
    const successor = outFlow.get<El>('targetRef');
    const predecessor = inFlow.get<El>('sourceRef');
    if (successor !== node && predecessor !== node) {
      const outName = outFlow.get<string | undefined>('name');
      const outCond = outFlow.get<El | undefined>('conditionExpression');
      const took: Bridge['took'] = { associations: [] };
      if (outName && !inFlow.get<string | undefined>('name')) {
        inFlow.set('name', outName);
        took.name = outName;
      } else if (outName) cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${idOf(node)}`, element: idOf(outFlow) });
      if (outCond && !inFlow.get<El | undefined>('conditionExpression')) {
        inFlow.set('conditionExpression', outCond);
        took.condition = outCond;
      } else if (outCond) cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${idOf(node)}`, element: idOf(outFlow) });
      took.associations = carryAssociations(doc, outFlow, inFlow, cs);
      removeSequenceFlow(doc, outFlow, cs);
      cs.remove(flowChange(outFlow));
      const renamed = redirectFlow(doc, inFlow, { target: successor });
      cs.change(flowChange(inFlow, `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${idOf(node)})${renamedNote(renamed)}`));
      cs.note(`bridged: ${idOf(predecessor)} -> ${idOf(successor)}`);
      return { flow: inFlow, from: outFlow, took };
    }
  }
  // a self-loop is both incoming and outgoing: remove and report it once
  for (const f of new Set([...incoming, ...outgoing])) {
    cs.remove(flowChange(f));
    removeSequenceFlow(doc, f, cs);
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* placement                                                            */
/* ------------------------------------------------------------------ */

export type PlacementOptions = Placement & FlowOptions & { to?: string };

/**
 * A compensation handler (isForCompensation=true) cannot carry boundary
 * events: Camunda 7, CIB seven and Operaton reject the deployment ("Invalid
 * reference in boundary event"). Neither can an event sub-process: it has no
 * place in the flow to interrupt or leave (bpmn-js does not attach to one).
 */
export function assertBoundaryHost(host: El, boundary?: El): void {
  if (host.get<boolean | undefined>('isForCompensation')) {
    throw modelError('E_INVALID_HOST', `${label(host)} is a compensation handler (isForCompensation=true); it cannot carry boundary events`, {
      element: boundary ? idOf(boundary) : idOf(host),
      related: [idOf(host)],
      hint: `Attach the boundary event to the activity that is compensated, or make ${idOf(host)} a normal activity first (\`bpmn set <file> ${idOf(host)} isForCompensation=false\`).`,
    });
  }
  if (isEventSubProcess(host)) {
    throw modelError('E_INVALID_HOST', `${label(host)} is an event sub-process; it cannot carry boundary events`, {
      element: boundary ? idOf(boundary) : idOf(host),
      related: [idOf(host)],
      hint: `Attach the boundary event to an activity in the flow; an event sub-process is triggered by its start event (\`bpmn add <file> eventSubProcess:<trigger> "<Name>" --in <scope>\`).`,
    });
  }
}

function requireFlowBetween(doc: Doc, a: El, b: El): El {
  const flows = doc.outgoing(a).filter((f) => f.get<El | undefined>('targetRef') === b);
  if (flows.length === 1) return flows[0]!;
  if (!flows.length) {
    throw modelError('E_NO_FLOW', `There is no sequence flow ${idOf(a)} -> ${idOf(b)}`, { element: idOf(a), related: [idOf(b)] });
  }
  throw modelError('E_AMBIGUOUS_FLOW', `There are ${flows.length} flows ${idOf(a)} -> ${idOf(b)}; use --flow <flowId>`, {
    element: idOf(a),
    candidates: flows.map(idOf),
  });
}

/** Which placement flags are set. */
export function placementMode(p: Placement): 'after' | 'before' | 'between' | 'flow' | 'in' | 'on' | 'none' {
  if (p.after && p.before) return 'between';
  if (p.after) return 'after';
  if (p.before) return 'before';
  if (p.flow) return 'flow';
  if (p.on) return 'on';
  if (p.in) return 'in';
  return 'none';
}

/** The scope a placement targets (without mutating anything). */
export function placementScope(doc: Doc, p: Placement): El {
  const mode = placementMode(p);
  switch (mode) {
    case 'after':
    case 'between':
      return doc.scopeOf(doc.require(p.after!, 'bpmn:FlowNode')) ?? doc.defaultScope();
    case 'before':
      return doc.scopeOf(doc.require(p.before!, 'bpmn:FlowNode')) ?? doc.defaultScope();
    case 'flow':
      return doc.scopeOf(doc.require(p.flow!, 'bpmn:SequenceFlow', 'sequence flow')) ?? doc.defaultScope();
    case 'on':
      return doc.scopeOf(doc.require(p.on!, 'bpmn:Activity', 'activity')) ?? doc.defaultScope();
    case 'in':
      return doc.requireScope(p.in);
    default:
      return doc.defaultScope();
  }
}

/** The flow options of a placement (name, condition, default) on the flow into the node, reported as changed when one was given. */
export function applyFlowOptions(doc: Doc, flow: El, opts: FlowOptions, cs: ChangeSet): void {
  let touched = false;
  if (opts.flowName !== undefined) {
    flow.set('name', opts.flowName || undefined);
    touched = true;
  }
  if (opts.condition !== undefined) {
    setFlowCondition(doc, flow, opts.condition, opts.language);
    touched = true;
  }
  if (opts.default) {
    setDefaultFlow(doc, flow, true);
    touched = true;
  }
  if (touched) cs.change(flowChange(flow));
}

const FLOW_OPTION_FLAGS: Array<[keyof FlowOptions, string]> = [
  ['flowName', '--flow-name'],
  ['flowId', '--flow-id'],
  ['condition', '--condition'],
  ['language', '--language'],
  ['default', '--default'],
];

function usedFlowOptions(p: FlowOptions): string[] {
  return FLOW_OPTION_FLAGS.filter(([key]) => p[key] !== undefined && p[key] !== false).map(([, flag]) => flag);
}

/**
 * Refuses to splice a node that cannot sit inside a flow (start / end events,
 * event sub-processes) with an error that names the way out.
 */
function assertSpliceable(doc: Doc, node: El, flow: El): void {
  const src = flow.get<El>('sourceRef');
  const tgt = flow.get<El>('targetRef');
  const scope = doc.scopeOf(flow);
  const scopeId = scope ? idOf(scope) : '<scope>';
  const kind = kindLabel(node);
  if (!canBeFlowSource(node)) {
    throw modelError('E_INVALID_PLACEMENT', `${kind} ${idOf(node)} cannot be inserted into the flow ${idOf(src)} -> ${idOf(tgt)}: it cannot have outgoing sequence flows`, {
      element: idOf(node),
      related: [idOf(flow)],
      hint: `${idOf(src)} already flows to ${idOf(tgt)}. Create the ${kind} unconnected and branch to it: \`bpmn add <file> ${kind} "<name>" --in ${scopeId}\` then \`bpmn connect <file> ${idOf(src)} <newId>\`, or split ${idOf(src)} with a gateway (\`apply\` op "split").`,
    });
  }
  if (!canBeFlowTarget(node)) {
    throw modelError('E_INVALID_PLACEMENT', `${kind} ${idOf(node)} cannot be inserted into the flow ${idOf(src)} -> ${idOf(tgt)}: it cannot have incoming sequence flows`, {
      element: idOf(node),
      related: [idOf(flow)],
      hint: `${idOf(tgt)} already has the predecessor ${idOf(src)}. Create the ${kind} unconnected: \`bpmn add <file> ${kind} "<name>" --in ${scopeId}\` then \`bpmn connect <file> <newId> ${idOf(tgt)}\`.`,
    });
  }
}

/**
 * Splices `node` into `flow` and reports it. `flow` (now source -> node) is
 * the flow into the node, so it takes the flow options; it keeps its id
 * (`add` warns when --flow-id was given for it), and one without id takes
 * --flow-id. `outFlow`: put back as the flow node -> old target (placeNode
 * `reuse`).
 */
function spliceWithOptions(doc: Doc, node: El, flow: El, p: PlacementOptions, cs: ChangeSet, outFlow?: El): El {
  assertSpliceable(doc, node, flow);
  const src = flow.get<El>('sourceRef');
  const tgt = flow.get<El>('targetRef');
  const { second, renamedFrom } = spliceIntoFlow(doc, flow, node, outFlow, p.flowId);
  cs.create(flowChange(second));
  cs.change(flowChange(flow, `${idOf(src)} -> ${idOf(node)} (was -> ${idOf(tgt)})${renamedNote(renamedFrom)}`));
  cs.note(`inserted between ${idOf(src)} and ${idOf(tgt)}`);
  applyFlowOptions(doc, flow, p, cs);
  return flow;
}

/**
 * Places a flow node according to the placement grammar. The node must not
 * yet be connected. Boundary events use `on`. Returns the flow into the node
 * (if any) so callers can report it. `reuse` (move with flow ids kept,
 * ops/move.ts): the old out-flow of a moved node, taken out by the detach,
 * for a flow the placement creates out of that node (the flow node -> old
 * target of a splice, a prepend's node -> anchor, an append's anchor ->
 * node); it is put back instead and reported as created like a new one
 * (ops/move.ts turns that into a change).
 *
 * Rules for `after X`:
 *   - X is a gateway or has no outgoing flow  -> append: X -> node
 *   - X has exactly one outgoing flow          -> splice into it: X -> node -> old target
 *   - otherwise                                -> E_HAS_SUCCESSOR (use --flow)
 * `before Y` is symmetric (join gateways / nodes without incoming flow get node -> Y).
 */
export function placeNode(doc: Doc, node: El, p: PlacementOptions, cs: ChangeSet, reuse?: (source: El) => El | undefined): El | undefined {
  const mode = placementMode(p);
  const scope = placementScope(doc, p);
  let entryFlow: El | undefined;
  const outFlow = reuse?.(node);
  const reused = (source: El): { reuse?: El } => {
    const flow = source === node ? outFlow : reuse?.(source);
    return flow ? { reuse: flow } : {};
  };

  if (mode === 'on') {
    const host = doc.require(p.on!, 'bpmn:Activity', 'activity');
    if (!is(node, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_PLACEMENT', `--on attaches boundary events only; ${kindLabel(node)} cannot be attached to ${idOf(host)}`, {
        element: idOf(node),
        hint: 'Use --after / --before / --in for other nodes.',
      });
    }
    assertBoundaryHost(host, node);
    node.set('attachedToRef', host);
    const boundaries = doc.boundaryEventsOf(host);
    insertAfterInScope(scope, boundaries[boundaries.length - 1] ?? host, node);
    cs.note(`attached to ${idOf(host)}`);
  } else if (is(node, 'bpmn:BoundaryEvent')) {
    throw modelError('E_INVALID_PLACEMENT', 'Boundary events must be placed with --on <activityId>', { element: idOf(node) });
  } else if (mode === 'in' || mode === 'none') {
    insertAfterInScope(scope, undefined, node);
  } else if (mode === 'flow') {
    const flow = doc.require(p.flow!, 'bpmn:SequenceFlow', 'sequence flow');
    entryFlow = spliceWithOptions(doc, node, flow, p, cs, outFlow);
  } else if (mode === 'between') {
    const a = doc.require(p.after!, 'bpmn:FlowNode');
    const b = doc.require(p.before!, 'bpmn:FlowNode');
    const flow = requireFlowBetween(doc, a, b);
    entryFlow = spliceWithOptions(doc, node, flow, p, cs, outFlow);
  } else if (mode === 'after') {
    const anchor = doc.require(p.after!, 'bpmn:FlowNode');
    const out = doc.outgoing(anchor);
    if (is(anchor, 'bpmn:Gateway') || out.length === 0) {
      insertAfterInScope(scope, lastFlowOf(scope, anchor) ?? anchor, node);
      entryFlow = createSequenceFlow(doc, anchor, node, { ...flowAttrs(p), ...reused(anchor) }, node);
      cs.create(flowChange(entryFlow));
      cs.note(`appended after ${idOf(anchor)}`);
    } else if (out.length === 1) {
      entryFlow = spliceWithOptions(doc, node, out[0]!, p, cs, outFlow);
    } else {
      throw modelError('E_HAS_SUCCESSOR', `${idOf(anchor)} already has ${out.length} outgoing flows; say which one to insert into`, {
        element: idOf(anchor),
        candidates: out.map(idOf),
        hint: `Use --flow <flowId> (one of ${out.map(idOf).join(', ')}) or --after ${idOf(anchor)} --before <targetId>.`,
      });
    }
  } else if (mode === 'before') {
    const anchor = doc.require(p.before!, 'bpmn:FlowNode');
    const inc = doc.incoming(anchor);
    const isJoin = is(anchor, 'bpmn:Gateway') && inc.length >= 2;
    if (inc.length === 0 || isJoin) {
      // prepend: no flow into the node exists; the flow options go to the one flow this creates (node -> anchor)
      insertBeforeInScope(scope, anchor, node);
      const flow = createSequenceFlow(doc, node, anchor, { ...flowAttrs(p), ...reused(node) }, node);
      cs.create(flowChange(flow));
      cs.note(`prepended before ${idOf(anchor)}`);
      const used = usedFlowOptions(p);
      if (used.length) {
        cs.note(`${used.join(', ')} applied to ${idOf(flow)} (${idOf(node)} -> ${idOf(anchor)}): ${idOf(anchor)} ${isJoin ? 'is a join gateway' : 'had no incoming flow'}, so no flow into ${idOf(node)} was created`);
      }
    } else if (inc.length === 1) {
      entryFlow = spliceWithOptions(doc, node, inc[0]!, p, cs, outFlow);
    } else {
      throw modelError('E_HAS_PREDECESSOR', `${idOf(anchor)} already has ${inc.length} incoming flows; say which one to insert into`, {
        element: idOf(anchor),
        candidates: inc.map(idOf),
        hint: `Use --flow <flowId> (one of ${inc.map(idOf).join(', ')}) or --after <sourceId> --before ${idOf(anchor)}.`,
      });
    }
  }

  if (p.to) {
    const target = doc.require(p.to, 'bpmn:FlowNode');
    const flow = createSequenceFlow(doc, node, target, {}, undefined);
    cs.create(flowChange(flow));
    if (!is(target, 'bpmn:Gateway') && doc.incoming(target).length > 1) {
      cs.warn({
        code: 'W_IMPLICIT_JOIN',
        message: `${idOf(target)} now has ${doc.incoming(target).length} incoming flows (implicit join)`,
        element: idOf(target),
        hint: 'Consider joining through a gateway.',
      });
    }
  }
  doc.invalidate();
  return entryFlow;
}

function flowAttrs(p: FlowOptions): FlowAttrs {
  return {
    ...(p.flowId ? { id: p.flowId } : {}),
    ...(p.flowName ? { name: p.flowName } : {}),
    ...(p.condition ? { condition: p.condition } : {}),
    ...(p.language ? { language: p.language } : {}),
    ...(p.default ? { isDefault: true } : {}),
  };
}
