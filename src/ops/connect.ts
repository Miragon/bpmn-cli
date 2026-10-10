/**
 * `connect`: connection kind is inferred from the endpoints.
 *
 *  - both flow nodes in the same process        -> sequence flow (createSequenceFlow),
 *      W_IMPLICIT_SPLIT when a non-gateway source gets a 2nd outgoing flow,
 *      W_IMPLICIT_JOIN when a non-gateway target gets a 2nd incoming flow,
 *      W_EVENT_GATEWAY_TARGET when an event-based gateway gets a target BPMN
 *      2.0 does not allow there (Camunda 7 files: the platform profile reports
 *      the engines' rule instead, see warnEventGatewayFlow in flows.ts)
 *  - endpoints in different participants (or a participant itself) -> message
 *      flow in the collaboration (id Flow_<Source>To<Target> in the default id style, only between InteractionNodes:
 *      participants, tasks, events, sub-processes/call activities; gateways ->
 *      E_INVALID_ENDPOINT), op.message -> messageRef (root bpmn:Message by name)
 *  - a text annotation on either side          -> association
 *  - a compensate boundary event -> activity    -> compensation association
 *  - a data object/store reference on one side -> data association
 *      (node -> data = output, data -> node = input)
 *  - anything else -> E_INVALID_ENDPOINT with a hint
 *  - source === target: allowed only as a sequence flow on an activity
 *    (a loop; the note suggests `set <id> loop=standard`), else E_INVALID_ENDPOINT
 *  - op.ifAbsent: an identical connection (same kind, source, target) already
 *    exists -> empty ChangeSet with note. Without it, a second sequence or
 *    message flow between the same endpoints is created with W_DUPLICATE_FLOW.
 *  - condition/default only apply to sequence flows, name to sequence and
 *    message flows, message to message flows (else E_INVALID_VALUE);
 *    default together with condition is E_USAGE (a default flow has none)
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { flowRequest } from '../idstyle.js';
import { kindLabel, triggerOf } from '../kinds.js';
import { addTo, is, many, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { artifactContainerOf, createAssociation, createDataAssociation, isDataReference } from './artifacts.js';
import { ensureRootElement } from './events.js';
import { createSequenceFlow, flowChange, warnEventGatewayFlow } from './flows.js';
import type { ConnectOp } from './types.js';

export type ConnectionKind = 'sequenceFlow' | 'messageFlow' | 'association' | 'dataAssociation';

function idOf(el: El): string {
  return el.get<string>('id');
}

function label(el: El): string {
  return `${idOf(el)} (${kindLabel(el)})`;
}

/* ------------------------------------------------------------------ */
/* inference                                                            */
/* ------------------------------------------------------------------ */

/** Which connection the endpoints imply. */
export function inferConnectionKind(doc: Doc, source: El, target: El): ConnectionKind {
  if (is(source, 'bpmn:TextAnnotation') || is(target, 'bpmn:TextAnnotation')) return 'association';
  if (isDataReference(source) || isDataReference(target)) return 'dataAssociation';
  if (is(source, 'bpmn:Participant') || is(target, 'bpmn:Participant')) return 'messageFlow';
  if (is(source, 'bpmn:FlowNode') && is(target, 'bpmn:FlowNode')) {
    if (is(source, 'bpmn:BoundaryEvent') && triggerOf(source) === 'compensate' && is(target, 'bpmn:Activity')) return 'association';
    const ps = doc.processOf(source);
    const pt = doc.processOf(target);
    if (ps && pt && ps !== pt) return 'messageFlow';
    return 'sequenceFlow';
  }
  throw modelError('E_INVALID_ENDPOINT', `Cannot connect ${label(source)} with ${label(target)}`, {
    element: idOf(source),
    related: [idOf(target)],
    hint: 'connect joins flow nodes (sequence flow), nodes in different pools (message flow), a text annotation (association) or a data object/store (data association).',
  });
}

/* ------------------------------------------------------------------ */
/* message flows                                                        */
/* ------------------------------------------------------------------ */

function participantFor(doc: Doc, el: El): El | undefined {
  if (is(el, 'bpmn:Participant')) return el;
  const process = doc.processOf(el);
  return process ? doc.participantOf(process) : undefined;
}

