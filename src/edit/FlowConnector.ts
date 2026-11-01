import { type BpmnElement, BpmnError, ChangeEntries, ChangeSet, PropertyCatalog } from '../model/index.js';
import type { ConnectOperation } from '../operations/index.js';
import { EventGatewayRule } from './events/EventGatewayRule.js';
import { RootElements } from './events/RootElements.js';
import { TriggerKeys } from './events/TriggerKeys.js';
import { Associations } from './flows/Associations.js';
import { type ConnectionKind, ConnectionKinds } from './flows/ConnectionKinds.js';
import { MessageFlows } from './flows/MessageFlows.js';
import { SequenceFlows } from './flows/SequenceFlows.js';
import { PropertyCoercer } from './properties/PropertyCoercer.js';
import { PropertyEditor } from './PropertyEditor.js';
import type { EditSession } from './session/EditSession.js';

export class FlowConnector {
  private static readonly SEQUENCE_FLOW_KEYS = ['condition', 'language', 'default'];
  private static readonly CREATION_KEYS = ['name', 'message', ...FlowConnector.SEQUENCE_FLOW_KEYS];

  constructor(private readonly edit: EditSession) {}

  private static flowAttrs(flow: BpmnElement, keys: Readonly<Record<string, string>>, id: string | undefined) {
    const { name, condition, language } = keys;
    return {
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      ...(condition !== undefined ? { condition } : {}),
      ...(language ? { language } : {}),
      ...(keys['default'] && PropertyCoercer.bool(flow, 'default', keys['default']) ? { isDefault: true } : {}),
    };
  }

  connect(command: ConnectOperation): ChangeSet {
    const changes = new ChangeSet();
    const source = this.edit.require(command.source);
    const target = this.edit.require(command.target);
    const kinds = new ConnectionKinds(this.edit);
    const kind = kinds.kindOf(source, target);
    this.assertNoIllegalSelfLoop(command, source, target, kind);
    const keys = command.set ?? {};
    FlowConnector.assertKeysFor(kind, source, keys);
    const existing = kind === 'sequenceFlow' || kind === 'messageFlow' ? kinds.existing(kind, source, target) : undefined;
    const same = command.ifAbsent ? (existing ?? kinds.existing(kind, source, target)) : undefined;
    if (same) {
      changes.note(`${kind} ${same.id} ${command.source} -> ${command.target} already exists; nothing to do`);
      RootElements.bindRefAs(changes, command.refAs, same);
      return changes.bind(command.as, same);
    }
    if (existing) {
      this.warnDuplicate(command, source, target, kind, changes);
    }
    const made = this.make(kind, source, target, command, changes);
    this.writeOtherKeys(made, keys, changes);
    changes.bind(command.as, made);
    RootElements.bindRefAs(changes, command.refAs, made);
    this.edit.allocator.reportSuffixed(changes);
    this.edit.document.tree.invalidate();
    return changes;
  }

  private static assertKeysFor(kind: ConnectionKind, element: BpmnElement, keys: Readonly<Record<string, string>>): void {
    const given = (key: string): boolean => keys[key] !== undefined;
    const refused = (key: string, allowed: string): BpmnError => PropertyCatalog.of(element).unknownKey(key, `on connect it applies to ${allowed}, not to a ${kind}`);
    const sequenceOnly = FlowConnector.SEQUENCE_FLOW_KEYS.find(given);
    if (kind !== 'sequenceFlow' && sequenceOnly) {
      throw refused(sequenceOnly, 'sequence flows');
    }
    if (kind !== 'sequenceFlow' && kind !== 'messageFlow' && given('name')) {
      throw refused('name', 'sequence and message flows');
    }
    if (kind !== 'messageFlow' && given('message')) {
      throw refused('message', 'message flows (between pools)');
    }
  }

