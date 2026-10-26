import type { Doc } from '../document/Doc.js';
import { modelError } from '../document/utils/errors.js';
import { kindLabel, triggerOf } from '../document/utils/kinds.js';
import { is, type El } from '../document/utils/moddle.js';
import { descriptorOf, idOf, type PropDescriptor } from '../document/utils/elements.js';
import { CAMUNDA } from '../document/vendor/CamundaDescriptor.js';

export interface SetKeyDoc {
  key: string;
  appliesTo: string;
  description: string;
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

export const SET_KEYS: SetKeyDoc[] = [
  { key: 'id', appliesTo: 'any', description: 'Rename the element; every reference (flows, lanes, boundary hosts, calledElement) follows, and so does a DI id derived from the old id (BPMNShape_<id>, <id>_di)' },
  { key: 'name', appliesTo: 'any', description: 'Display name (empty value removes it; a group\'s name is the value of its category value)' },
  { key: 'doc', appliesTo: 'any', description: 'Documentation text (alias: documentation; empty removes it)' },
  { key: '<prefix>:<attr>', appliesTo: 'any', description: 'Vendor attribute, e.g. camunda:assignee=alice or zeebe:modelerTemplate=x (xmlns declared automatically for known prefixes)' },
  { key: '<property>', appliesTo: 'any', description: 'Any attribute of the BPMN type by property name, e.g. isExecutable, calledElement, scriptFormat, script, implementation, isForCompensation, completionQuantity, gatewayDirection, instantiate' },
  { key: 'condition', appliesTo: 'sequenceFlow', description: 'Condition expression (empty removes it; clears the default marker of the flow)' },
  { key: 'language', appliesTo: 'sequenceFlow', description: 'Expression language of the condition' },
  { key: 'default', appliesTo: 'sequenceFlow', description: 'true|false: make this flow the default flow of its source gateway/activity (removes its condition; a previous default flow loses the marker)' },
  { key: 'default', appliesTo: 'flowNode', description: 'Id of the default outgoing flow of a gateway/activity (empty clears it)' },
  { key: 'source', appliesTo: 'sequenceFlow', description: 'Redirect the flow: new source node id' },
  { key: 'target', appliesTo: 'sequenceFlow', description: 'Redirect the flow: new target node id' },
  { key: 'trigger', appliesTo: 'event', description: 'Event trigger: none|message|timer|error|signal|escalation|conditional|link|compensate|terminate|cancel' },
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
  { key: 'loop', appliesTo: 'activity', description: 'none|standard|parallel|sequential (parallel/sequential = multi-instance)' },
  { key: 'cardinality', appliesTo: 'activity', description: 'Multi-instance loop cardinality expression (creates a parallel multi-instance loop when none exists)' },
  { key: 'completion', appliesTo: 'activity', description: 'Multi-instance completion condition expression (an ad-hoc sub-process without a multi-instance loop: its own completion condition)' },
  { key: 'expanded', appliesTo: 'subProcess', description: 'true|false: draw the sub-process expanded (default) or collapsed' },
  { key: 'triggeredByEvent', appliesTo: 'subProcess', description: 'true|false: event sub-process' },
  { key: 'message', appliesTo: 'sendTask, receiveTask', description: 'Message name of a send / receive task (a root bpmn:Message is created when missing; empty removes the reference)' },
  { key: 'calledDecision', appliesTo: 'businessRuleTask', description: 'The decision the task calls, in the spelling of the file\'s platform: camunda:decisionRef in Camunda 7, a zeebe:calledDecision decisionId in Camunda 8, bpmn-cli\'s own unprefixed calledDecision="<id>" without an engine. With the library\'s platform \'none\' a link in an engine spelling keeps it (a zeebe:calledDecision its resultVariable too) and a new link takes the engine spelling all the file\'s other links share (the other spellings are removed; empty removes the link)' },
  { key: 'definition.<key>', appliesTo: 'event', description: "Attribute of the event definition, e.g. definition.camunda:errorCodeVariable=code, definition.camunda:type=external + definition.camunda:topic=x (message throw / end), definition.camunda:variableName=amount (conditional); an event with several event definitions takes 'definition[<n>].<key>' (0-based) or 'definition[<trigger>].<key>'" },
  { key: 'loop.<key>', appliesTo: 'activity', description: 'Attribute of the loop characteristics, e.g. loop.camunda:collection=${items}, loop.camunda:elementVariable=item, loop.camunda:asyncBefore=true (creates a parallel multi-instance loop when none exists)' },
  { key: 'condition.<key>', appliesTo: 'sequenceFlow', description: 'Attribute of the condition expression, e.g. condition.camunda:resource=deployment://check.groovy (a script resource condition; set language= too)' },
  { key: 'condition.<key>', appliesTo: 'conditionalEvent', description: 'Attribute of the condition expression of a conditional event, e.g. condition.camunda:resource=deployment://ready.groovy condition.language=groovy; the event definition itself is definition.<key> (definition.camunda:variableName=amount)' },
  { key: 'lane', appliesTo: 'flowNode', description: 'Lane id the node belongs to (empty removes lane membership)' },
  { key: 'text', appliesTo: 'textAnnotation', description: 'Annotation text' },
];

/** Properties with a dedicated command or key: never set generically. */
const BLOCKED_PROPS: Record<string, string> = {
  attachedToRef: 'use `bpmn move <file> <id> --on <activityId>`',
  sourceRef: 'use source=<nodeId>',
  targetRef: 'use target=<nodeId>',
  processRef: 'a participant is bound to its process on creation',
  bpmnElement: 'diagram interchange is generated automatically',
};

const PRIMITIVE_TYPES = new Set(['String', 'Boolean', 'Integer', 'Real']);

/**
 * The keys `set` takes and the values it writes: documented keys, settable attributes of a
 * BPMN type, vendor attributes, and string values converted to the property's type.
 */
export class PropertyCoercer {
  constructor(private readonly doc: Doc) {}

