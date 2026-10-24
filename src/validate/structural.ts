/**
 * Structural validation (errors block writes) and lint (warnings).
 *
 * CONTRACT (implemented in the "view" work package):
 *  errors (E_*): dangling references (sourceRef/targetRef/attachedToRef/
 *    processRef/default/flowNodeRef missing from the tree), duplicate ids
 *    among BPMN/DI elements (vendor extension ids are not checked), sequence flow crossing scopes or with invalid endpoints (see
 *    assertSequenceFlowEndpoints rules), boundary event without valid host in
 *    the same scope, default flow not an outgoing flow of its node, node in
 *    more than one lane / lane member not a flow node of that process,
 *    message flow inside one pool or with non-InteractionNode endpoints,
 *    collaboration without any participant with processRef, several root
 *    processes without a collaboration (E_MULTIPLE_ROOTS), process not
 *    referenced by any participant when a collaboration exists
 *    (E_ORPHAN_PROCESS), unsupported kinds (isRejectedType), event trigger
 *    matrix violations, non-interrupting on error/cancel/compensate boundary
 *    events, cancel end events outside transactions, event sub-process
 *    without a start event / with a plain start event.
 *  warnings (W_* / L*): no start event / no end event in a process, unreachable
 *    nodes, non-end node without outgoing flow, xor/or gateway without a
 *    question name (ends with ?) , xor branches without names, named
 *    parallel/join gateways, node not in any lane when lanes exist,
 *    implicit splits/joins, event-based gateway targets that are not catch
 *    events / receive tasks, empty sub-process, duplicate names of same kind.
 *  Each finding: { code, message, element, related?, hint }.
 *  Before checking, validateDoc normalises the derived incoming/outgoing
 *  mirror lists (optional in BPMN 2.0): a sequence flow missing from
 *  sourceRef.outgoing / targetRef.incoming is added there (repairFlowLinks),
 *  in memory only (a write keeps the file's lists, see model/utils/mirror.ts);
 *  E_FLOW_LINKS is reserved for entries that contradict a flow's endpoints.
 *  Hints name real command lines (`bpmn <cmd> <file> ...`).
 *
 * Error codes emitted here:
 *   E_DUPLICATE_ID, E_DANGLING_REF, E_MULTIPLE_ROOTS, E_EMPTY_COLLABORATION,
 *   E_ORPHAN_PROCESS, E_UNSUPPORTED_KIND, E_FLOW_LINKS, E_CROSS_SCOPE (and the
 *   other codes of assertSequenceFlowEndpoints: E_INVALID_SOURCE,
 *   E_INVALID_TARGET), E_NO_HOST, E_INVALID_HOST, E_INVALID_TRIGGER,
 *   E_INVALID_DEFAULT, E_EVENT_SUBPROCESS_NO_START,
 *   E_EVENT_SUBPROCESS_PLAIN_START, E_LANE_CONFLICT, E_INVALID_LANE_MEMBER,
 *   E_INVALID_MESSAGE_FLOW, E_MESSAGE_FLOW_SAME_POOL.
 * Warning codes:
 *   W_NO_START, W_NO_END, W_UNREACHABLE, W_DEAD_END, W_GATEWAY_NAME,
 *   W_BRANCH_NAME, W_NAMED_JOIN, W_NAMED_PARALLEL, W_NOT_IN_LANE,
 *   W_IMPLICIT_SPLIT, W_IMPLICIT_JOIN, W_EVENT_GATEWAY_TARGET,
 *   W_EMPTY_SUBPROCESS, W_DUPLICATE_NAME.
 *
 * Platform profile (src/platform/): with `validateDoc(doc, { platform })` the
 * engine-specific rules of the detected (or given) platform run too and their
 * findings (W_C7_* / W_C8_*, each with a severity: deploy / runtime /
 * practice) follow the lint warnings; `result.platform` says which platform
 * was checked and how it was detected. The rules load on demand: the caller
 * loads them first (loadProfile; the async pipeline does), else this throws
 * E_PROFILE_NOT_LOADED. A lint warning that a shown platform finding repeats with
 * the engine's verdict is dropped (W_EVENT_GATEWAY_TARGET, W_NO_START,
 * W_EMPTY_SUBPROCESS).
 * Without the option nothing changes (show, library callers).
 * Mutations report only the profile findings a change introduced
 * (validate/FindingBaseline.ts, withProfile + profileDelta).
 */
import type { Doc } from '../model/Doc.js';
import { isCliError } from '../shared/utils/errors.js';
import { type Warning } from '../shared/CliError.js';
import { ignoresConditions, isLinkCatch, isLinkThrow, isRejectedType, kindLabel, kindOf, triggerOf, type Trigger } from '../model/kinds.js';
import { completeMirrorLists } from '../model/utils/mirror.js';
import { is, walk, type El, peek, list, shownId } from '../model/utils/moddle.js';
import { assertSequenceFlowEndpoints } from '../ops/flows.js';
import { runProfile, summarize, type PlatformChoice, type PlatformSummary, type ProfileFinding, type ProfileReport } from '../platform/profiles/profile.js';
import type { ValidatorReport } from './validators.js';

export interface ValidationResult {
  errors: Warning[];
  warnings: Warning[];
  /** the platform profile that ran (validateDoc with a platform option, mutations); its findings are among the warnings */
  platform?: PlatformSummary;
  /** the validators that ran (MutationOptions.validators, CheckOptions.validators; src/validate/validators.ts); their findings are among the errors / warnings */
  validators?: ValidatorReport[];
}

export interface ValidateOptions {
  /** run the platform profile: 'auto' detects the platform, 'c7' / 'c8' / 'none' force one; omitted = no profile (its rules must be loaded: loadProfile) */
  platform?: PlatformChoice;
}

/** Flow order of one scope, shared by the view and the lint rules. */
export interface FlowOrder {
  /** flow nodes in flow order (attached boundary events are left out: they hang off their host) */
  ordered: El[];
  /** nodes that no start event (or, without start events, no entry node) reaches */
  unreachable: Set<El>;
}

