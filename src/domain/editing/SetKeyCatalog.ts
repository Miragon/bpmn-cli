import type { Doc } from '../document/Doc.js';
import type { EditContext } from '../document/EditContext.js';
import { ChangeSet } from '../document/ChangeSet.js';
import { triggerOf } from '../document/utils/kinds.js';
import { addTo, is, many, nameOf, type El } from '../document/utils/moddle.js';
import { idOf, isEl, ownValue } from '../document/utils/elements.js';
import { renamedNote } from '../document/utils/renames.js';
import { diExpansionState } from '../diagram/utils/expansion.js';
import { PropertyCoercer } from './PropertyCoercer.js';
import type { PropertyService } from './PropertyService.js';
import { IdRenameService } from './IdRenameService.js';
import { ArtifactService } from './ArtifactService.js';
import { LaneService } from './participants/LaneService.js';
import { expressionBody, flowConditionOf, multiInstanceOf, readIf } from './utils/set-key-values.js';
import { DecisionLinkWriter } from './DecisionLinkWriter.js';
import { EventTrigger } from './events/EventTrigger.js';
import { SequenceFlowService } from './flows/SequenceFlowService.js';
import { FlowIdFollower } from './flows/FlowIdFollower.js';

export interface SetKeyDoc {
  key: string;
  appliesTo: string;
  description: string;
}

export interface SetKeyWriting {
  doc: Doc;
  edit: EditContext;
  coercer: PropertyCoercer;
  properties: PropertyService;
  changes: ChangeSet;
}

export type ChangeRecording = 'recorded by the key' | 'left to set';

export interface SetKeyDefinition extends SetKeyDoc {
  read?: (el: El, doc: Doc) => Record<string, unknown>;
  write?: (writing: SetKeyWriting, el: El, value: string, key: string) => ChangeRecording;
}

const APPLIES_TO: Record<string, (el: El) => boolean> = {
  any: () => true,
  sequenceFlow: (el) => is(el, 'bpmn:SequenceFlow'),
  flowNode: (el) => is(el, 'bpmn:FlowNode'),
  event: (el) => is(el, 'bpmn:Event'),
  activity: (el) => is(el, 'bpmn:Activity'),
  subProcess: (el) => is(el, 'bpmn:SubProcess'),
  textAnnotation: (el) => is(el, 'bpmn:TextAnnotation'),
  'sendTask, receiveTask': (el) => is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask'),
  businessRuleTask: (el) => is(el, 'bpmn:BusinessRuleTask'),
  conditionalEvent: (el) => is(el, 'bpmn:Event') && triggerOf(el) === 'conditional',
};

export class SetKeyCatalog {
  static appliesTo(definition: SetKeyDoc, el: El): boolean {
    return !!APPLIES_TO[definition.appliesTo]?.(el);
  }

  static isPlaceholder(definition: SetKeyDoc): boolean {
    return definition.key.startsWith('<');
  }

  static docs(): SetKeyDoc[] {
    return SetKeyCatalog.KEYS.map(({ key, appliesTo, description }) => ({ key, appliesTo, description }));
  }

  static writerOf(key: string): SetKeyDefinition['write'] {
    return SetKeyCatalog.KEYS.find((definition) => definition.key === key && definition.write)?.write;
  }

  static readKeysBeforeGeneric(el: El, doc: Doc): Record<string, unknown> {
    return SetKeyCatalog.readAll(el, doc, SetKeyCatalog.KEYS.slice(0, SetKeyCatalog.genericPosition()));
  }

  static readKeysAfterGeneric(el: El, doc: Doc): Record<string, unknown> {
    return SetKeyCatalog.readAll(el, doc, SetKeyCatalog.KEYS.slice(SetKeyCatalog.genericPosition()));
  }

  private static genericPosition(): number {
    return SetKeyCatalog.KEYS.findIndex(SetKeyCatalog.isPlaceholder);
  }

  private static readAll(el: El, doc: Doc, definitions: SetKeyDefinition[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const definition of definitions) {
      if (definition.read && SetKeyCatalog.appliesTo(definition, el)) Object.assign(values, definition.read(el, doc));
    }
    return values;
  }