  private assertNoIllegalSelfLoop(command: ConnectOperation, source: BpmnElement, target: BpmnElement, kind: ConnectionKind): void {
    if (source === target && !(kind === 'sequenceFlow' && source.is('bpmn:Activity'))) {
      throw BpmnError.model('E_INVALID_ENDPOINT', `Cannot connect ${command.source} to itself`, {
        element: command.source,
        hint: 'Only activities (tasks, sub-processes, call activities) can loop back to themselves with a sequence flow; route other loops through a gateway.',
      });
    }
  }

  private warnDuplicate(command: ConnectOperation, source: BpmnElement, target: BpmnElement, kind: ConnectionKind, changes: ChangeSet): void {
    const { flows } = this.edit.document;
    const candidates = kind === 'sequenceFlow' ? flows.outgoing(source) : flows.messageFlows();
    const ids = candidates.filter((flow) => flow.get<BpmnElement | undefined>('sourceRef') === source && flow.get<BpmnElement | undefined>('targetRef') === target).map((flow) => flow.id);
    const twice = kind === 'sequenceFlow' ? 'Two flows between the same nodes run the target twice (or join with itself). ' : '';
    changes.warn({
      code: 'W_DUPLICATE_FLOW',
      message: `${command.source} -> ${command.target} is already connected by the ${kind} ${ids.join(', ')}; this adds another one`,
      element: command.source,
      related: [command.target, ...ids],
      hint: `${twice}Use --if-absent to skip an existing connection; remove the extra flow with \`bpmn remove <file> <flowId>\`.`,
    });
  }

  private make(kind: ConnectionKind, source: BpmnElement, target: BpmnElement, command: ConnectOperation, changes: ChangeSet): BpmnElement {
    const keys = command.set ?? {};
    const identified = command.id ? { id: command.id } : {};
    switch (kind) {
      case 'sequenceFlow':
        return this.makeSequenceFlow(source, target, command, changes);
      case 'messageFlow':
        return new MessageFlows(this.edit).create(source, target, { id: command.id, name: keys['name'], message: keys['message'] }, changes);
      case 'association':
        return new Associations(this.edit).createAssociation(source, target, identified, changes);
      default:
        return new Associations(this.edit).createDataAssociation(source, target, identified, changes);
    }
  }

  private makeSequenceFlow(source: BpmnElement, target: BpmnElement, command: ConnectOperation, changes: ChangeSet): BpmnElement {
    const { flows } = this.edit.document;
    const flow = new SequenceFlows(this.edit).create(source, target, FlowConnector.flowAttrs(source, command.set ?? {}, command.id));
    changes.create(ChangeEntries.ofFlow(flow));
    new EventGatewayRule(this.edit).warnFlow(flow, changes);
    if (source === target) {
      changes.note(`${source.id} loops back to itself; a standard loop marker (\`bpmn set <file> ${source.id} loop=standard\`) is the conventional alternative`);
    }
    const out = flows.outgoing(source).length;
    const into = flows.incoming(target).length;
    if (!source.is('bpmn:Gateway') && out > 1) {
      changes.warn({
        code: 'W_IMPLICIT_SPLIT',
        message: `${source.id} now has ${out} outgoing flows (implicit parallel split)`,
        element: source.id,
        hint: 'Model the split explicitly: `bpmn add <file> exclusiveGateway "<Question?>" --flow <flowId>` (or a `split` op in `bpmn apply`) and re-point the other flow with `bpmn set <file> <flowId> source=<gatewayId>`.',
      });
    }
    if (!target.is('bpmn:Gateway') && into > 1) {
      changes.warn({ code: 'W_IMPLICIT_JOIN', message: `${target.id} now has ${into} incoming flows (implicit join)`, element: target.id, hint: 'Consider joining through a gateway.' });
    }
    return flow;
  }

  private writeOtherKeys(made: BpmnElement, keys: Readonly<Record<string, string>>, changes: ChangeSet): void {
    const rest = TriggerKeys.without(keys, FlowConnector.CREATION_KEYS);
    if (Object.keys(rest).length) {
      changes.merge(new PropertyEditor(this.edit).set({ op: 'set', id: made.id, set: { ...rest } }));
    }
  }
}