function assertMessageEndpoint(el: El, role: 'source' | 'target'): void {
  const fail = (why: string, hint: string): never => {
    throw modelError('E_INVALID_ENDPOINT', `${label(el)} cannot be the ${role} of a message flow: ${why}`, { element: idOf(el), hint });
  };
  if (!is(el, 'bpmn:InteractionNode')) fail('not an interaction node', 'Message flows connect participants, tasks, events and sub-processes; not gateways or data.');
  if (is(el, 'bpmn:SubProcess') && el.get<boolean | undefined>('triggeredByEvent')) fail('event sub-processes cannot send or receive messages', 'Target a message start event inside it instead.');
  if (is(el, 'bpmn:Event')) {
    const trigger = triggerOf(el);
    if (trigger !== 'none' && trigger !== 'message') fail(`a ${trigger} event cannot ${role === 'source' ? 'send' : 'receive'} messages`, 'Use a message or untyped event.');
    if (role === 'source' && !is(el, 'bpmn:ThrowEvent')) fail('catching events cannot send messages', 'Use a throw event, end event or send task as source.');
    if (role === 'target' && !is(el, 'bpmn:CatchEvent')) fail('throwing events cannot receive messages', 'Use a catch event, start event or receive task as target.');
  }
}

function createMessageFlow(doc: Doc, source: El, target: El, op: ConnectOp, cs: ChangeSet): El {
  const collab = doc.collaboration();
  if (!collab) {
    throw modelError('E_NO_COLLABORATION', 'Message flows need pools; the file has no collaboration', {
      element: idOf(source),
      related: [idOf(target)],
      hint: 'Add participants first: `add participant "<name>"` wraps the existing process, a second one gets its own process.',
    });
  }
  assertMessageEndpoint(source, 'source');
  assertMessageEndpoint(target, 'target');
  const ps = participantFor(doc, source);
  const pt = participantFor(doc, target);
  for (const [el, p] of [
    [source, ps],
    [target, pt],
  ] as const) {
    if (!p) {
      throw modelError('E_NO_PARTICIPANT', `${label(el)} is not inside a participant; message flows only connect pools`, {
        element: idOf(el),
        hint: 'Bind its process to a participant with `add participant "<name>" --process <processId>`.',
      });
    }
  }
  if (ps === pt) {
    throw modelError('E_SAME_POOL', `${idOf(source)} and ${idOf(target)} are in the same pool ${idOf(ps!)}; message flows connect different pools`, {
      element: idOf(source),
      related: [idOf(target)],
      hint: 'Use a sequence flow inside a pool.',
    });
  }
  const id = op.id ? (doc.claimId(op.id), op.id) : doc.allocateId(flowRequest('bpmn:MessageFlow', source, target)).id;
  const message = op.message ? ensureRootElement(doc, 'bpmn:Message', op.message) : undefined;
  if (message?.created) {
    const name = message.el.get<string | undefined>('name');
    cs.create({ id: idOf(message.el), kind: 'message', ...(name ? { name } : {}), detail: 'root element' });
  }
  const flow = doc.create('bpmn:MessageFlow', {
    id,
    ...(op.name ? { name: op.name } : {}),
    sourceRef: source,
    targetRef: target,
    ...(message ? { messageRef: message.el } : {}),
  });
  addTo(collab, 'messageFlows', flow);
  cs.create({ id, kind: 'messageFlow', ...(op.name ? { name: op.name } : {}), detail: `${idOf(source)} -> ${idOf(target)}` });
  doc.invalidate();
  return flow;
}

/* ------------------------------------------------------------------ */
/* existing connections (ifAbsent)                                      */
/* ------------------------------------------------------------------ */