  static readonly KEYS: SetKeyDefinition[] = [
    {
      key: 'id',
      appliesTo: 'any',
      description: 'Rename the element; every reference (flows, lanes, boundary hosts, calledElement) follows, and so does a DI id derived from the old id (BPMNShape_<id>, <id>_di)',
      read: (el) => ({ id: idOf(el) }),
      write: (writing, el, value, key) => {
        if (!value) throw PropertyCoercer.invalid(el, key, 'an id cannot be empty');
        const formerId = idOf(el);
        new FlowIdFollower(writing.doc, writing.edit).recordFormerEnd(el);
        new IdRenameService(writing.doc, writing.edit).rename(el, value);
        writing.changes.change(ChangeSet.entryOf(el, `renamed from ${formerId}`));
        return 'recorded by the key';
      },
    },
    {
      key: 'name',
      appliesTo: 'any',
      description: 'Display name (empty value removes it; a group\'s name is the value of its category value)',
      read: (el) => readIf('name', nameOf(el)),
      write: (writing, el, value) => {
        new FlowIdFollower(writing.doc, writing.edit).recordFormerEnd(el);
        if (is(el, 'bpmn:Group')) new ArtifactService(writing.doc, writing.edit).setGroupName(el, value);
        else el.set('name', value || undefined);
        return 'left to set';
      },
    },
    {
      key: 'doc',
      appliesTo: 'any',
      description: 'Documentation text (alias: documentation; empty removes it)',
      read: (el) => {
        const docs = (ownValue(el, 'documentation') as El[] | undefined) ?? [];
        const text = docs
          .map((documentation) => documentation.get<string | undefined>('text'))
          .filter(Boolean)
          .join('\n');
        return readIf('doc', text);
      },
      write: SetKeyCatalog.writeDocumentation,
    },
    { key: '<prefix>:<attr>', appliesTo: 'any', description: 'Vendor attribute, e.g. camunda:assignee=alice or zeebe:modelerTemplate=x (xmlns declared automatically for known prefixes)' },
    { key: '<property>', appliesTo: 'any', description: 'Any attribute of the BPMN type by property name, e.g. isExecutable, calledElement, scriptFormat, script, implementation, isForCompensation, completionQuantity, gatewayDirection, instantiate' },
    {
      key: 'condition',
      appliesTo: 'sequenceFlow',
      description: 'Condition expression (empty removes it; clears the default marker of the flow)',
      read: (flow) => readIf('condition', flowConditionOf(flow)?.get<string | undefined>('body')),
    },
    {
      key: 'language',
      appliesTo: 'sequenceFlow',
      description: 'Expression language of the condition',
      read: (flow) => readIf('language', flowConditionOf(flow)?.get<string | undefined>('language')),
    },
    {
      key: 'default',
      appliesTo: 'sequenceFlow',
      description: 'true|false: make this flow the default flow of its source gateway/activity (removes its condition; a previous default flow loses the marker)',
      read: (flow) => readIf('default', flow.get<El | undefined>('sourceRef')?.get<El | undefined>('default') === flow),
      write: SetKeyCatalog.writeDefault,
    },
    {
      key: 'default',
      appliesTo: 'flowNode',
      description: 'Id of the default outgoing flow of a gateway/activity (empty clears it)',
      read: (node) => {
        const defaultFlow = ownValue(node, 'default');
        return isEl(defaultFlow) ? { default: idOf(defaultFlow) } : {};
      },
      write: SetKeyCatalog.writeDefault,
    },
    {
      key: 'source',
      appliesTo: 'sequenceFlow',
      description: 'Redirect the flow: new source node id',
      read: (flow) => {
        const source = flow.get<El | undefined>('sourceRef');
        return source ? { source: idOf(source) } : {};
      },
      write: SetKeyCatalog.writeEnd,
    },
    {
      key: 'target',
      appliesTo: 'sequenceFlow',
      description: 'Redirect the flow: new target node id',
      read: (flow) => {
        const target = flow.get<El | undefined>('targetRef');
        return target ? { target: idOf(target) } : {};
      },
      write: SetKeyCatalog.writeEnd,
    },
    {
      key: 'trigger',
      appliesTo: 'event',
      description: 'Event trigger: none|message|timer|error|signal|escalation|conditional|link|compensate|terminate|cancel',
      read: (event) => {
        const { trigger, opts } = new EventTrigger(event).read();
        const { timerKind: _ignored, ...triggerKeys } = opts;
        return { trigger, ...triggerKeys };
      },
    },
    { key: 'timer', appliesTo: 'event', description: 'ISO 8601 timer: R/PT1H (cycle), PT5M (duration) or a date; implies trigger=timer' },
    { key: 'message', appliesTo: 'event', description: 'Message name (a root bpmn:Message is created when missing); implies trigger=message' },
    { key: 'error', appliesTo: 'event', description: 'Error name (root bpmn:Error created when missing); implies trigger=error' },
    { key: 'errorCode', appliesTo: 'event', description: 'errorCode of the referenced bpmn:Error' },
    { key: 'signal', appliesTo: 'event', description: 'Signal name; implies trigger=signal' },
    { key: 'escalation', appliesTo: 'event', description: 'Escalation name; implies trigger=escalation' },
    { key: 'escalationCode', appliesTo: 'event', description: 'escalationCode of the referenced bpmn:Escalation' },
    { key: 'when', appliesTo: 'event', description: 'Condition expression of a conditional event; implies trigger=conditional' },
    { key: 'link', appliesTo: 'event', description: 'Link name of a link event; implies trigger=link' },
    { key: 'nonInterrupting', appliesTo: 'event', description: 'true|false: boundary events (cancelActivity) and event sub-process start events (isInterrupting); never for error/cancel/compensate triggers or untyped start events' },
    {
      key: 'loop',
      appliesTo: 'activity',
      description: 'none|standard|parallel|sequential (parallel/sequential = multi-instance)',
      read: (activity) => {
        const multiInstance = multiInstanceOf(activity);
        if (multiInstance) return { loop: multiInstance.get<boolean | undefined>('isSequential') ? 'sequential' : 'parallel' };
        return is(activity.get<El | undefined>('loopCharacteristics'), 'bpmn:StandardLoopCharacteristics') ? { loop: 'standard' } : {};
      },
      write: SetKeyCatalog.writeLoop,
    },
    {
      key: 'cardinality',
      appliesTo: 'activity',
      description: 'Multi-instance loop cardinality expression (creates a parallel multi-instance loop when none exists)',
      read: (activity) => readIf('cardinality', expressionBody(multiInstanceOf(activity), 'loopCardinality')),
      write: SetKeyCatalog.writeLoop,
    },
    {
      key: 'completion',
      appliesTo: 'activity',
      description: 'Multi-instance completion condition expression (an ad-hoc sub-process without a multi-instance loop: its own completion condition)',
      read: (activity) => {
        const multiInstance = multiInstanceOf(activity);
        if (multiInstance) return readIf('completion', expressionBody(multiInstance, 'completionCondition'));
        return is(activity, 'bpmn:AdHocSubProcess') ? readIf('completion', expressionBody(activity, 'completionCondition')) : {};
      },
      write: SetKeyCatalog.writeLoop,
    },
    {
      key: 'expanded',
      appliesTo: 'subProcess',
      description: 'true|false: draw the sub-process expanded (default) or collapsed',
      read: (subProcess, doc) => ({ expanded: doc.layoutRequests.requested(idOf(subProcess)) ?? diExpansionState(doc.definitions).get(idOf(subProcess)) ?? true }),
      write: (writing, el, value, key) => {
        if (!is(el, 'bpmn:SubProcess')) throw writing.coercer.unknownKey(el, key, 'applies to sub-processes');
        writing.doc.layoutRequests.expand(idOf(el), value ? PropertyCoercer.bool(el, key, value) : true);
        return 'left to set';
      },
    },
    { key: 'triggeredByEvent', appliesTo: 'subProcess', description: 'true|false: event sub-process' },
    {
      key: 'message',
      appliesTo: 'sendTask, receiveTask',
      description: 'Message name of a send / receive task (a root bpmn:Message is created when missing; empty removes the reference)',
      read: (task) => {
        const message = ownValue(task, 'messageRef');
        return isEl(message) ? { message: message.get<string | undefined>('name') ?? idOf(message) } : {};
      },
      write: (writing, el, value, key) => {
        if (!is(el, 'bpmn:SendTask') && !is(el, 'bpmn:ReceiveTask')) throw writing.coercer.unknownKey(el, key, 'applies to events, send tasks and receive tasks');
        writing.properties.setTaskMessage(el, value, writing.changes);
        return 'left to set';
      },
    },
    {
      key: 'calledDecision',
      appliesTo: 'businessRuleTask',
      description: 'The decision the task calls, in the spelling of the file\'s platform: camunda:decisionRef in Camunda 7, a zeebe:calledDecision decisionId in Camunda 8, bpmn-cli\'s own unprefixed calledDecision="<id>" without an engine. With the library\'s platform \'none\' a link in an engine spelling keeps it (a zeebe:calledDecision its resultVariable too) and a new link takes the engine spelling all the file\'s other links share (the other spellings are removed; empty removes the link)',
      write: (writing, el, value, key) => {
        if (is(el, 'bpmn:BusinessRuleTask') || value) {
          writing.changes.change(ChangeSet.entryOf(el, new DecisionLinkWriter(writing.doc, writing.edit).write(el, value, writing.changes)));
          return 'recorded by the key';
        }
        writing.properties.setModelProperty(el, key, value);
        return 'left to set';
      },
    },
    { key: 'definition.<key>', appliesTo: 'event', description: "Attribute of the event definition, e.g. definition.camunda:errorCodeVariable=code, definition.camunda:type=external + definition.camunda:topic=x (message throw / end), definition.camunda:variableName=amount (conditional); an event with several event definitions takes 'definition[<n>].<key>' (0-based) or 'definition[<trigger>].<key>'" },
    { key: 'loop.<key>', appliesTo: 'activity', description: 'Attribute of the loop characteristics, e.g. loop.camunda:collection=${items}, loop.camunda:elementVariable=item, loop.camunda:asyncBefore=true (creates a parallel multi-instance loop when none exists)' },
    { key: 'condition.<key>', appliesTo: 'sequenceFlow', description: 'Attribute of the condition expression, e.g. condition.camunda:resource=deployment://check.groovy (a script resource condition; set language= too)' },
    { key: 'condition.<key>', appliesTo: 'conditionalEvent', description: 'Attribute of the condition expression of a conditional event, e.g. condition.camunda:resource=deployment://ready.groovy condition.language=groovy; the event definition itself is definition.<key> (definition.camunda:variableName=amount)' },
    {
      key: 'lane',
      appliesTo: 'flowNode',
      description: 'Lane id the node belongs to (empty removes lane membership)',
      read: (node, doc) => {
        const lanes = doc.lanesOf(node);
        const innermostLane = lanes[lanes.length - 1];
        return innermostLane ? { lane: idOf(innermostLane) } : {};
      },
      write: (writing, el, value, key) => {
        if (!is(el, 'bpmn:FlowNode')) throw writing.coercer.unknownKey(el, key, 'applies to flow nodes');
        new LaneService(writing.doc, writing.edit).assign(el, value ? writing.edit.require(value, 'bpmn:Lane', 'lane') : undefined, writing.changes);
        return 'left to set';
      },
    },
    { key: 'text', appliesTo: 'textAnnotation', description: 'Annotation text' },
  ];