interface Ctx {
  doc: Doc;
  errors: Warning[];
  warnings: Warning[];
}

/* ------------------------------------------------------------------ */
/* small read helpers (never create lazy collections)                  */
/* ------------------------------------------------------------------ */




function nameOf(el: El): string | undefined {
  const n = peek<string>(el, 'name');
  return n ? String(n) : undefined;
}

/** `userTask Activity_X "name"` for messages. */
function describe(el: El): string {
  const name = nameOf(el);
  return `${kindLabel(el)} ${shownId(el)}${name ? ` "${name}"` : ''}`;
}

function isDi(el: El): boolean {
  return /^(bpmndi|di|dc):/.test(el.$type);
}

function isEventSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess') && peek<boolean>(el, 'triggeredByEvent') === true;
}

function isScope(el: El): boolean {
  return is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess');
}

/** Every process and (nested) sub-process, in tree order. */
function scopesOf(doc: Doc): El[] {
  return [...walk(doc.definitions)].filter(isScope);
}

function pushFinding(target: Warning[], code: string, message: string, element: string | undefined, extra: { related?: string[]; hint?: string } = {}): void {
  const finding: Warning = { code, message };
  if (element) finding.element = element;
  if (extra.related?.length) finding.related = extra.related;
  if (extra.hint) finding.hint = extra.hint;
  target.push(finding);
}

/* ------------------------------------------------------------------ */
/* flow order / reachability                                            */
/* ------------------------------------------------------------------ */

/** Boundary event that is not attached to an activity of `scope` (treated like a plain node). */
function isOrphanBoundary(doc: Doc, el: El, scope: El): boolean {
  if (!is(el, 'bpmn:BoundaryEvent')) return false;
  const host = peek<El>(el, 'attachedToRef');
  return !host || !doc.flowElements(scope).includes(host);
}

/** The link name of a link event (its LinkEventDefinition name), if any. */
function linkNameOf(el: El): string | undefined {
  const def = list(el, 'eventDefinitions').find((d) => is(d, 'bpmn:LinkEventDefinition'));
  const name = def ? peek<unknown>(def, 'name') : undefined;
  return typeof name === 'string' && name ? name : undefined;
}

/** Catching link events of a scope by link name (a throwing link continues there). */
function linkCatchesOf(nodes: El[]): Map<string, El[]> {
  const out = new Map<string, El[]>();
  for (const n of nodes) {
    const name = isLinkCatch(n) ? linkNameOf(n) : undefined;
    if (name) out.set(name, [...(out.get(name) ?? []), n]);
  }
  return out;
}

/**
 * Targets of a node's outgoing flows, then of its boundary events' outgoing
 * flows (declaration order); a throwing link event continues at the catching
 * link events with the same link name.
 */
function successors(doc: Doc, node: El, linkCatches: Map<string, El[]>): El[] {
  const out: El[] = [];
  for (const f of doc.outgoing(node)) {
    const t = peek<El>(f, 'targetRef');
    if (t) out.push(t);
  }
  if (is(node, 'bpmn:Activity')) {
    for (const b of doc.boundaryEventsOf(node)) {
      for (const f of doc.outgoing(b)) {
        const t = peek<El>(f, 'targetRef');
        if (t) out.push(t);
      }
    }
  }
  if (isLinkThrow(node)) {
    const name = linkNameOf(node);
    if (name) out.push(...(linkCatches.get(name) ?? []));
  }
  return out;
}

/**
 * Flow order of a scope: depth-first from its start events (or, when it has
 * none, from every node without incoming flows), following outgoing flows in
 * declaration order and link throw -> link catch pairs; then the remaining
 * nodes (unreachable ones flagged). Event sub-processes, compensation
 * handlers and the nodes of an ad-hoc sub-process (every node is an entry
 * point there) are never flagged.
 */
export function flowOrder(doc: Doc, scope: El): FlowOrder {
  const nodes = doc.flowNodes(scope).filter((n) => !is(n, 'bpmn:BoundaryEvent') || isOrphanBoundary(doc, n, scope));
  const members = new Set(nodes);
  const linkCatches = linkCatchesOf(nodes);
  const starts = nodes.filter((n) => is(n, 'bpmn:StartEvent'));
  const ordered: El[] = [];
  const seen = new Set<El>();
  const visit = (node: El): void => {
    if (seen.has(node) || !members.has(node)) return;
    seen.add(node);
    ordered.push(node);
    for (const next of successors(doc, node, linkCatches)) visit(next);
  };
  const entries = starts.length ? starts : nodes.filter((n) => doc.incoming(n).length === 0);
  for (const e of entries) visit(e);
  const reachable = new Set(seen);
  for (const n of nodes) if (doc.incoming(n).length === 0) visit(n);
  for (const n of nodes) visit(n);
  const unreachable = new Set<El>();
  if (!is(scope, 'bpmn:AdHocSubProcess')) {
    for (const n of nodes) {
      if (reachable.has(n)) continue;
      if (isEventSubProcess(n) || peek<boolean>(n, 'isForCompensation') === true || is(n, 'bpmn:BoundaryEvent')) continue;
      unreachable.add(n);
    }
  }
  return { ordered, unreachable };
}

/* ------------------------------------------------------------------ */
/* normalisation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Adds every sequence flow to `sourceRef.outgoing` / `targetRef.incoming`
 * where it is missing. BPMN 2.0 makes those mirror lists optional (they are
 * derivable from sourceRef/targetRef) and hand-written or generated files
 * routinely omit them, while the placement grammar, the view and the lint
 * read them. The completion is in memory only: a write keeps the lists the
 * way the file kept them (model/utils/mirror.ts unkeptEntries), so no entry is written
 * for an unchanged flow of a file that omits it. Doc.fromXml completes the
 * lists when it reads a document; this repeats it for a model changed in
 * memory. Idempotent; returns the number of entries added. Entries that
 * contradict a flow's endpoints are left alone and reported as E_FLOW_LINKS.
 */
export function repairFlowLinks(doc: Doc): number {
  return completeMirrorLists(doc.definitions);
}

