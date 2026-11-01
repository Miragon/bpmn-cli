import { type BpmnElement, ChangeEntries, ChangeSet, ElementSlots, PropertyCatalog } from '../model/index.js';
import type { SetOperation } from '../operations/index.js';
import { Artifacts } from './containers/Artifacts.js';
import { EventKeys } from './events/EventKeys.js';
import { RootElements } from './events/RootElements.js';
import { TriggerKeys } from './events/TriggerKeys.js';
import { ZeebeSubscription } from './events/ZeebeSubscription.js';
import { FlowIdFollower } from './flows/FlowIdFollower.js';
import { SequenceFlows } from './flows/SequenceFlows.js';
import { LaneMembership } from './LaneMembership.js';
import { ConditionKeys } from './properties/ConditionKeys.js';
import { DecisionLinkWriter } from './properties/DecisionLinkWriter.js';
import { DefaultFlowKey } from './properties/DefaultFlowKey.js';
import { IdRename } from './properties/IdRename.js';
import { LoopKeys } from './properties/LoopKeys.js';
import { NestedSlots } from './properties/NestedSlots.js';
import { PropertyCoercer } from './properties/PropertyCoercer.js';
import { VendorHosts } from './properties/VendorHosts.js';
import type { EditSession } from './session/EditSession.js';

type ChangeRecording = 'recorded by the key' | 'left to set';

type KeyWriter = (element: BpmnElement, value: string, key: string, changes: ChangeSet) => ChangeRecording;

interface NestedEntry {
  slot: string;
  key: string;
  value: string;
}

interface SortedKeys {
  eventKeys: Map<string, string>;
  conditionKeys: Map<string, string>;
  nested: NestedEntry[];
}

export class PropertyEditor {
  private static readonly EVENT_KEYS: readonly string[] = ['trigger', ...TriggerKeys.ALL];

  private readonly writers: Readonly<Record<string, KeyWriter>> = {
    id: (element, value, key, changes) => this.writeId(element, value, key, changes),
    name: (element, value) => this.writeName(element, value),
    doc: (element, value) => this.writeDocumentation(element, value),
    default: (element, value, _key, changes) => this.writeDefault(element, value, changes),
    source: (flow, value, key, changes) => this.writeEnd(flow, value, key, changes),
    target: (flow, value, key, changes) => this.writeEnd(flow, value, key, changes),
    loop: (activity, value, key, changes) => this.writeLoop(activity, value, key, changes),
    cardinality: (activity, value, key, changes) => this.writeLoop(activity, value, key, changes),
    completion: (activity, value, key, changes) => this.writeLoop(activity, value, key, changes),
    expanded: (subProcess, value, key, changes) => this.writeExpanded(subProcess, value, key, changes),
    message: (element, value, key, changes) => this.writeMessage(element, value, key, changes),
    calledDecision: (task, value, key, changes) => this.writeCalledDecision(task, value, key, changes),
    lane: (node, value, key, changes) => this.writeLane(node, value, key, changes),
  };

  constructor(private readonly edit: EditSession) {}

  private static normalizeKey(key: string): string {
    const trimmed = key.trim();
    if (trimmed === 'documentation') {
      return 'doc';
    }
    return trimmed.toLowerCase().startsWith('bpmn:') ? trimmed.slice(5) : trimmed;
  }

  writtenKeys(): string[] {
    return Object.keys(this.writers);
  }

  set(command: SetOperation): ChangeSet {
    const changes = new ChangeSet();
    const element = this.edit.require(command.id);
    const given = Object.entries(command.set).filter(([, value]) => value !== undefined);
    const entries = given.map(([key, value]): [string, string] => [PropertyEditor.normalizeKey(key), value]);
    this.assertDefaultWithoutCondition(element, entries);
    const keys = this.writePlainKeys(element, entries, changes);
    this.writeGroupedKeys(element, keys, changes);
    this.edit.document.tree.invalidate();
    RootElements.bindRefAs(changes, command.refAs, element);
    return changes;
  }

  setTaskMessage(task: BpmnElement, name: string, changes: ChangeSet): void {
    if (!name) {
      task.set('messageRef', undefined);
      return;
    }
    const { el: message, created } = new RootElements(this.edit).ensure('bpmn:Message', name);
    task.set('messageRef', message);
    if (created) {
      changes.create({ id: message.id, kind: 'message', name: message.get<string>('name'), detail: 'root element' });
    }
  }

