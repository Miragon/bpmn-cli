import { NestedSlots } from './NestedSlots.js';
import { PropertyCoercer } from './PropertyCoercer.js';
import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { IdRenamer } from './IdRenamer.js';
import { kindLabel, kindOf, normalizeTrigger, triggerOf, TRIGGER_TYPES, type Trigger } from '../model/utils/kinds.js';
import { addTo, is, many, walk, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { descriptorOf, idOf, typeLabel, vendorContent } from './utils/elements.js';
import { definitionsOf, slotsOf, SLOT_TEXT, splitNestedKey, type NestedSlot } from './utils/nested-slots.js';
import { ArtifactEditor } from './ArtifactEditor.js';
import { LaneEditor } from './LaneEditor.js';
import { DecisionLinkWriter } from './DecisionLinkWriter.js';
import { TRIGGER_OPTION_KEYS } from './EventTrigger.js';
import { TriggerChange } from './TriggerChange.js';
import { ZeebeSubscription } from './ZeebeSubscription.js';
import { renamedNote } from '../model/utils/renames.js';
import type { SetOp, TriggerOptions } from './types.js';
import { CAMUNDA } from '../platform/CamundaDescriptor.js';
import { ZEEBE, ZEEBE_URI } from '../platform/ZeebeDescriptor.js';
import { SequenceFlows } from './SequenceFlows.js';
import { FlowIdFollower } from './FlowIdFollower.js';
import { FlowRules } from '../model/FlowRules.js';
import { RootElements } from './RootElements.js';

// timerKind is left out: set classifies a timer value itself
const EVENT_KEYS = new Set<string>(['trigger', ...TRIGGER_OPTION_KEYS.filter((k) => k !== 'timerKind')]);

const TRIGGER_OF_KEY: Record<string, Trigger> = {
  timer: 'timer',
  message: 'message',
  error: 'error',
  errorCode: 'error',
  signal: 'signal',
  escalation: 'escalation',
  escalationCode: 'escalation',
  when: 'conditional',
  link: 'link',
};

/**
 * `set`: key=value properties of one element; keys are what `show <id>` prints.
 * Nested elements without an id are addressed by prefix (`definition.`, `loop.`, `condition.`);
 * an empty value or --unset removes the property.
 */
export class PropertySetter {
  private readonly coercer: PropertyCoercer;
  private readonly slots: NestedSlots;

  constructor(private readonly doc: Doc) {
    this.coercer = new PropertyCoercer(doc);
    this.slots = new NestedSlots(doc);
  }

  private static normalizeKey(key: string): string {
    const k = key.trim();
    if (k === 'documentation') return 'doc';
    if (k.toLowerCase().startsWith('bpmn:')) return k.slice(5);
    return k;
  }

  private expression(body: string, parent: El, language?: string): El {
    const expr = this.doc.moddle.create('bpmn:FormalExpression', { body, ...(language ? { language } : {}) });
    expr.$parent = parent;
    return expr;
  }

  set(op: SetOp): ChangeSet {
    const cs = new ChangeSet();
    const el = this.doc.require(op.id);
    const entries: Array<[string, string]> = [
      ...Object.entries(op.values ?? {}).map(([k, v]) => [PropertySetter.normalizeKey(k), v === undefined || v === null ? '' : String(v)] as [string, string]),
      ...(op.unset ?? []).map((k) => [PropertySetter.normalizeKey(k), ''] as [string, string]),
    ];
    if (!entries.length) {
      throw usageError('Nothing to set: pass key=value pairs (or --unset <key>)', { element: op.id, hint: `Settable keys: ${this.coercer.settableKeys(el).join(', ')}` });
    }
    const eventKeys = new Map<string, string>();
    const conditionKeys = new Map<string, string>();
    const nested: Array<{ slot: string; key: string; value: string }> = [];
    if (is(el, 'bpmn:SequenceFlow')) {
      const wantsDefault = entries.some(([k, v]) => k === 'default' && v && PropertyCoercer.bool(el, k, v));
      const wantsCondition = entries.some(([k, v]) => k === 'condition' && v);
      if (wantsDefault && wantsCondition) {
        throw PropertyCoercer.invalid(el, 'default', 'default=true and condition cannot be combined: a default flow has no condition', 'Set one of them, or condition= (empty) together with default=true.');
      }
    }
    for (const [key, value] of entries) {
      const split = splitNestedKey(key);
      if (split) {
        nested.push({ ...split, value });
        continue;
      }
      if (EVENT_KEYS.has(key) && is(el, 'bpmn:Event')) {
        eventKeys.set(key, value);
        continue;
      }
      if ((key === 'condition' || key === 'language') && is(el, 'bpmn:SequenceFlow')) {
        conditionKeys.set(key, value);
        continue;
      }
      this.applyKey(el, key, value, cs);
    }
    /**
     * Nested keys run after the keys that create their element (loop=, trigger=, when=);
     * a flow's condition.* keys run first, so that a script resource condition can take a language=
     */
    const flowCondition = is(el, 'bpmn:SequenceFlow') ? nested.filter((n) => n.slot === 'condition') : [];
    const newResource = flowCondition.some((n) => n.value && this.coercer.isResourceKey(n.key));
    if (conditionKeys.get('condition') && newResource) {
      throw PropertyCoercer.invalid(el, 'condition', 'a condition is either an inline expression (condition=) or a script resource (condition.camunda:resource=), not both', 'Pass one of them; a script resource also needs language=<script language>.');
    }
    if (conditionKeys.has('condition') && newResource) {
      conditionKeys.delete('condition');
      el.get<El | undefined>('conditionExpression')?.set('body', undefined);
    }
    for (const n of flowCondition) this.slots.apply(el, n.slot, n.key, n.value, cs, conditionKeys.has('condition'));
    if (conditionKeys.size) this.applyCondition(el, conditionKeys, cs);
    // a conditional event's script resource goes first, so that when= fills the condition
    const resourceRemoval = is(el, 'bpmn:Event') ? nested.filter((n) => n.slot === 'condition' && !n.value && this.coercer.isResourceKey(n.key)) : [];
    for (const n of resourceRemoval) this.slots.apply(el, n.slot, n.key, n.value, cs, eventKeys.has('when'));
    if (eventKeys.size) this.applyEventKeys(el, eventKeys, cs);
    for (const n of nested) if (!flowCondition.includes(n) && !resourceRemoval.includes(n)) this.slots.apply(el, n.slot, n.key, n.value, cs);
    this.doc.invalidate();
    new RootElements(this.doc).bindRefAs(cs, op.refAs, el);
    return cs;
  }

  private applyKey(el: El, key: string, value: string, cs: ChangeSet): void {
    if (key.includes(':')) value = this.coercer.vendorValue(el, key, value);
    const detail = value ? `${key}=${value}` : `${key} removed`;
    switch (key) {
      case 'id': {
        if (!value) throw PropertyCoercer.invalid(el, key, 'an id cannot be empty');
        const old = idOf(el);
        new FlowIdFollower(this.doc).recordFormerEnd(el);
        new IdRenamer(this.doc).rename(el, value);
        cs.change(ChangeSet.entryOf(el, `renamed from ${old}`));
        return;
      }
      case 'name':
        new FlowIdFollower(this.doc).recordFormerEnd(el);
        if (is(el, 'bpmn:Group')) new ArtifactEditor(this.doc).setGroupName(el, value);
        else el.set('name', value || undefined);
        break;
      case 'doc':
        this.setDocumentation(el, value);
        break;
      case 'default':
        this.setDefaultKey(el, value, cs);
        break;
      case 'source':
      case 'target': {
        if (!is(el, 'bpmn:SequenceFlow')) throw this.coercer.unknownKey(el, key, 'applies to sequence flows');
        if (!value) throw PropertyCoercer.invalid(el, key, 'a flow always needs a source and a target');
        const node = this.doc.require(value, 'bpmn:FlowNode');
        const renamed = new SequenceFlows(this.doc).redirect(el, key === 'source' ? { source: node } : { target: node });
        if (key === 'source') new SequenceFlows(this.doc).dropIgnoredConditions(node, cs, [el]);
        cs.change(ChangeSet.flowEntryOf(el, `${ChangeSet.flowEntryOf(el).detail} (${key} changed)${renamedNote(renamed)}`));
        return;
      }
      case 'loop':
      case 'cardinality':
      case 'completion':
        if (!is(el, 'bpmn:Activity')) throw this.coercer.unknownKey(el, key, 'applies to activities');
        this.setLoopKey(el, key, value, cs);
        break;
      case 'expanded': {
        if (!is(el, 'bpmn:SubProcess')) throw this.coercer.unknownKey(el, key, 'applies to sub-processes');
        this.doc.layoutRequests.expand(idOf(el), value ? PropertyCoercer.bool(el, key, value) : true);
        break;
      }
      case 'lane': {
        if (!is(el, 'bpmn:FlowNode')) throw this.coercer.unknownKey(el, key, 'applies to flow nodes');
        new LaneEditor(this.doc).assign(el, value ? this.doc.require(value, 'bpmn:Lane', 'lane') : undefined, cs);
        break;
      }
      case 'message':
        if (!is(el, 'bpmn:SendTask') && !is(el, 'bpmn:ReceiveTask')) throw this.coercer.unknownKey(el, key, 'applies to events, send tasks and receive tasks');
        this.setTaskMessage(el, value, cs);
        break;
      case 'calledDecision':
        // BPMN defines no unprefixed calledDecision on other elements: it can only be removed
        if (is(el, 'bpmn:BusinessRuleTask') || value) {
          cs.change(ChangeSet.entryOf(el, new DecisionLinkWriter(this.doc).write(el, value, cs)));
          return;
        }
        this.setModelProperty(el, key, value);
        break;
      default:
        if (key.includes(':')) {
          if (value && new ZeebeSubscription(this.doc).setCorrelationKey(el, key, value, cs)) return;
          if (value) this.assertVendorHost(el, key, value);
          if (value) this.assertZeebeHost(el, key, value);
          this.coercer.setVendorAttribute(el, key, value);
        } else this.setModelProperty(el, key, value);
    }
    cs.change(ChangeSet.entryOf(el, detail));
  }

  /** The root bpmn:Message is found by id or name, or created like an event's message trigger. */
  setTaskMessage(task: El, name: string, cs: ChangeSet): void {
    if (!name) {
      task.set('messageRef', undefined);
      return;
    }
    const { el: message, created } = new RootElements(this.doc).ensure('bpmn:Message', name);
    task.set('messageRef', message);
    if (created) cs.create({ id: idOf(message), kind: 'message', name: message.get<string>('name'), detail: 'root element' });
  }

  private setDocumentation(el: El, value: string): void {
    const docs = many(el, 'documentation');
    if (!value) {
      docs.splice(0, docs.length);
      return;
    }
    const first = docs[0];
    if (first) first.set('text', value);
    else addTo(el, 'documentation', this.doc.moddle.create('bpmn:Documentation', { text: value }));
  }

  /** A default flow has no condition: the flow's own one is removed with a warning. */
  private makeDefaultFlow(flow: El, cs: ChangeSet): void {
    const source = flow.get<El>('sourceRef');
    const previous = source.get<El | undefined>('default');
    const expr = flow.get<El | undefined>('conditionExpression');
    const resourceKey = this.coercer.resourceKeyOf(expr);
    const condition = expr?.get<string | undefined>('body') ?? (resourceKey ? `${resourceKey}=${String(expr!.$attrs[resourceKey])}` : undefined);
    new SequenceFlows(this.doc).setDefault(flow, true);
    if (condition) {
      cs.warn({
        code: 'W_CONDITION_DROPPED',
        message: `Condition "${condition}" of ${idOf(flow)} was removed: a default flow has no condition`,
        element: idOf(flow),
        hint: 'Default flows are taken when no other condition matches; set the condition on another outgoing flow if it is still needed.',
      });
    }
    if (previous && previous !== flow) cs.change(ChangeSet.entryOf(previous, `no longer the default flow of ${idOf(source)}`));
  }

  private setDefaultKey(el: El, value: string, cs: ChangeSet): void {
    if (is(el, 'bpmn:SequenceFlow')) {
      if (value && PropertyCoercer.bool(el, 'default', value)) this.makeDefaultFlow(el, cs);
      else new SequenceFlows(this.doc).setDefault(el, false);
      return;
    }
    if (!descriptorOf(el).propertiesByName?.['default']) {
      throw this.coercer.unknownKey(el, 'default', 'only exclusive/inclusive/complex gateways, activities and sequence flows have a default');
    }
    if (!value) {
      el.set('default', undefined);
      return;
    }
    const flow = this.doc.require(value, 'bpmn:SequenceFlow', 'sequence flow');
    if (flow.get<El | undefined>('sourceRef') !== el) {
      throw modelError('E_NOT_OUTGOING', `${value} is not an outgoing flow of ${idOf(el)}`, {
        element: idOf(el),
        related: [value],
        candidates: this.doc.outgoing(el).map(idOf),
        hint: `Outgoing flows of ${idOf(el)}: ${this.doc.outgoing(el).map(idOf).join(', ') || 'none'}.`,
      });
    }
    this.makeDefaultFlow(flow, cs);
  }

  private setLoopKey(el: El, key: string, value: string, cs: ChangeSet): void {
    const current = el.get<El | undefined>('loopCharacteristics');
    const isMulti = is(current, 'bpmn:MultiInstanceLoopCharacteristics');
    // an ad-hoc sub-process has a completion condition of its own
    if (key === 'completion' && is(el, 'bpmn:AdHocSubProcess') && !isMulti) {
      el.set('completionCondition', value ? this.expression(value, el) : undefined);
      return;
    }
    if (key === 'loop') {
      const mode = (value || 'none').trim().toLowerCase();
      if (mode === 'none') {
        el.set('loopCharacteristics', undefined);
        if (current) this.dropLoop(el, current, mode, cs);
      } else if (mode === 'standard') {
        if (!is(current, 'bpmn:StandardLoopCharacteristics')) {
          const loop = this.doc.moddle.create('bpmn:StandardLoopCharacteristics');
          loop.$parent = el;
          el.set('loopCharacteristics', loop);
          if (current) this.dropLoop(el, current, mode, cs);
        }
      } else if (mode === 'parallel' || mode === 'sequential') {
        const multi = isMulti ? current! : this.createMultiInstance(el);
        multi.set('isSequential', mode === 'sequential');
        if (current && !isMulti) this.dropLoop(el, current, mode, cs);
      } else {
        throw PropertyCoercer.invalid(el, key, `"${value}" is not one of none|standard|parallel|sequential`);
      }
      return;
    }
    const prop = key === 'cardinality' ? 'loopCardinality' : 'completionCondition';
    if (!value) {
      if (isMulti) current!.set(prop, undefined);
      return;
    }
    if (current && !isMulti) {
      throw PropertyCoercer.invalid(el, key, `${key} needs a multi-instance loop, but ${idOf(el)} has a standard loop`, 'Set loop=parallel or loop=sequential first.');
    }
    let multi = current;
    if (!multi) {
      multi = this.createMultiInstance(el);
      cs.note(`${idOf(el)}: created a parallel multi-instance loop for ${key}`);
    }
    multi.set(prop, this.expression(value, multi));
  }

  private createMultiInstance(el: El): El {
    const multi = this.doc.moddle.create('bpmn:MultiInstanceLoopCharacteristics');
    multi.$parent = el;
    el.set('loopCharacteristics', multi);
    return multi;
  }

  private dropLoop(el: El, old: El, mode: string, cs: ChangeSet): void {
    for (const e of walk(old, { bpmnOnly: true })) {
      const id = e.get<string | undefined>('id');
      if (id) this.doc.ids.release(id);
    }
    const lost = vendorContent(old);
    if (!lost.length) return;
    const oldId = old.get<string | undefined>('id');
    cs.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `${lost.join(', ')} of the ${typeLabel(old)}${oldId ? ` ${oldId}` : ''} of ${idOf(el)} ${lost.length > 1 ? 'were' : 'was'} dropped: loop=${mode} ${mode === 'none' ? 'removes the loop' : 'replaces it'}`,
      element: idOf(el),
      hint: 'Vendor attributes and extension elements belong to the old loop characteristics; set what the new loop still needs with `bpmn set <file> <id> loop.<prefix>:<attr>=<value>`.',
    });
  }

  private setModelProperty(el: El, key: string, value: string): void {
    if (PropertyCoercer.removeUndefined(el, key, value)) return;
    const p = descriptorOf(el).propertiesByName?.[key];
    if (!p || key === 'id') throw this.coercer.unknownKey(el, key);
    const blocked = this.coercer.blockedReason(key);
    if (blocked) throw this.coercer.unknownKey(el, key, blocked);
    if (!this.coercer.isSettable(p)) throw this.coercer.unknownKey(el, key, `${key} is not an attribute`);
    if (!value) {
      el.set(key, undefined);
      return;
    }
    el.set(key, this.coercer.coerce(el, p, value));
  }

  private static isJuel(body: string): boolean {
    return /^\s*[$#]\{[\s\S]*\}\s*$/.test(body);
  }

  /**
   * Updates the expression in place, so its id and vendor attributes stay. An inline body
   * replacing a script resource drops camunda:resource; a JUEL body never inherits a language.
   */
  private applyCondition(flow: El, keys: Map<string, string>, cs: ChangeSet): void {
    const existing = flow.get<El | undefined>('conditionExpression');
    const oldBody = existing?.get<string | undefined>('body');
    const oldLanguage = existing?.get<string | undefined>('language');
    const resourceKey = this.coercer.resourceKeyOf(existing);
    const hasCondition = !!existing && (!!oldBody || !!resourceKey);
    if (!keys.has('condition')) {
      const language = keys.get('language') || undefined;
      if (!hasCondition) {
        if (language) throw modelError('E_NO_CONDITION', `${idOf(flow)} has no condition to set a language on`, { element: idOf(flow), hint: 'Set condition=<expression> (or condition.camunda:resource=<uri>) too.' });
        return;
      }
      existing!.set('language', language);
      cs.change(ChangeSet.entryOf(flow, language ? `language=${language}` : 'language removed'));
      return;
    }
    const condition = keys.get('condition') ?? '';
    if (!condition) {
      if (keys.get('language')) throw modelError('E_NO_CONDITION', `${idOf(flow)} has no condition to set a language on`, { element: idOf(flow), hint: 'Set condition=<expression> too.' });
      new SequenceFlows(this.doc).setCondition(flow, undefined);
      cs.change(ChangeSet.entryOf(flow, 'condition removed'));
      return;
    }
    new FlowRules(this.doc).assertCondition(condition);
    const dropped: string[] = [];
    let language: string | undefined;
    if (keys.has('language')) language = keys.get('language') || undefined;
    else if (oldLanguage && resourceKey) dropped.push(`language ${oldLanguage}`);
    else if (oldLanguage && PropertySetter.isJuel(condition) && oldLanguage.toLowerCase() !== 'juel') dropped.push(`language ${oldLanguage}`);
    else language = oldLanguage;
    if (!existing || !is(existing, 'bpmn:FormalExpression')) {
      new SequenceFlows(this.doc).setCondition(flow, condition, language);
    } else {
      if (resourceKey) {
        dropped.unshift(`${resourceKey} ${String(existing.$attrs[resourceKey])}`);
        delete existing.$attrs[resourceKey];
      }
      existing.set('body', condition);
      existing.set('language', language);
      const source = flow.get<El | undefined>('sourceRef');
      if (source?.get<El | undefined>('default') === flow) source.set('default', undefined);
    }
    if (dropped.length) {
      cs.warn({
        code: 'W_PROPERTY_DROPPED',
        message: `${dropped.join(' and ')} of the condition of ${idOf(flow)} ${dropped.length > 1 ? 'were' : 'was'} dropped: ${resourceKey ? 'the inline condition replaces the script resource' : `"${condition}" is an expression, not a ${oldLanguage} script`}`,
        element: idOf(flow),
        hint: resourceKey
          ? 'To keep a script resource set condition.camunda:resource=<uri> (and language=<lang>) instead of condition=; to run the inline body as a script add language=<lang>.'
          : `Pass language=${oldLanguage} together with condition= to keep the script language.`,
      });
    }
    cs.change(ChangeSet.entryOf(flow, `condition=${condition}${language ? ` (${language})` : ''}`));
  }

  private static shellPair(key: string, value: string): string {
    const pair = `${key}=${value}`;
    return /^[\w.:/,-]*$/.test(value) && /^[\w.:-]*$/.test(key) ? pair : `'${pair.replace(/'/g, "'\\''")}'`;
  }

  /** A nested slot of `el`, or for a participant its process; undefined when nowhere near `el`. */
  private static placeFor(el: El, name: string): { slot?: NestedSlot; prefix?: string; trigger?: Exclude<Trigger, 'none'>; element?: El } | undefined {
    if (is(el, 'bpmn:Event')) {
      const defs = definitionsOf(el);
      const fit = defs.findIndex((d) => CAMUNDA.attrAppliesTo(name, d));
      if (fit !== -1) return { slot: 'definition', prefix: defs.length > 1 ? `definition[${fit}]` : 'definition' };
      if (slotsOf(el).includes('condition') && CAMUNDA.attrAppliesTo(name, 'bpmn:FormalExpression')) return { slot: 'condition' };
      const current = triggerOf(el);
      for (const t of kindOf(el)?.triggers ?? []) {
        if (t === 'none' || t === current) continue;
        if (CAMUNDA.attrAppliesTo(name, TRIGGER_TYPES[t])) return { slot: 'definition', trigger: t };
      }
    }
    if (is(el, 'bpmn:Activity') && CAMUNDA.attrAppliesTo(name, 'bpmn:MultiInstanceLoopCharacteristics')) return { slot: 'loop' };
    if (is(el, 'bpmn:SequenceFlow') && CAMUNDA.attrAppliesTo(name, 'bpmn:FormalExpression')) return { slot: 'condition' };
    if (is(el, 'bpmn:Participant')) {
      const process = el.get<El | undefined>('processRef');
      if (process && CAMUNDA.attrAppliesTo(name, process)) return { element: process };
    }
    return undefined;
  }

  private assertVendorHost(el: El, key: string, value: string): void {
    const local = this.coercer.camundaLocal(key);
    if (!local) return;
    const name = `camunda:${local}`;
    if (CAMUNDA.attrAppliesTo(name, el) !== false) return;
    const place = PropertySetter.placeFor(el, name);
    if (!place) return;
    const id = idOf(el);
    if (place.element) {
      throw modelError('E_WRONG_HOST', `${key} is an attribute of the process, not of participant ${id}`, {
        element: id,
        related: [idOf(place.element)],
        hint: `Use \`bpmn set <file> ${idOf(place.element)} ${PropertySetter.shellPair(key, value)}\`.`,
      });
    }
    const slot = place.slot!;
    throw modelError('E_WRONG_HOST', `${key} does not belong on ${kindLabel(el)} ${id}: it is an attribute of its ${SLOT_TEXT[slot]}${place.trigger ? ` (${TRIGGER_TYPES[place.trigger].replace('bpmn:', '')})` : ''}`, {
      element: id,
      hint: `Use \`bpmn set <file> ${id} ${place.trigger ? `trigger=${place.trigger} ` : ''}${PropertySetter.shellPair(`${place.prefix ?? slot}.${key}`, value)}\`${place.trigger ? ` (${id} needs a ${place.trigger} trigger for it)` : ''}.`,
    });
  }

  /**
   * Camunda 8 settings live on extension elements (zeebe:type on zeebe:taskDefinition),
   * so the hint names the `ext add` that writes them.
   */
  private assertZeebeHost(el: El, key: string, value: string): void {
    const idx = key.indexOf(':');
    if (idx <= 0 || this.doc.namespaceUri(key.slice(0, idx)) !== ZEEBE_URI) return;
    const local = key.slice(idx + 1);
    if (ZEEBE.attr(local)) return;
    const prefix = key.slice(0, idx);
    const id = idOf(el);
    const pair = PropertySetter.shellPair(local, value);
    const owners = ZEEBE.typeNames().filter((t) => ZEEBE.type(t)!.attributes.some((a) => a.name === local));
    const here = owners.filter((t) => ZEEBE.allowedOn(t, el) === true);
    const loop = is(el, 'bpmn:Activity') && owners.includes('zeebe:loopCharacteristics');
    const message = owners.includes('zeebe:subscription') && (is(el, 'bpmn:ReceiveTask') || is(el, 'bpmn:Event'));
    if (!here.length && !loop && !message) return;
    const target = here[0] ?? (loop ? 'zeebe:loopCharacteristics' : 'zeebe:subscription');
    const type = `${prefix}:${target.slice('zeebe:'.length)}`;
    const command = here.length
      ? `\`bpmn ext add <file> ${id} ${type} ${pair}\``
      : loop
        ? `\`bpmn ext add <file> ${id} loop.${type} ${pair}\` (creates a parallel multi-instance loop when there is none)`
        : is(el, 'bpmn:ReceiveTask') || definitionsOf(el).some((d) => is(d, 'bpmn:MessageEventDefinition'))
          ? `\`bpmn set <file> ${id} message=<MessageName>\` first (the correlation key belongs to the message the element waits for), then \`bpmn set <file> ${id} ${PropertySetter.shellPair(key, value)}\``
          : `\`bpmn ext add <file> <messageId> ${type} ${pair}\` on a bpmn:Message (${kindLabel(el)} ${id} waits for no message)`;
    throw modelError('E_WRONG_HOST', `${key} is not an attribute of ${kindLabel(el)} ${id}: Camunda 8 reads ${local} on the ${type} extension element`, {
      element: id,
      hint: `Use ${command}.`,
    });
  }

  private applyEventKeys(el: El, keys: Map<string, string>, cs: ChangeSet): void {
    const def = kindOf(el);
    const allowed = def?.triggers ?? [];
    const change = new TriggerChange(this.doc, el);
    const current = change.current;
    let requested: Trigger | undefined;
    if (keys.has('trigger')) {
      const raw = keys.get('trigger') ?? '';
      requested = raw ? normalizeTrigger(raw) : 'none';
      if (!requested) throw PropertyCoercer.invalid(el, 'trigger', `unknown trigger "${raw}"`, `Allowed on ${def?.kind ?? kindLabel(el)}: ${allowed.join(', ')}.`);
    }
    const given: Record<string, unknown> = {};
    let nonInterrupting: boolean | undefined;
    for (const [key, value] of keys) {
      if (key === 'trigger') continue;
      if (key === 'nonInterrupting') {
        nonInterrupting = value ? PropertyCoercer.bool(el, key, value) : false;
        continue;
      }
      const implied = TRIGGER_OF_KEY[key]!;
      if (requested === undefined) requested = implied;
      else if (requested !== implied) throw PropertyCoercer.invalid(el, key, `${key} belongs to the ${implied} trigger, not ${requested}`);
      if (!value && key !== 'errorCode' && key !== 'escalationCode') {
        throw PropertyCoercer.invalid(el, key, `${key} needs a value`, 'Use trigger=none to remove the trigger.');
      }
      given[key] = value || undefined;
    }
    const trigger = requested ?? current.trigger;
    if (nonInterrupting !== undefined && requested === undefined && !Object.keys(given).length) {
      change.setNonInterrupting(nonInterrupting);
      cs.change(ChangeSet.entryOf(el, `nonInterrupting=${nonInterrupting}`));
      return;
    }
    if (!allowed.includes(trigger)) {
      throw modelError('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def?.kind ?? kindLabel(el)} ${idOf(el)}`, {
        element: idOf(el),
        hint: `Allowed triggers: ${allowed.join(', ') || 'none'}.`,
      });
    }
    change.change(trigger, { ...given, ...(nonInterrupting !== undefined ? { nonInterrupting } : {}) } as TriggerOptions, cs, { strict: true });
    const details = Object.entries(given)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${String(v)}`);
    cs.change(ChangeSet.entryOf(el, [`trigger=${trigger}`, ...details, ...(nonInterrupting !== undefined ? [`nonInterrupting=${nonInterrupting}`] : [])].join(' ')));
  }
}