/* ------------------------------------------------------------------ */
/* structural errors                                                    */
/* ------------------------------------------------------------------ */

/** Duplicate ids among BPMN and DI elements; vendor extension ids (e.g. camunda:formField) are scoped by their vendor and not checked. */
function checkDuplicateIds(ctx: Ctx): void {
  const counts = new Map<string, number>();
  for (const el of walk(ctx.doc.definitions, { bpmnOnly: true })) {
    const id = peek<string>(el, 'id');
    if (typeof id === 'string' && id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    if (n > 1) {
      pushFinding(ctx.errors, 'E_DUPLICATE_ID', `Id "${id}" is used by ${n} elements`, id, {
        hint: 'Ids must be unique. Edit the XML or remove one of the elements with `bpmn remove <file> <id>` and re-create it with another --id.',
      });
    }
  }
  // a duplicate in the file's text: bpmn-moddle keeps the first element and drops the later one (an import warning), so the model shows one
  const seen = new Set<string>();
  for (const w of ctx.doc.importWarnings) {
    const m = /duplicate ID <([^>]*)>/.exec(w.message);
    if (!m || seen.has(m[1]!) || (counts.get(m[1]!) ?? 0) > 1) continue;
    seen.add(m[1]!);
    const dropped = /^unparsable content <([^>]+)>/.exec(w.message)?.[1];
    const line = /\bline: (\d+)/.exec(w.message)?.[1];
    pushFinding(ctx.errors, 'E_DUPLICATE_ID', `Id "${m[1]}" is used by more than one element of the file${dropped ? ` (the later <${dropped}>${line ? ` at line ${line}` : ''} cannot be read)` : ''}; the engines refuse the file`, m[1], {
      hint: 'Ids must be unique: give one of the elements another id in the XML (the model holds only the first, so a write would drop the other).',
    });
  }
}

function checkReferences(ctx: Ctx): void {
  const index = ctx.doc.byId();
  for (const holder of walk(ctx.doc.definitions)) {
    const descriptor = holder.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean; isMany?: boolean }> };
    if (descriptor.isGeneric || isDi(holder)) continue;
    for (const p of descriptor.properties ?? []) {
      if (!p.isReference) continue;
      const v = peek<unknown>(holder, p.name);
      const targets = p.isMany ? (Array.isArray(v) ? (v as El[]) : []) : v ? [v as El] : [];
      for (const target of targets) {
        const tid = peek<string>(target, 'id');
        if (!tid || index.get(tid) === target) continue;
        pushFinding(ctx.errors, 'E_DANGLING_REF', `${describe(holder)} references ${p.name}="${tid}", which is not in the model`, shownId(holder), {
          related: [tid],
          hint: `Remove ${shownId(holder)} with \`bpmn remove <file> ${shownId(holder)}\` or re-create the missing element "${tid}".`,
        });
      }
    }
  }
  for (const el of walk(ctx.doc.definitions)) {
    if (!is(el, 'bpmn:SequenceFlow') && !is(el, 'bpmn:MessageFlow') && !is(el, 'bpmn:Association')) continue;
    for (const end of ['sourceRef', 'targetRef']) {
      if (!peek<El>(el, end)) {
        pushFinding(ctx.errors, 'E_DANGLING_REF', `${describe(el)} has no ${end === 'sourceRef' ? 'source' : 'target'} (unresolved reference)`, shownId(el), {
          hint: `Remove it with \`bpmn remove <file> ${shownId(el)}\` and re-connect with \`bpmn connect <file> <sourceId> <targetId>\`.`,
        });
      }
    }
  }
}

function checkRoots(ctx: Ctx): void {
  const { doc } = ctx;
  const processes = doc.processes();
  const collab = doc.collaboration();
  if (!collab && processes.length > 1) {
    pushFinding(ctx.errors, 'E_MULTIPLE_ROOTS', `The file has ${processes.length} root processes but no collaboration; only one can be laid out`, shownId(processes[1]), {
      related: processes.map(shownId),
      hint: 'Wrap every process in a pool in one transaction, `bpmn apply <file> ops.json` with `{"op":"add","kind":"participant","name":"<Name>","process":"<processId>"}` per process (one at a time needs --force until the last one), or remove the extra process.',
    });
  }
  if (!collab) return;
  const bound = doc.participants().filter((p) => !!peek<El>(p, 'processRef'));
  if (!bound.length) {
    pushFinding(ctx.errors, 'E_EMPTY_COLLABORATION', `Collaboration ${shownId(collab)} has no participant with a process (only black boxes or none at all)`, shownId(collab), {
      hint: 'Add a participant with a process: `bpmn add <file> participant "<Name>" --process <processId>`.',
    });
  }
  for (const p of processes) {
    if (!doc.participantOf(p)) {
      pushFinding(ctx.errors, 'E_ORPHAN_PROCESS', `Process ${shownId(p)} is not referenced by any participant of ${shownId(collab)}`, shownId(p), {
        hint: `Bind it to a pool: \`bpmn add <file> participant "<Name>" --process ${shownId(p)}\`, or remove it.`,
      });
    }
  }
}