  private assertDefaultWithoutCondition(element: BpmnElement, entries: ReadonlyArray<[string, string]>): void {
    if (!element.is('bpmn:SequenceFlow')) {
      return;
    }
    const wantsDefault = entries.some(([key, value]) => key === 'default' && value && PropertyCoercer.booleanOf(element, key, value));
    const wantsCondition = entries.some(([key, value]) => key === 'condition' && value);
    if (wantsDefault && wantsCondition) {
      throw PropertyCoercer.invalidValue(element, 'default', 'default=true and condition cannot be combined: a default flow has no condition', 'Set one of them, or condition= (empty) together with default=true.');
    }
  }

  private writePlainKeys(element: BpmnElement, entries: ReadonlyArray<[string, string]>, changes: ChangeSet): SortedKeys {
    const keys: SortedKeys = { eventKeys: new Map(), conditionKeys: new Map(), nested: [] };
    for (const [key, value] of entries) {
      const split = ElementSlots.splitKey(key);
      if (split) {
        keys.nested.push({ ...split, value });
      } else if (PropertyEditor.EVENT_KEYS.includes(key) && element.is('bpmn:Event')) {
        keys.eventKeys.set(key, value);
      } else if ((key === 'condition' || key === 'language') && element.is('bpmn:SequenceFlow')) {
        keys.conditionKeys.set(key, value);
      } else {
        this.applyKey(element, key, value, changes);
      }
    }
    return keys;
  }

  private writeGroupedKeys(element: BpmnElement, { eventKeys, conditionKeys, nested }: SortedKeys, changes: ChangeSet): void {
    const slots = new NestedSlots(this.edit);
    const coercer = new PropertyCoercer(this.edit);
    const flowCondition = element.is('bpmn:SequenceFlow') ? nested.filter((entry) => entry.slot === 'condition') : [];
    this.settleConditionResource(element, conditionKeys, flowCondition);
    for (const entry of flowCondition) {
      slots.setKey(element, entry.slot, entry.key, entry.value, changes, conditionKeys.has('condition'));
    }
    if (conditionKeys.size) {
      new ConditionKeys(this.edit).write(element, conditionKeys, changes);
    }
    const resourceRemoval = element.is('bpmn:Event') ? nested.filter((entry) => entry.slot === 'condition' && !entry.value && coercer.isResourceKey(entry.key)) : [];
    for (const entry of resourceRemoval) {
      slots.setKey(element, entry.slot, entry.key, entry.value, changes, eventKeys.has('when'));
    }
    if (eventKeys.size) {
      new EventKeys(this.edit).write(element, eventKeys, changes);
    }
    for (const entry of nested) {
      if (!flowCondition.includes(entry) && !resourceRemoval.includes(entry)) {
        slots.setKey(element, entry.slot, entry.key, entry.value, changes);
      }
    }
  }

  private settleConditionResource(element: BpmnElement, conditionKeys: Map<string, string>, flowCondition: readonly NestedEntry[]): void {
    const coercer = new PropertyCoercer(this.edit);
    const newResource = flowCondition.some((entry) => entry.value && coercer.isResourceKey(entry.key));
    if (!newResource) {
      return;
    }
    if (conditionKeys.get('condition')) {
      throw PropertyCoercer.invalidValue(element, 'condition', 'a condition is either an inline expression (condition=) or a script resource (condition.camunda:resource=), not both', 'Pass one of them; a script resource also needs language=<script language>.');
    }
    if (conditionKeys.has('condition')) {
      conditionKeys.delete('condition');
      element.get<BpmnElement | undefined>('conditionExpression')?.set('body', undefined);
    }
  }

  private applyKey(element: BpmnElement, key: string, given: string, changes: ChangeSet): void {
    const value = key.includes(':') ? new PropertyCoercer(this.edit).vendorValue(element, key, given) : given;
    const writer = this.writers[key];
    if (writer) {
      if (writer(element, value, key, changes) === 'recorded by the key') {
        return;
      }
    } else if (key.includes(':')) {
      if (this.applyVendorKey(element, key, value, changes)) {
        return;
      }
    } else {
      new PropertyCoercer(this.edit).setModelProperty(element, key, value);
    }
    changes.change(ChangeEntries.of(element, value ? `${key}=${value}` : `${key} removed`));
  }

  private applyVendorKey(element: BpmnElement, key: string, value: string, changes: ChangeSet): boolean {
    if (value && new ZeebeSubscription(this.edit.document).setCorrelationKey(element, key, value, changes)) {
      return true;
    }
    if (value) {
      new VendorHosts(this.edit).assertVendorHost(element, key, value);
      new VendorHosts(this.edit).assertZeebeHost(element, key, value);
    }
    PropertyCatalog.of(element).assertVendorKey(key);
    new PropertyCoercer(this.edit).setVendorAttribute(element, key, value);
    return false;
  }