  private enumLiterals(type: string): string[] | undefined {
    const [prefix, local] = type.split(':');
    if (!prefix || !local) return undefined;
    let pkg: { enumerations?: Array<{ name: string; literalValues?: Array<{ name: string }> }> } | undefined;
    try {
      pkg = this.doc.moddle.getPackage(prefix) as typeof pkg;
    } catch {
      return undefined;
    }
    const found = pkg?.enumerations?.find((enumeration) => enumeration.name === local);
    return found?.literalValues?.map((literal) => literal.name);
  }

  blockedReason(key: string): string | undefined {
    return BLOCKED_PROPS[key];
  }

  isSettable(property: PropDescriptor): boolean {
    if (property.isMany || BLOCKED_PROPS[property.name]) return false;
    if (property.isReference) return !!property.isAttr;
    return PRIMITIVE_TYPES.has(property.type) || !!this.enumLiterals(property.type);
  }

  genericKeys(el: El): string[] {
    return (descriptorOf(el).properties ?? []).filter((property) => property.name !== 'id' && this.isSettable(property)).map((property) => property.name);
  }

  settableKeys(el: El): string[] {
    const keys = new Set<string>();
    for (const setKey of SET_KEYS) {
      if (setKey.key.startsWith('<')) continue;
      if (APPLIES_TO[setKey.appliesTo]?.(el)) keys.add(setKey.key);
    }
    for (const genericKey of this.genericKeys(el)) keys.add(genericKey);
    keys.add('<prefix>:<attr>');
    return [...keys];
  }

  static invalid(el: El, key: string, message: string, hint?: string) {
    return modelError('E_INVALID_VALUE', `Invalid value for ${key} on ${idOf(el)}: ${message}`, { element: idOf(el), ...(hint ? { hint } : {}) });
  }

  static bool(el: El, key: string, value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(normalized)) return true;
    if (['false', 'no', '0', 'off'].includes(normalized)) return false;
    throw PropertyCoercer.invalid(el, key, `"${value}" is not a boolean`, `Use ${key}=true or ${key}=false.`);
  }