function checkSequenceFlow(ctx: Ctx, flow: El, scope: El): void {
  const source = peek<El>(flow, 'sourceRef');
  const target = peek<El>(flow, 'targetRef');
  if (!source || !target) return; // reported by checkReferences
  try {
    assertSequenceFlowEndpoints(ctx.doc, source, target);
  } catch (err) {
    if (!isCliError(err)) throw err;
    pushFinding(ctx.errors, err.code, err.message, shownId(flow), { related: [shownId(source), shownId(target)], hint: err.details.hint });
    return;
  }
  if (is(source, 'bpmn:BoundaryEvent') && triggerOf(source) === 'compensate') {
    pushFinding(ctx.errors, 'E_INVALID_SOURCE', `Compensate boundary event ${shownId(source)} cannot have outgoing sequence flows (${shownId(flow)} -> ${shownId(target)})`, shownId(flow), {
      related: [shownId(source), shownId(target)],
      hint: `The compensation handler is linked by an association, not a sequence flow: \`bpmn remove <file> ${shownId(flow)}\`, then \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
    });
  }
  const ends: Array<[El, string, string]> = [
    [source, 'E_INVALID_SOURCE', 'source'],
    [target, 'E_INVALID_TARGET', 'target'],
  ];
  for (const [end, code, role] of ends) {
    if (peek<boolean>(end, 'isForCompensation') !== true) continue;
    pushFinding(ctx.errors, code, `Compensation handler ${describe(end)} cannot be the ${role} of a sequence flow (${shownId(flow)})`, shownId(flow), {
      related: [shownId(source), shownId(target)],
      hint: `A compensation handler hangs off a compensate boundary event by association only: \`bpmn remove <file> ${shownId(flow)}\`, or make it a normal activity with \`bpmn set <file> ${shownId(end)} isForCompensation=false\`.`,
    });
  }
  const endpointScope = ctx.doc.scopeOf(source);
  if (endpointScope && endpointScope !== scope) {
    pushFinding(ctx.errors, 'E_CROSS_SCOPE', `${describe(flow)} is declared in ${shownId(scope)} but connects nodes of ${shownId(endpointScope)}`, shownId(flow), {
      related: [shownId(source), shownId(target)],
      hint: `Remove the flow with \`bpmn remove <file> ${shownId(flow)}\` and re-create it with \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
    });
  }
}

function outgoingOf(node: El): El[] {
  return list(node, 'outgoing');
}

function incomingOf(node: El): El[] {
  return list(node, 'incoming');
}

function checkFlowLinks(ctx: Ctx, node: El): void {
  for (const f of incomingOf(node)) {
    if (is(f, 'bpmn:SequenceFlow') && peek<El>(f, 'targetRef') !== node) {
      pushFinding(ctx.errors, 'E_FLOW_LINKS', `${describe(node)} lists ${shownId(f)} as incoming, but the flow targets ${shownId(peek<El>(f, 'targetRef'))}`, shownId(node), {
        related: [shownId(f)],
        hint: `incoming/outgoing must mirror sourceRef/targetRef: delete the stale <bpmn:incoming>${shownId(f)}</bpmn:incoming> entry from ${shownId(node)} in the XML (missing entries are added automatically).`,
      });
    }
  }
  for (const f of outgoingOf(node)) {
    if (is(f, 'bpmn:SequenceFlow') && peek<El>(f, 'sourceRef') !== node) {
      pushFinding(ctx.errors, 'E_FLOW_LINKS', `${describe(node)} lists ${shownId(f)} as outgoing, but the flow starts at ${shownId(peek<El>(f, 'sourceRef'))}`, shownId(node), {
        related: [shownId(f)],
        hint: `incoming/outgoing must mirror sourceRef/targetRef: delete the stale <bpmn:outgoing>${shownId(f)}</bpmn:outgoing> entry from ${shownId(node)} in the XML (missing entries are added automatically).`,
      });
    }
  }
}

const NON_INTERRUPTING_FORBIDDEN: Trigger[] = ['error', 'cancel', 'compensate'];
const EVENT_SUBPROCESS_ONLY_STARTS: Trigger[] = ['error', 'escalation', 'compensate'];

function checkEvent(ctx: Ctx, el: El, scope: El): void {
  const def = kindOf(el);
  if (!def?.triggers) return;
  const trigger = triggerOf(el);
  const eventDefs = list(el, 'eventDefinitions');
  if (!trigger) {
    pushFinding(ctx.errors, 'E_INVALID_TRIGGER', `${describe(el)} has an unsupported event definition ${eventDefs[0]?.$type ?? ''}`, shownId(el), {
      hint: `Allowed triggers for ${def.kind}: ${def.triggers.join(', ')}. Change it with \`bpmn set <file> ${shownId(el)} trigger=<trigger>\`.`,
    });
    return;
  }
  if (!def.triggers.includes(trigger)) {
    pushFinding(ctx.errors, 'E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def.kind} ${shownId(el)}`, shownId(el), {
      hint: `Allowed triggers for ${def.kind}: ${def.triggers.join(', ')}. Change it with \`bpmn set <file> ${shownId(el)} trigger=<trigger>\` or retype the event.`,
    });
    return;
  }
  if (is(el, 'bpmn:StartEvent')) {
    const inEventSub = isEventSubProcess(scope);
    if (EVENT_SUBPROCESS_ONLY_STARTS.includes(trigger) && !inEventSub) {
      pushFinding(ctx.errors, 'E_INVALID_TRIGGER', `startEvent:${trigger} ${shownId(el)} is only allowed inside an event sub-process`, shownId(el), {
        hint: 'Move it into an eventSubProcess (`bpmn add <file> eventSubProcess "<Name>" --in <scope>`, then `bpmn move <file> <id> --in <eventSubProcessId>`) or use trigger none/message/timer/signal/conditional.',
      });
    } else if (!inEventSub && is(scope, 'bpmn:SubProcess') && trigger !== 'none') {
      pushFinding(ctx.errors, 'E_INVALID_TRIGGER', `startEvent:${trigger} ${shownId(el)} inside embedded sub-process ${shownId(scope)} must have no trigger`, shownId(el), {
        hint: `Use \`bpmn set <file> ${shownId(el)} trigger=none\`; triggered starts belong to the process or to an event sub-process.`,
      });
    }
    if (!inEventSub && peek<boolean>(el, 'isInterrupting') === false) {
      pushFinding(ctx.errors, 'E_INVALID_TRIGGER', `Non-interrupting start event ${shownId(el)} is only allowed inside an event sub-process`, shownId(el), {
        hint: `Use \`bpmn set <file> ${shownId(el)} nonInterrupting=false\`.`,
      });
    }
  }
  if (is(el, 'bpmn:EndEvent') && trigger === 'cancel' && !is(scope, 'bpmn:Transaction')) {
    pushFinding(ctx.errors, 'E_INVALID_TRIGGER', `endEvent:cancel ${shownId(el)} is only allowed inside a transaction sub-process`, shownId(el), {
      hint: 'Use a transaction (`bpmn add <file> transaction "<Name>" ...`) or another end trigger (none, error, terminate, ...).',
    });
  }
}