  private writeId(element: BpmnElement, value: string, key: string, changes: ChangeSet): ChangeRecording {
    if (!value) {
      throw PropertyCoercer.invalidValue(element, key, 'an id cannot be empty');
    }
    const formerId = element.id;
    new FlowIdFollower(this.edit).recordFormerEnd(element);
    new IdRename(this.edit).rename(element, value);
    changes.change(ChangeEntries.of(element, `renamed from ${formerId}`));
    return 'recorded by the key';
  }

  private writeName(element: BpmnElement, value: string): ChangeRecording {
    new FlowIdFollower(this.edit).recordFormerEnd(element);
    if (element.is('bpmn:Group')) {
      new Artifacts(this.edit).setGroupName(element, value);
    } else {
      element.set('name', value || undefined);
    }
    return 'left to set';
  }

  private writeDocumentation(element: BpmnElement, value: string): ChangeRecording {
    const [first] = element.list('documentation');
    if (!value) {
      element.set('documentation', []);
    } else if (first) {
      first.set('text', value);
    } else {
      element.add('documentation', this.edit.document.tree.build('bpmn:Documentation', { text: value }));
    }
    return 'left to set';
  }

  private writeDefault(element: BpmnElement, value: string, changes: ChangeSet): ChangeRecording {
    new DefaultFlowKey(this.edit).write(element, value, changes);
    return 'left to set';
  }

  private writeEnd(flow: BpmnElement, value: string, key: string, changes: ChangeSet): ChangeRecording {
    if (!flow.is('bpmn:SequenceFlow')) {
      throw PropertyCatalog.of(flow).unknownKey(key, 'applies to sequence flows');
    }
    if (!value) {
      throw PropertyCoercer.invalidValue(flow, key, 'a flow always needs a source and a target');
    }
    const node = this.edit.require(value, 'bpmn:FlowNode');
    const sequenceFlows = new SequenceFlows(this.edit);
    const renamed = sequenceFlows.redirect(flow, key === 'source' ? { source: node } : { target: node });
    if (key === 'source') {
      sequenceFlows.dropIgnoredConditions(node, changes, [flow]);
    }
    changes.change(ChangeEntries.ofFlow(flow, `${ChangeEntries.ofFlow(flow).detail} (${key} changed)${ChangeEntries.renamedNote(renamed)}`));
    return 'recorded by the key';
  }

  private writeLoop(activity: BpmnElement, value: string, key: string, changes: ChangeSet): ChangeRecording {
    if (!activity.is('bpmn:Activity')) {
      throw PropertyCatalog.of(activity).unknownKey(key, 'applies to activities');
    }
    new LoopKeys(this.edit).write(activity, key, value, changes);
    return 'left to set';
  }

  private writeExpanded(element: BpmnElement, value: string, key: string, changes: ChangeSet): ChangeRecording {
    if (!element.is('bpmn:SubProcess')) {
      throw PropertyCatalog.of(element).unknownKey(key, 'applies to sub-processes');
    }
    changes.expansions.expand(element.id, value ? PropertyCoercer.booleanOf(element, key, value) : true);
    return 'left to set';
  }

  private writeMessage(element: BpmnElement, value: string, key: string, changes: ChangeSet): ChangeRecording {
    if (!element.is('bpmn:SendTask') && !element.is('bpmn:ReceiveTask') && !element.is('bpmn:MessageFlow')) {
      throw PropertyCatalog.of(element).unknownKey(key, 'applies to events, send tasks, receive tasks and message flows');
    }
    this.setTaskMessage(element, value, changes);
    return 'left to set';
  }

  private writeCalledDecision(element: BpmnElement, value: string, key: string, changes: ChangeSet): ChangeRecording {
    if (element.is('bpmn:BusinessRuleTask') || value) {
      changes.change(ChangeEntries.of(element, new DecisionLinkWriter(this.edit).write(element, value, changes)));
      return 'recorded by the key';
    }
    new PropertyCoercer(this.edit).setModelProperty(element, key, value);
    return 'left to set';
  }

  private writeLane(node: BpmnElement, value: string, key: string, changes: ChangeSet): ChangeRecording {
    if (!node.is('bpmn:FlowNode')) {
      throw PropertyCatalog.of(node).unknownKey(key, 'applies to flow nodes');
    }
    new LaneMembership(this.edit).assign(node, value ? this.edit.require(value, 'bpmn:Lane', 'lane') : undefined, changes);
    return 'left to set';
  }
}