  /** Errors name `label`, the key as given. */
  coerce(el: El, property: PropDescriptor, value: string, label: string = property.name): unknown {
    if (property.isReference) return this.doc.require(value, property.type, property.name);
    switch (property.type) {
      case 'String':
        return value;
      case 'Boolean':
        return PropertyCoercer.bool(el, label, value);
      case 'Integer': {
        if (!/^-?\d+$/.test(value.trim())) throw PropertyCoercer.invalid(el, label, `"${value}" is not an integer`);
        return Number(value);
      }
      case 'Real': {
        const numeric = Number(value);
        if (!value.trim() || Number.isNaN(numeric)) throw PropertyCoercer.invalid(el, label, `"${value}" is not a number`);
        return numeric;
      }
      default: {
        const literals = this.enumLiterals(property.type) ?? [];
        const hit = literals.find((literal) => literal.toLowerCase() === value.trim().toLowerCase());
        if (!hit) throw PropertyCoercer.invalid(el, label, `"${value}" is not one of ${literals.join('|')}`);
        return hit;
      }
    }
  }

  unknownKey(el: El, key: string, reason?: string) {
    const keys = this.settableKeys(el);
    return modelError('E_UNKNOWN_KEY', `Unknown key "${key}" for ${kindLabel(el)} ${idOf(el)}${reason ? ` (${reason})` : ''}`, {
      element: idOf(el),
      candidates: keys,
      hint: `Settable keys for this element: ${keys.join(', ')}.`,
    });
  }

  /**
   * Boolean camunda attributes are written as exactly true / false: the engines read only the
   * exact value "true" (asyncBefore=yes would silently stay off).
   */
  vendorValue(el: El, key: string, value: string, label: string = key): string {
    if (!value) return value;
    const local = this.camundaLocal(key);
    if (!local || CAMUNDA.attr(local)?.type !== 'Boolean') return value;
    return String(PropertyCoercer.bool(el, label, value));
  }

  setVendorAttribute(el: El, key: string, value: string): void {
    const idx = key.indexOf(':');
    const prefix = key.slice(0, idx);
    const local = key.slice(idx + 1);
    if (!prefix || !local || prefix === 'xmlns') throw this.unknownKey(el, key, 'vendor attributes look like prefix:name');
    if (!value) {
      delete el.$attrs[key];
      return;
    }
    this.doc.declareNamespace(prefix);
    el.$attrs[key] = value;
  }

  /**
   * Only removes an unprefixed attribute BPMN does not define (`assignee` on a user task):
   * the engines validate against the schema and refuse the file.
   */
  static removeUndefined(el: El, key: string, value: string): boolean {
    if (value || key.includes(':') || descriptorOf(el).propertiesByName?.[key]) return false;
    if (!el.$attrs || !Object.prototype.hasOwnProperty.call(el.$attrs, key)) return false;
    delete el.$attrs[key];
    return true;
  }

  /** Any prefix bound to the camunda or Operaton namespace counts. */
  isResourceKey(key: string): boolean {
    const [prefix, local] = key.split(':');
    return local === 'resource' && !!prefix && CAMUNDA.reads(this.doc.namespaceUri(prefix));
  }

  resourceKeyOf(expr: El | undefined): string | undefined {
    if (!expr) return undefined;
    return Object.keys(expr.$attrs ?? {}).find((attrKey) => this.isResourceKey(attrKey) && expr.$attrs[attrKey] !== undefined && expr.$attrs[attrKey] !== '');
  }

  /** Operaton's namespace holds the same attributes: the descriptor's rules apply by local name. */
  camundaLocal(key: string): string | undefined {
    const idx = key.indexOf(':');
    if (idx <= 0) return undefined;
    return CAMUNDA.reads(this.doc.namespaceUri(key.slice(0, idx))) ? key.slice(idx + 1) : undefined;
  }
}