function checkBoundaryEvent(ctx: Ctx, el: El, scope: El): void {
  const host = peek<El>(el, 'attachedToRef');
  if (!host) {
    pushFinding(ctx.errors, 'E_NO_HOST', `${describe(el)} is not attached to any activity`, shownId(el), {
      hint: `Boundary events need a host: \`bpmn remove <file> ${shownId(el)}\` and re-add it with --on <activityId>.`,
    });
    return;
  }
  if (!is(host, 'bpmn:Activity')) {
    pushFinding(ctx.errors, 'E_INVALID_HOST', `${describe(el)} is attached to ${describe(host)}, which is not an activity`, shownId(el), {
      related: [shownId(host)],
      hint: 'Boundary events attach to tasks, sub-processes and call activities only.',
    });
    return;
  }
  if (ctx.doc.scopeOf(host) !== scope) {
    pushFinding(ctx.errors, 'E_INVALID_HOST', `${describe(el)} is declared in ${shownId(scope)} but its host ${shownId(host)} is in ${shownId(ctx.doc.scopeOf(host))}`, shownId(el), {
      related: [shownId(host)],
      hint: `Move the boundary event next to its host: \`bpmn remove <file> ${shownId(el)}\` and re-add it with --on ${shownId(host)}.`,
    });
  }
  // like a sequence flow out of a compensation handler (checkSequenceFlow): bpmn-js does not attach
  // boundary events to one, and Camunda 7 / CIB seven / Operaton refuse the file
  if (peek<boolean>(host, 'isForCompensation') === true) {
    pushFinding(ctx.errors, 'E_INVALID_HOST', `${describe(el)} is attached to ${shownId(host)}, a compensation handler (isForCompensation=true), which cannot carry boundary events`, shownId(el), {
      related: [shownId(host)],
      hint: `Remove it (\`bpmn remove <file> ${shownId(el)}\`), attach it to a normal activity (\`bpmn move <file> ${shownId(el)} --on <activityId>\`), or make ${shownId(host)} a normal activity (\`bpmn set <file> ${shownId(host)} isForCompensation=false\`).`,
    });
  }
  // an event sub-process has no place in the flow to interrupt or leave; bpmn-js does not attach to one either
  if (isEventSubProcess(host)) {
    pushFinding(ctx.errors, 'E_INVALID_HOST', `${describe(el)} is attached to ${shownId(host)}, an event sub-process, which cannot carry boundary events`, shownId(el), {
      related: [shownId(host)],
      hint: `Remove it (\`bpmn remove <file> ${shownId(el)}\`) or attach it to an activity in the flow (\`bpmn move <file> ${shownId(el)} --on <activityId>\`).`,
    });
  }
  const trigger = triggerOf(el);
  if (trigger && peek<boolean>(el, 'cancelActivity') === false && NON_INTERRUPTING_FORBIDDEN.includes(trigger)) {
    pushFinding(ctx.errors, 'E_INVALID_TRIGGER', `boundaryEvent:${trigger} ${shownId(el)} cannot be non-interrupting`, shownId(el), {
      hint: `Error, cancel and compensate boundary events always interrupt: \`bpmn set <file> ${shownId(el)} nonInterrupting=false\`.`,
    });
  }
  if (trigger === 'cancel' && !is(host, 'bpmn:Transaction')) {
    pushFinding(ctx.errors, 'E_INVALID_TRIGGER', `boundaryEvent:cancel ${shownId(el)} must be attached to a transaction (host ${shownId(host)} is a ${kindLabel(host)})`, shownId(el), {
      related: [shownId(host)],
      hint: 'Cancel boundary events only work on transaction sub-processes.',
    });
  }
}

function checkDefaultFlow(ctx: Ctx, node: El): void {
  // only exclusive/inclusive/complex gateways and activities have a `default` property in the schema
  const def = peek<El>(node, 'default');
  if (!def || outgoingOf(node).includes(def)) return;
  pushFinding(ctx.errors, 'E_INVALID_DEFAULT', `Default flow ${shownId(def)} of ${describe(node)} is not one of its outgoing flows`, shownId(node), {
    related: [shownId(def)],
    hint: `Mark one of the outgoing flows instead: \`bpmn set <file> <flowId> default=true\`.`,
  });
}

function checkEventSubProcess(ctx: Ctx, sub: El): void {
  const starts = ctx.doc.flowNodes(sub).filter((n) => is(n, 'bpmn:StartEvent'));
  if (!starts.length) {
    pushFinding(ctx.errors, 'E_EVENT_SUBPROCESS_NO_START', `Event sub-process ${shownId(sub)} has no start event`, shownId(sub), {
      hint: `Create it with its trigger in one command: \`bpmn add <file> eventSubProcess:<message|timer|signal|conditional|error|escalation|compensate> "<Name>" --in <scope>\` (the start event is created inside), or add the sub-process and its startEvent:<trigger> together in one batch: \`bpmn apply <file> ops.json\`.`,
    });
    return;
  }
  for (const s of starts) {
    if (triggerOf(s) === 'none') {
      pushFinding(ctx.errors, 'E_EVENT_SUBPROCESS_PLAIN_START', `Start event ${shownId(s)} of event sub-process ${shownId(sub)} has no trigger`, shownId(s), {
        related: [shownId(sub)],
        hint: `Event sub-processes start on a trigger: \`bpmn set <file> ${shownId(s)} trigger=message|timer|error|signal|escalation|conditional|compensate\`.`,
      });
    }
  }
}