function existingConnection(doc: Doc, kind: ConnectionKind, source: El, target: El): El | undefined {
  switch (kind) {
    case 'sequenceFlow':
      return doc.outgoing(source).find((f) => f.get<El | undefined>('targetRef') === target);
    case 'messageFlow':
      return doc.messageFlows().find((f) => f.get<El | undefined>('sourceRef') === source && f.get<El | undefined>('targetRef') === target);
    case 'association': {
      const containers = [artifactContainerOf(source), artifactContainerOf(target)].filter((c): c is El => !!c);
      for (const c of containers) {
        const hit = many(c, 'artifacts').find((a) => {
          if (!is(a, 'bpmn:Association')) return false;
          const s = a.get<El | undefined>('sourceRef');
          const t = a.get<El | undefined>('targetRef');
          return (s === source && t === target) || (s === target && t === source);
        });
        if (hit) return hit;
      }
      return undefined;
    }
    case 'dataAssociation':
      if (isDataReference(source)) {
        return (target.get<El[] | undefined>('dataInputAssociations') ?? []).find((a) => many(a, 'sourceRef').includes(source));
      }
      return (source.get<El[] | undefined>('dataOutputAssociations') ?? []).find((a) => a.get<El | undefined>('targetRef') === target);
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* entry point                                                          */
/* ------------------------------------------------------------------ */

function assertOptionsFor(kind: ConnectionKind, op: ConnectOp): void {
  const reject = (option: string, allowed: string): never => {
    throw modelError('E_INVALID_VALUE', `--${option} only applies to ${allowed}, not to a ${kind}`, {
      element: op.source,
      related: [op.target],
    });
  };
  if (kind !== 'sequenceFlow') {
    if (op.condition !== undefined) reject('condition', 'sequence flows');
    if (op.default) reject('default', 'sequence flows');
    if (op.language !== undefined) reject('language', 'sequence flows');
  }
  if (kind !== 'sequenceFlow' && kind !== 'messageFlow' && op.name !== undefined) reject('name', 'sequence and message flows');
  if (kind !== 'messageFlow' && op.message !== undefined) reject('message', 'message flows (between pools)');
  if (op.default && op.condition !== undefined) {
    throw usageError('--default and --condition are mutually exclusive: a default flow has no condition', {
      element: op.source,
      related: [op.target],
      hint: 'Keep the condition on the other branches and mark this one as default.',
    });
  }
}

/** Connects two elements; the connection kind is inferred from the endpoints. */
export function connectElements(doc: Doc, op: ConnectOp): ChangeSet {
  const cs = new ChangeSet();
  const source = doc.require(op.source);
  const target = doc.require(op.target);
  const kind = inferConnectionKind(doc, source, target);
  const selfLoop = source === target;
  if (selfLoop && !(kind === 'sequenceFlow' && is(source, 'bpmn:Activity'))) {
    throw modelError('E_INVALID_ENDPOINT', `Cannot connect ${op.source} to itself`, {
      element: op.source,
      hint: 'Only activities (tasks, sub-processes, call activities) can loop back to themselves with a sequence flow; route other loops through a gateway.',
    });
  }
  assertOptionsFor(kind, op);

  const existing = kind === 'sequenceFlow' || kind === 'messageFlow' ? existingConnection(doc, kind, source, target) : undefined;
  if (op.ifAbsent) {
    const same = existing ?? existingConnection(doc, kind, source, target);
    if (same) {
      cs.note(`${kind} ${idOf(same)} ${op.source} -> ${op.target} already exists; nothing to do`);
      return cs;
    }
  }
  if (existing) {
    const all = (kind === 'sequenceFlow' ? doc.outgoing(source) : doc.messageFlows()).filter(
      (f) => f.get<El | undefined>('sourceRef') === source && f.get<El | undefined>('targetRef') === target,
    );
    cs.warn({
      code: 'W_DUPLICATE_FLOW',
      message: `${op.source} -> ${op.target} is already connected by the ${kind} ${all.map(idOf).join(', ')}; this adds another one`,
      element: op.source,
      related: [op.target, ...all.map(idOf)],
      hint:
        kind === 'sequenceFlow'
          ? `Two flows between the same nodes run the target twice (or join with itself). Use --if-absent to skip an existing connection; remove the extra flow with \`bpmn remove <file> <flowId>\`.`
          : 'Use --if-absent to skip an existing connection; remove the extra flow with `bpmn remove <file> <flowId>`.',
    });
  }

  switch (kind) {
    case 'sequenceFlow': {
      const flow = createSequenceFlow(doc, source, target, {
        ...(op.id ? { id: op.id } : {}),
        ...(op.name ? { name: op.name } : {}),
        ...(op.condition !== undefined ? { condition: op.condition } : {}),
        ...(op.language ? { language: op.language } : {}),
        ...(op.default ? { isDefault: true } : {}),
      });
      cs.create(flowChange(flow));
      warnEventGatewayFlow(doc, flow, cs);
      if (selfLoop) cs.note(`${idOf(source)} loops back to itself; a standard loop marker (\`bpmn set ${idOf(source)} loop=standard\`) is the conventional alternative`);
      const out = doc.outgoing(source).length;
      const inc = doc.incoming(target).length;
      if (!is(source, 'bpmn:Gateway') && out > 1) {
        cs.warn({
          code: 'W_IMPLICIT_SPLIT',
          message: `${idOf(source)} now has ${out} outgoing flows (implicit parallel split)`,
          element: idOf(source),
          hint: 'Model the split explicitly: `bpmn add <file> exclusiveGateway "<Question?>" --flow <flowId>` (or a `split` op in `bpmn apply`) and re-point the other flow with `bpmn set <file> <flowId> source=<gatewayId>`.',
        });
      }
      if (!is(target, 'bpmn:Gateway') && inc > 1) {
        cs.warn({
          code: 'W_IMPLICIT_JOIN',
          message: `${idOf(target)} now has ${inc} incoming flows (implicit join)`,
          element: idOf(target),
          hint: 'Consider joining through a gateway.',
        });
      }
      break;
    }
    case 'messageFlow':
      createMessageFlow(doc, source, target, op, cs);
      break;
    case 'association':
      createAssociation(doc, source, target, op.id ? { id: op.id } : {}, cs);
      break;
    case 'dataAssociation':
      createDataAssociation(doc, source, target, op.id ? { id: op.id } : {}, cs);
      break;
    default:
      break;
  }
  doc.reportSuffixed(cs);
  doc.invalidate();
  return cs;
}
