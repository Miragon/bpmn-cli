import type { EditSession } from '../../document/EditSession.js';
import { modelError } from '../../document/utils/errors.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { isEventSubProcess, kindLabel, triggerOf } from '../../document/Kinds.js';
import { addTo, is, many, type El, idOf } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { artifactContainerOf, isDataReference } from '../utils/artifacts.js';
import { FlowOptions } from './FlowOptions.js';
import type { ConnectElements } from '../../commands/types.js';
import type { ConnectionKind } from '../../diagram/di/types.js';
import { EventGatewayRule } from '../events/EventGatewayRule.js';
import { SequenceFlows } from './SequenceFlows.js';
import { RootElements } from '../events/RootElements.js';
import { Associations } from './Associations.js';

/**
 * Runs the `connect` op: infers the connection kind (sequence flow, message flow,
 * association or data association) from the two endpoints.
 */
export class Connections {
  constructor(private readonly edit: EditSession) {}

  private static describe(el: El): string {
    return `${idOf(el)} (${kindLabel(el)})`;
  }

  private kindOf(source: El, target: El): ConnectionKind {
    if (is(source, 'bpmn:TextAnnotation') || is(target, 'bpmn:TextAnnotation')) {
      return 'association';
    }
    if (isDataReference(source) || isDataReference(target)) {
      return 'dataAssociation';
    }
    if (is(source, 'bpmn:Participant') || is(target, 'bpmn:Participant')) {
      return 'messageFlow';
    }
    if (is(source, 'bpmn:FlowNode') && is(target, 'bpmn:FlowNode')) {
      if (is(source, 'bpmn:BoundaryEvent') && triggerOf(source) === 'compensate' && is(target, 'bpmn:Activity')) {
        return 'association';
      }
      const ps = this.edit.doc.processOf(source);
      const pt = this.edit.doc.processOf(target);
      if (ps && pt && ps !== pt) return 'messageFlow';
      return 'sequenceFlow';
    }
    throw modelError('E_INVALID_ENDPOINT', `Cannot connect ${Connections.describe(source)} with ${Connections.describe(target)}`, {
      element: idOf(source),
      related: [idOf(target)],
      hint: 'connect joins flow nodes (sequence flow), nodes in different pools (message flow), a text annotation (association) or a data object/store (data association).',
    });
  }

  private participantFor(el: El): El | undefined {
    if (is(el, 'bpmn:Participant')) return el;
    const process = this.edit.doc.processOf(el);
    return process ? this.edit.doc.participantOf(process) : undefined;
  }

  private static assertMessageEndpoint(el: El, role: 'source' | 'target'): void {
    const fail = (why: string, hint: string): never => {
      throw modelError('E_INVALID_ENDPOINT', `${Connections.describe(el)} cannot be the ${role} of a message flow: ${why}`, { element: idOf(el), hint });
    };
    if (!is(el, 'bpmn:InteractionNode')) {
      fail('not an interaction node', 'Message flows connect participants, tasks, events and sub-processes; not gateways or data.');
    }
    if (isEventSubProcess(el)) {
      fail('event sub-processes cannot send or receive messages', 'Target a message start event inside it instead.');
    }
    if (is(el, 'bpmn:Event')) {
      const trigger = triggerOf(el);
      if (trigger !== 'none' && trigger !== 'message') {
        fail(`a ${trigger} event cannot ${role === 'source' ? 'send' : 'receive'} messages`, 'Use a message or untyped event.');
      }
      if (role === 'source' && !is(el, 'bpmn:ThrowEvent')) {
        fail('catching events cannot send messages', 'Use a throw event, end event or send task as source.');
      }
      if (role === 'target' && !is(el, 'bpmn:CatchEvent')) {
        fail('throwing events cannot receive messages', 'Use a catch event, start event or receive task as target.');
      }
    }
  }