function checkLanes(ctx: Ctx, process: El): void {
  const { doc } = ctx;
  const lanes = doc.allLanes(process);
  if (!lanes.length) return;
  const direct = doc.flowElements(process);
  const seen = new Map<El, El[]>();
  for (const lane of lanes) {
    for (const member of list(lane, 'flowNodeRef')) {
      if (!is(member, 'bpmn:FlowNode') || !direct.includes(member)) {
        pushFinding(ctx.errors, 'E_INVALID_LANE_MEMBER', `Lane ${shownId(lane)} lists ${shownId(member)}, which is not a flow node of process ${shownId(process)}`, shownId(lane), {
          related: [shownId(member)],
          hint: 'Only flow nodes declared directly in the process (not inside sub-processes) can be lane members. Fix with `bpmn set <file> <nodeId> lane=`.',
        });
        continue;
      }
      seen.set(member, [...(seen.get(member) ?? []), lane]);
    }
  }
  for (const [member, inLanes] of seen) {
    if (inLanes.length > 1) {
      pushFinding(ctx.errors, 'E_LANE_CONFLICT', `${describe(member)} is a member of ${inLanes.length} lanes (${inLanes.map(shownId).join(', ')})`, shownId(member), {
        related: inLanes.map(shownId),
        hint: `A node belongs to one lane: \`bpmn set <file> ${shownId(member)} lane=<laneId>\` keeps only that one.`,
      });
    }
  }
  for (const node of doc.flowNodes(process)) {
    if (is(node, 'bpmn:BoundaryEvent')) continue;
    if (!seen.has(node)) {
      pushFinding(ctx.warnings, 'W_NOT_IN_LANE', `${describe(node)} is in no lane although process ${shownId(process)} has lanes`, shownId(node), {
        hint: `Assign it: \`bpmn set <file> ${shownId(node)} lane=<laneId>\` (lanes: ${lanes.map(shownId).join(', ')}).`,
      });
    }
  }
}

function poolOf(doc: Doc, el: El): El | undefined {
  if (is(el, 'bpmn:Participant')) return el;
  const process = doc.processOf(el);
  return process ? doc.participantOf(process) : undefined;
}