  private static writeEnd(writing: SetKeyWriting, flow: El, value: string, key: string): ChangeRecording {
    if (!is(flow, 'bpmn:SequenceFlow')) throw writing.coercer.unknownKey(flow, key, 'applies to sequence flows');
    if (!value) throw PropertyCoercer.invalid(flow, key, 'a flow always needs a source and a target');
    const node = writing.edit.require(value, 'bpmn:FlowNode');
    const flows = new SequenceFlowService(writing.doc, writing.edit);
    const renamed = flows.redirect(flow, key === 'source' ? { source: node } : { target: node });
    if (key === 'source') flows.dropIgnoredConditions(node, writing.changes, [flow]);
    writing.changes.change(ChangeSet.flowEntryOf(flow, `${ChangeSet.flowEntryOf(flow).detail} (${key} changed)${renamedNote(renamed)}`));
    return 'recorded by the key';
  }

  private static writeLoop(writing: SetKeyWriting, el: El, value: string, key: string): ChangeRecording {
    if (!is(el, 'bpmn:Activity')) throw writing.coercer.unknownKey(el, key, 'applies to activities');
    writing.properties.setLoopKey(el, key, value, writing.changes);
    return 'left to set';
  }

  private static writeDefault(writing: SetKeyWriting, el: El, value: string): ChangeRecording {
    writing.properties.setDefaultKey(el, value, writing.changes);
    return 'left to set';
  }

  private static writeDocumentation(writing: SetKeyWriting, el: El, value: string): ChangeRecording {
    const docs = many(el, 'documentation');
    if (!value) docs.splice(0, docs.length);
    else if (docs[0]) docs[0].set('text', value);
    else addTo(el, 'documentation', writing.doc.moddle.create('bpmn:Documentation', { text: value }));
    return 'left to set';
  }
}

export const SET_KEYS = SetKeyCatalog.KEYS;