  private createMessageFlow(source: El, target: El, command: ConnectElements, changes: ChangeSet): El {
    const collab = this.edit.doc.collaboration();
    if (!collab) {
      throw modelError('E_NO_COLLABORATION', 'Message flows need pools; the file has no collaboration', {
        element: idOf(source),
        related: [idOf(target)],
        hint: 'Add participants first: `add participant "<name>"` wraps the existing process, a second one gets its own process.',
      });
    }
    Connections.assertMessageEndpoint(source, 'source');
    Connections.assertMessageEndpoint(target, 'target');
    const ps = this.participantFor(source);
    const pt = this.participantFor(target);
    for (const [el, property] of [
      [source, ps],
      [target, pt],
    ] as const) {
      if (!property) {
        throw modelError('E_NO_PARTICIPANT', `${Connections.describe(el)} is not inside a participant; message flows only connect pools`, {
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
    const id = this.edit.allocator.explicitOr(command.id, ElementLabels.flowRequest('bpmn:MessageFlow', source, target));
    const message = command.message ? new RootElements(this.edit).ensure('bpmn:Message', command.message) : undefined;
    if (message?.created) {
      const name = message.el.get<string | undefined>('name');
      changes.create({ id: idOf(message.el), kind: 'message', ...(name ? { name } : {}), detail: 'root element' });
    }
    const flow = this.edit.doc.create('bpmn:MessageFlow', {
      id,
      ...(command.name ? { name: command.name } : {}),
      sourceRef: source,
      targetRef: target,
      ...(message ? { messageRef: message.el } : {}),
    });
    addTo(collab, 'messageFlows', flow);
    changes.create({ id, kind: 'messageFlow', ...(command.name ? { name: command.name } : {}), detail: `${idOf(source)} -> ${idOf(target)}` });
    this.edit.doc.invalidate();
    return flow;
  }

  private existingConnection(kind: ConnectionKind, source: El, target: El): El | undefined {
    switch (kind) {
      case 'sequenceFlow':
        return this.edit.doc.outgoing(source).find((flow) => flow.get<El | undefined>('targetRef') === target);
      case 'messageFlow':
        return this.edit.doc.messageFlows().find((flow) => flow.get<El | undefined>('sourceRef') === source && flow.get<El | undefined>('targetRef') === target);
      case 'association': {
        const containers = [artifactContainerOf(source), artifactContainerOf(target)].filter((container): container is El => !!container);
        for (const container of containers) {
          const hit = many(container, 'artifacts').find((artifact) => {
            if (!is(artifact, 'bpmn:Association')) return false;
            const artifactSource = artifact.get<El | undefined>('sourceRef');
            const artifactTarget = artifact.get<El | undefined>('targetRef');
            return (artifactSource === source && artifactTarget === target) || (artifactSource === target && artifactTarget === source);
          });
          if (hit) return hit;
        }
        return undefined;
      }
      case 'dataAssociation':
        if (isDataReference(source)) {
          return (target.get<El[] | undefined>('dataInputAssociations') ?? []).find((association) => many(association, 'sourceRef').includes(source));
        }
        return (source.get<El[] | undefined>('dataOutputAssociations') ?? []).find((association) => association.get<El | undefined>('targetRef') === target);
      default:
        return undefined;
    }
  }

  private static assertOptionsFor(kind: ConnectionKind, command: ConnectElements): void {
    const reject = (option: string, allowed: string): never => {
      throw modelError('E_INVALID_VALUE', `--${option} only applies to ${allowed}, not to a ${kind}`, {
        element: command.source,
        related: [command.target],
      });
    };
    if (kind !== 'sequenceFlow') {
      if (command.condition !== undefined) reject('condition', 'sequence flows');
      if (command.default) reject('default', 'sequence flows');
      if (command.language !== undefined) reject('language', 'sequence flows');
    }
    if (kind !== 'sequenceFlow' && kind !== 'messageFlow' && command.name !== undefined) {
      reject('name', 'sequence and message flows');
    }
    if (kind !== 'messageFlow' && command.message !== undefined) {
      reject('message', 'message flows (between pools)');
    }
    new FlowOptions({ condition: command.condition, default: command.default }).assertConsistent({ element: command.source, related: [command.target] });
  }

  /** Connects source and target; the op's alias names the connection, not a root message created with it. */
  connect(command: ConnectElements): ChangeSet {
    const changes = new ChangeSet();
    const source = this.edit.require(command.source);
    const target = this.edit.require(command.target);
    const kind = this.kindOf(source, target);
    const selfLoop = source === target;
    if (selfLoop && !(kind === 'sequenceFlow' && is(source, 'bpmn:Activity'))) {
      throw modelError('E_INVALID_ENDPOINT', `Cannot connect ${command.source} to itself`, {
        element: command.source,
        hint: 'Only activities (tasks, sub-processes, call activities) can loop back to themselves with a sequence flow; route other loops through a gateway.',
      });
    }
    Connections.assertOptionsFor(kind, command);

    const existing = kind === 'sequenceFlow' || kind === 'messageFlow' ? this.existingConnection(kind, source, target) : undefined;
    if (command.ifAbsent) {
      const same = existing ?? this.existingConnection(kind, source, target);
      if (same) {
        changes.note(`${kind} ${idOf(same)} ${command.source} -> ${command.target} already exists; nothing to do`);
        RootElements.bindRefAs(changes, command.refAs, same);
        return changes.bind(command.as, same);
      }
    }
    if (existing) {
      const all = (kind === 'sequenceFlow' ? this.edit.doc.outgoing(source) : this.edit.doc.messageFlows()).filter(
        (flow) => flow.get<El | undefined>('sourceRef') === source && flow.get<El | undefined>('targetRef') === target,
      );
      changes.warn({
        code: 'W_DUPLICATE_FLOW',
        message: `${command.source} -> ${command.target} is already connected by the ${kind} ${all.map(idOf).join(', ')}; this adds another one`,
        element: command.source,
        related: [command.target, ...all.map(idOf)],
        hint:
          kind === 'sequenceFlow'
            ? `Two flows between the same nodes run the target twice (or join with itself). Use --if-absent to skip an existing connection; remove the extra flow with \`bpmn remove <file> <flowId>\`.`
            : 'Use --if-absent to skip an existing connection; remove the extra flow with `bpmn remove <file> <flowId>`.',
      });
    }

    let made: El | undefined;
    switch (kind) {
      case 'sequenceFlow': {
        const flow = (made = new SequenceFlows(this.edit).create(source, target, new FlowOptions({ flowId: command.id, flowName: command.name, condition: command.condition, language: command.language, default: command.default }).toAttrs(true)));
        changes.create(ChangeSet.flowEntryOf(flow));
        new EventGatewayRule(this.edit).warnFlow(flow, changes);
        if (selfLoop) {
          changes.note(`${idOf(source)} loops back to itself; a standard loop marker (\`bpmn set <file> ${idOf(source)} loop=standard\`) is the conventional alternative`);
        }
        const out = this.edit.doc.outgoing(source).length;
        const inc = this.edit.doc.incoming(target).length;
        if (!is(source, 'bpmn:Gateway') && out > 1) {
          changes.warn({
            code: 'W_IMPLICIT_SPLIT',
            message: `${idOf(source)} now has ${out} outgoing flows (implicit parallel split)`,
            element: idOf(source),
            hint: 'Model the split explicitly: `bpmn add <file> exclusiveGateway "<Question?>" --flow <flowId>` (or a `split` op in `bpmn apply`) and re-point the other flow with `bpmn set <file> <flowId> source=<gatewayId>`.',
          });
        }
        if (!is(target, 'bpmn:Gateway') && inc > 1) {
          changes.warn({
            code: 'W_IMPLICIT_JOIN',
            message: `${idOf(target)} now has ${inc} incoming flows (implicit join)`,
            element: idOf(target),
            hint: 'Consider joining through a gateway.',
          });
        }
        break;
      }
      case 'messageFlow':
        made = this.createMessageFlow(source, target, command, changes);
        break;
      case 'association':
        made = new Associations(this.edit).createAssociation(source, target, command.id ? { id: command.id } : {}, changes);
        break;
      case 'dataAssociation':
        made = new Associations(this.edit).createDataAssociation(source, target, command.id ? { id: command.id } : {}, changes);
        break;
      default:
        break;
    }
    changes.bind(command.as, made);
    RootElements.bindRefAs(changes, command.refAs, made);
    this.edit.allocator.reportSuffixed(changes);
    this.edit.doc.invalidate();
    return changes;
  }
}