function checkMessageFlows(ctx: Ctx): void {
  const { doc } = ctx;
  for (const mf of doc.messageFlows()) {
    const source = peek<El>(mf, 'sourceRef');
    const target = peek<El>(mf, 'targetRef');
    if (!source || !target) continue; // reported by checkReferences
    let bad = false;
    for (const end of [source, target]) {
      if (!is(end, 'bpmn:InteractionNode')) {
        bad = true;
        pushFinding(ctx.errors, 'E_INVALID_MESSAGE_FLOW', `Message flow ${shownId(mf)} ends at ${describe(end)}, which cannot send or receive messages`, shownId(mf), {
          related: [shownId(end)],
          hint: 'Message flows connect participants, tasks, events, sub-processes and call activities (not gateways or data).',
        });
      }
    }
    if (bad) continue;
    const sPool = poolOf(doc, source);
    const tPool = poolOf(doc, target);
    if (sPool && tPool && sPool === tPool) {
      pushFinding(ctx.errors, 'E_MESSAGE_FLOW_SAME_POOL', `Message flow ${shownId(mf)} connects ${shownId(source)} and ${shownId(target)} inside the same pool ${shownId(sPool)}`, shownId(mf), {
        related: [shownId(source), shownId(target)],
        hint: `Inside a pool use a sequence flow: \`bpmn remove <file> ${shownId(mf)}\` then \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* lint                                                                 */
/* ------------------------------------------------------------------ */

function isSplitGateway(doc: Doc, node: El): boolean {
  return is(node, 'bpmn:Gateway') && doc.outgoing(node).length >= 2;
}

function isJoinGateway(doc: Doc, node: El): boolean {
  return is(node, 'bpmn:Gateway') && doc.incoming(node).length >= 2 && doc.outgoing(node).length <= 1;
}

function isDeadEndExempt(node: El): boolean {
  if (is(node, 'bpmn:EndEvent') || isEventSubProcess(node)) return true;
  if (peek<boolean>(node, 'isForCompensation') === true) return true;
  const trigger = triggerOf(node);
  if (is(node, 'bpmn:IntermediateThrowEvent') && trigger === 'link') return true;
  if (is(node, 'bpmn:BoundaryEvent') && trigger === 'compensate') return true;
  return false;
}

function lintScope(ctx: Ctx, scope: El, order: FlowOrder): void {
  const { doc } = ctx;
  const nodes = doc.flowNodes(scope);
  const isProcess = is(scope, 'bpmn:Process');
  // an ad-hoc sub-process needs neither start/end events nor sequence flows: its nodes run on their own
  const adHoc = is(scope, 'bpmn:AdHocSubProcess');
  if ((isProcess || nodes.length) && !adHoc) {
    if (!isEventSubProcess(scope) && !nodes.some((n) => is(n, 'bpmn:StartEvent'))) {
      pushFinding(ctx.warnings, 'W_NO_START', `${isProcess ? 'Process' : 'Sub-process'} ${shownId(scope)} has no start event`, shownId(scope), {
        hint: `Add one: \`bpmn add <file> startEvent "<Name>" --in ${shownId(scope)}\` (or --before <firstNodeId>).`,
      });
    }
    if (!nodes.some((n) => is(n, 'bpmn:EndEvent'))) {
      pushFinding(ctx.warnings, 'W_NO_END', `${isProcess ? 'Process' : 'Sub-process'} ${shownId(scope)} has no end event`, shownId(scope), {
        hint: `Add one after the last node: \`bpmn add <file> endEvent "<Name>" --after <nodeId>\`.`,
      });
    }
  }
  for (const node of order.unreachable) {
    const link = isLinkCatch(node) ? linkNameOf(node) : undefined;
    pushFinding(ctx.warnings, 'W_UNREACHABLE', `${describe(node)} is not reachable from any start event${link ? ` (no throwing link event "${link}" pairs with it)` : ''}`, shownId(node), {
      hint: link
        ? `Link events pair by link name: add the throwing side with \`bpmn add <file> intermediateThrowEvent:link "<Name>" --after <nodeId> --link ${link}\`, or remove it.`
        : `Connect it (\`bpmn connect <file> <fromId> ${shownId(node)}\` or \`bpmn move <file> ${shownId(node)} --after <nodeId>\`) or remove it.`,
    });
  }
  for (const node of nodes) {
    const outgoing = doc.outgoing(node);
    const incoming = doc.incoming(node);
    if (!outgoing.length && !adHoc && !isDeadEndExempt(node)) {
      pushFinding(ctx.warnings, 'W_DEAD_END', `${describe(node)} has no outgoing flow`, shownId(node), {
        hint: `Continue the flow (\`bpmn add <file> <kind> "<Name>" --after ${shownId(node)}\`) or end it (\`bpmn add <file> endEvent "<Name>" --after ${shownId(node)}\`).`,
      });
    }
    if (['exclusiveGateway', 'inclusiveGateway'].includes(kindOf(node)?.kind ?? '')) {
      if (isSplitGateway(doc, node)) {
        const name = nameOf(node);
        if (!name || !name.trim().endsWith('?')) {
          pushFinding(ctx.warnings, 'W_GATEWAY_NAME', `${describe(node)} splits but is not named as a question`, shownId(node), {
            hint: `Name splitting gateways as a question, e.g. \`bpmn set <file> ${shownId(node)} name="Invoice ok?"\`.`,
          });
        }
        const unnamed = outgoing.filter((f) => !nameOf(f));
        if (unnamed.length) {
          pushFinding(ctx.warnings, 'W_BRANCH_NAME', `Branches ${unnamed.map(shownId).join(', ')} of ${describe(node)} have no name`, shownId(node), {
            related: unnamed.map(shownId),
            hint: 'Name each branch with its answer, e.g. `bpmn set <file> <flowId> name=yes`.',
          });
        }
      } else if (isJoinGateway(doc, node) && nameOf(node)) {
        pushFinding(ctx.warnings, 'W_NAMED_JOIN', `Joining gateway ${describe(node)} should not have a name`, shownId(node), {
          hint: `Unset it: \`bpmn set <file> ${shownId(node)} name=\`.`,
        });
      }
    }
    if (is(node, 'bpmn:ParallelGateway') && nameOf(node)) {
      pushFinding(ctx.warnings, 'W_NAMED_PARALLEL', `Parallel gateway ${describe(node)} should not have a name`, shownId(node), {
        hint: `Unset it: \`bpmn set <file> ${shownId(node)} name=\`.`,
      });
    }
    if (ignoresConditions(node)) {
      const conditional = outgoing.filter((f) => peek<El | undefined>(f, 'conditionExpression'));
      if (conditional.length) {
        pushFinding(ctx.warnings, 'W_CONDITION_IGNORED', `Flows ${conditional.map(shownId).join(', ')} out of ${describe(node)} have a condition, which the gateway never evaluates`, shownId(node), {
          related: conditional.map(shownId),
          hint: `Remove them (\`bpmn set <file> ${shownId(conditional[0])} condition=\`), or branch by condition: \`bpmn retype <file> ${shownId(node)} exclusiveGateway\`.`,
        });
      }
    }
    if (is(node, 'bpmn:EventBasedGateway')) {
      for (const f of outgoing) {
        const t = peek<El>(f, 'targetRef');
        if (t && !is(t, 'bpmn:IntermediateCatchEvent') && !is(t, 'bpmn:ReceiveTask')) {
          pushFinding(ctx.warnings, 'W_EVENT_GATEWAY_TARGET', `Event-based gateway ${shownId(node)} leads to ${describe(t)}, which is not a catching event or receive task`, shownId(node), {
            related: [shownId(t)],
            hint: 'Every branch of an event-based gateway must start with an intermediateCatchEvent (message/timer/signal/conditional) or a receiveTask.',
          });
        }
      }
    }
    if (!is(node, 'bpmn:Gateway')) {
      if (outgoing.length >= 2) {
        pushFinding(ctx.warnings, 'W_IMPLICIT_SPLIT', `${describe(node)} has ${outgoing.length} outgoing flows (implicit split)`, shownId(node), {
          related: outgoing.map(shownId),
          hint: `Split through a gateway instead: \`bpmn add <file> parallelGateway --flow ${shownId(outgoing[0])}\` (or exclusiveGateway "<Question?>" for alternatives), then \`bpmn set <file> ${shownId(outgoing[1])} source=<gatewayId>\` for each other outgoing flow (new branches: a {"op":"split"} op in \`bpmn apply <file> ops.json\`).`,
        });
      }
      if (incoming.length >= 2) {
        pushFinding(ctx.warnings, 'W_IMPLICIT_JOIN', `${describe(node)} has ${incoming.length} incoming flows (implicit join)`, shownId(node), {
          related: incoming.map(shownId),
          hint: `Join through a gateway instead: \`bpmn add <file> exclusiveGateway --flow ${shownId(incoming[0])}\` (parallelGateway to synchronise), then \`bpmn set <file> ${shownId(incoming[1])} target=<gatewayId>\` for each other incoming flow.`,
        });
      }
    }
    if (is(node, 'bpmn:SubProcess') && !doc.flowNodes(node).length) {
      pushFinding(ctx.warnings, 'W_EMPTY_SUBPROCESS', `${describe(node)} contains no nodes`, shownId(node), {
        hint: `Add content: \`bpmn add <file> startEvent "<Name>" --in ${shownId(node)}\` ... or remove it.`,
      });
    }
  }
}

function checkDuplicateNames(ctx: Ctx): void {
  const groups = new Map<string, El[]>();
  for (const el of walk(ctx.doc.definitions)) {
    if (!is(el, 'bpmn:FlowNode') && !is(el, 'bpmn:Participant') && !is(el, 'bpmn:Lane')) continue;
    const name = nameOf(el)?.trim();
    if (!name) continue;
    const key = `${kindLabel(el)}\u0000${name}`;
    groups.set(key, [...(groups.get(key) ?? []), el]);
  }
  for (const els of groups.values()) {
    if (els.length < 2) continue;
    const [first, ...rest] = els;
    pushFinding(ctx.warnings, 'W_DUPLICATE_NAME', `${els.length} ${kindLabel(first!)} elements are named "${nameOf(first!)}" (${els.map(shownId).join(', ')})`, shownId(first), {
      related: rest.map(shownId),
      hint: 'Distinct names keep the model unambiguous; rename with `bpmn set <file> <id> name="<New name>"`.',
    });
  }
}

/* ------------------------------------------------------------------ */
/* entry point                                                          */
/* ------------------------------------------------------------------ */

/**
 * Validates the whole document. `errors` describe a model that must not be
 * written (dangling references, impossible structures); `warnings` are lint
 * findings about modelling conventions. Missing incoming/outgoing mirror
 * entries are added first (see repairFlowLinks): the only change this makes
 * to the model is derived data every later stage relies on, and it is not
 * written where the file omits it (model/utils/mirror.ts). With
 * `opts.platform` the platform profile runs too (see the module header).
 */
export function validateDoc(doc: Doc, opts: ValidateOptions = {}): ValidationResult {
  const result = validateStructure(doc);
  if (opts.platform === undefined) return result;
  const report = runProfile(doc, opts.platform);
  return withProfile(result, report, report.findings);
}

/**
 * The lint warnings that platform `findings` say again with the engine's
 * verdict: a W_EVENT_GATEWAY_TARGET about the same branch as a platform
 * event-gateway finding, a W_NO_START / W_EMPTY_SUBPROCESS about the same
 * (sub-)process as a missing-start finding ("(sub-)process X has no start
 * event; the engines refuse the file"). withProfile drops them from the
 * warnings, FindingBaseline.delta from the resolved ones.
 */
export function lintCoveredBy(findings: readonly Warning[]): (w: Warning) => boolean {
  const gateway = new Set(findings.filter((f) => (f.code.startsWith('W_C7_') || f.code.startsWith('W_C8_')) && f.code.includes('EVENT_GATEWAY')).map((f) => `${f.element}|${f.related?.[0] ?? ''}`));
  const noStart = new Set(findings.filter((f) => (f.code === 'W_C7_DEPLOY_START_EVENT' || f.code === 'W_C7_TRANSACTION_NO_START' || f.code === 'W_C8_DEPLOY_START_EVENT') && !f.related?.length).map((f) => f.element));
  return (w) => (w.code === 'W_EVENT_GATEWAY_TARGET' && gateway.has(`${w.element}|${w.related?.[0] ?? ''}`)) || ((w.code === 'W_NO_START' || w.code === 'W_EMPTY_SUBPROCESS') && noStart.has(w.element));
}

/**
 * Adds the profile findings `shown` to the warnings and the summary of
 * `report` to the result (`added` / `resolved` for a mutation's delta). A lint
 * W_EVENT_GATEWAY_TARGET about the same branch, or a W_NO_START /
 * W_EMPTY_SUBPROCESS about the same (sub-)process, as a shown platform
 * finding is dropped: the platform finding
 * says the same with the engine's verdict. The other way round, a platform
 * finding that a structural error already reports is dropped (and not
 * counted): W_C7_DEPLOY_BOUNDARY_HOST / W_C8_DEPLOY_BOUNDARY_HOST next to
 * E_INVALID_HOST (also as W_PREEXISTING_ERROR) for the same boundary event.
 */
export function withProfile(result: ValidationResult, report: ProfileReport, shown: ProfileFinding[], delta?: { added: ProfileFinding[]; resolved: ProfileFinding[] }): ValidationResult {
  const invalidHost = new Set(
    [...result.errors, ...result.warnings]
      .filter((e) => e.code === 'E_INVALID_HOST' || (e.code === 'W_PREEXISTING_ERROR' && e.message.startsWith('E_INVALID_HOST')))
      .map((e) => e.element),
  );
  const repeated = (f: ProfileFinding): boolean => (f.code === 'W_C7_DEPLOY_BOUNDARY_HOST' || f.code === 'W_C8_DEPLOY_BOUNDARY_HOST') && invalidHost.has(f.element);
  if (invalidHost.size) {
    shown = shown.filter((f) => !repeated(f));
    report = { ...report, findings: report.findings.filter((f) => !repeated(f)) };
    if (delta) delta = { added: delta.added.filter((f) => !repeated(f)), resolved: delta.resolved };
  }
  const covered = lintCoveredBy(shown);
  const warnings = result.warnings.filter((w) => !covered(w));
  const platform: PlatformSummary = { ...summarize(report), ...(delta ? { added: delta.added, resolved: delta.resolved } : {}) };
  return { errors: result.errors, warnings: [...warnings, ...shown], platform };
}

function validateStructure(doc: Doc): ValidationResult {
  const ctx: Ctx = { doc, errors: [], warnings: [] };
  repairFlowLinks(doc);
  checkDuplicateIds(ctx);
  checkReferences(ctx);
  checkRoots(ctx);
  for (const scope of scopesOf(doc)) {
    for (const el of doc.flowElements(scope)) {
      const rejected = isRejectedType(el.$type);
      if (rejected) {
        pushFinding(ctx.errors, 'E_UNSUPPORTED_KIND', `${el.$type} ${shownId(el)} is not supported: ${rejected}`, shownId(el), {
          hint: `Remove it: \`bpmn remove <file> ${shownId(el)}\`.`,
        });
      }
      if (is(el, 'bpmn:SequenceFlow')) checkSequenceFlow(ctx, el, scope);
      if (!is(el, 'bpmn:FlowNode')) continue;
      checkFlowLinks(ctx, el);
      checkDefaultFlow(ctx, el);
      if (is(el, 'bpmn:Event')) checkEvent(ctx, el, scope);
      if (is(el, 'bpmn:BoundaryEvent')) checkBoundaryEvent(ctx, el, scope);
      if (isEventSubProcess(el)) checkEventSubProcess(ctx, el);
    }
    if (is(scope, 'bpmn:Process')) checkLanes(ctx, scope);
    lintScope(ctx, scope, flowOrder(doc, scope));
  }
  checkMessageFlows(ctx);
  checkDuplicateNames(ctx);
  return { errors: ctx.errors, warnings: ctx.warnings };
}
