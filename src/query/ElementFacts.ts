import { TRIGGER_TYPES } from '../model/utils/kinds.js';
import { is, list, peek, shownId, type El } from '../model/utils/moddle.js';
import { decisionLinkOf } from '../ops/decision.js';
import { describeTrigger } from '../ops/events.js';
import { listAllExtensions, type ExtensionInfo } from '../ops/ext.js';
import { definitionsOf, nestedEntries, vendorAttributes } from '../ops/set.js';
import { ZEEBE_URI } from '../platform/descriptor.js';
import type { Implementation } from './context.js';
import type { ViewFlow } from './model-view.js';
import { bodyOf, compact, nameOf, nonEmpty, refLabel, resourceOf, truncate } from './utils/view.js';

const MAX_CHILDREN = 6;

export class ElementFacts {
  constructor(private readonly el: El) {}

  /** Trigger details from the first event definition (fallback while events.ts is a stub). */
  trigger(): string | undefined {
    const described = describeTrigger(this.el);
    if (described) return described;
    const def = list(this.el, 'eventDefinitions')[0];
    if (!def) return undefined;
    if (is(def, 'bpmn:TimerEventDefinition')) {
      for (const key of ['timeCycle', 'timeDuration', 'timeDate']) {
        const value = bodyOf(peek<El>(def, key));
        if (value) return value;
      }
      return undefined;
    }
    if (is(def, 'bpmn:MessageEventDefinition')) return `message ${refLabel(peek<El>(def, 'messageRef'))}`;
    if (is(def, 'bpmn:SignalEventDefinition')) return `signal ${refLabel(peek<El>(def, 'signalRef'))}`;
    if (is(def, 'bpmn:ErrorEventDefinition')) {
      const ref = peek<El>(def, 'errorRef');
      const code = ref ? peek<string>(ref, 'errorCode') : undefined;
      return `error ${refLabel(ref)}${code ? ` (${code})` : ''}`;
    }
    if (is(def, 'bpmn:EscalationEventDefinition')) {
      const ref = peek<El>(def, 'escalationRef');
      const code = ref ? peek<string>(ref, 'escalationCode') : undefined;
      return `escalation ${refLabel(ref)}${code ? ` (${code})` : ''}`;
    }
    if (is(def, 'bpmn:ConditionalEventDefinition')) return `if ${bodyOf(peek<El>(def, 'condition')) ?? '?'}`;
    if (is(def, 'bpmn:LinkEventDefinition')) return `link ${peek<string>(def, 'name') ?? '?'}`;
    return undefined;
  }

  nonInterrupting(): boolean | undefined {
    if (is(this.el, 'bpmn:BoundaryEvent')) return peek<boolean>(this.el, 'cancelActivity') === false ? true : undefined;
    if (is(this.el, 'bpmn:StartEvent')) return peek<boolean>(this.el, 'isInterrupting') === false ? true : undefined;
    return undefined;
  }

  documentation(): string | undefined {
    const texts = list(this.el, 'documentation')
      .map((d) => peek<string>(d, 'text'))
      .filter((t): t is string => typeof t === 'string' && !!t.trim());
    return texts.length ? texts.join(' ') : undefined;
  }

  /** Extra semantic facts of a node worth showing in one line (`zeebe: false`: without the Camunda 8 settings, which the reading views print in full). */
  props(opts: { zeebe?: boolean } = {}): Record<string, unknown> | undefined {
    const el = this.el;
    const props: Record<string, unknown> = {};
    const loop = peek<El>(el, 'loopCharacteristics');
    if (loop) {
      if (is(loop, 'bpmn:StandardLoopCharacteristics')) props['loop'] = 'standard';
      else props['loop'] = peek<boolean>(loop, 'isSequential') ? 'sequential' : 'parallel';
      const cardinality = bodyOf(peek<El>(loop, 'loopCardinality'));
      if (cardinality) props['cardinality'] = cardinality;
    }
    const called = peek<string>(el, 'calledElement');
    if (called) props['calledElement'] = called;
    // the decision link of a business rule task, whatever the spelling (no engine: calledDecision, C7: camunda:decisionRef, C8: zeebe:calledDecision)
    const decision = decisionLinkOf(el);
    if (decision) props['calledDecision'] = decision.value;
    if (peek<boolean>(el, 'isForCompensation') === true) props['isForCompensation'] = true;
    const messageRef = peek<El>(el, 'messageRef');
    if (messageRef && (is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask'))) props['message'] = refLabel(messageRef);
    const scriptFormat = peek<string>(el, 'scriptFormat');
    if (scriptFormat) props['scriptFormat'] = scriptFormat;
    // several event definitions on one event (the label shows the first one's trigger): name them all
    const defs = definitionsOf(el);
    if (defs.length > 1) props['definitions'] = defs.map((d) => (Object.entries(TRIGGER_TYPES) as Array<[string, string]>).find(([, t]) => is(d, t))?.[0] ?? d.$type).join('+');
    // the reading views (show --around, show <id> --context) print the zeebe elements in full (implementation())
    if (opts.zeebe !== false) this.zeebeProps(props);
    return Object.keys(props).length ? props : undefined;
  }

  /** Vendor attribute values of the element and, under `<slot>.<key>` (`definition[1].<key>`), of its nested elements. */
  vendorValues(skip: (slot: string, key: string) => boolean = () => false): Record<string, string> | undefined {
    const out: Record<string, string> = { ...vendorAttributes(this.el) };
    for (const { prefix, el: nested } of nestedEntries(this.el)) {
      for (const [k, v] of Object.entries(vendorAttributes(nested))) if (!skip(prefix, k)) out[`${prefix}.${k}`] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }

  extensionTypes(): string[] {
    const container = peek<El>(this.el, 'extensionElements');
    return container ? list(container, 'values').map((v) => v.$type) : [];
  }

  /** Vendor attribute names and extension element types, e.g. ["camunda:assignee", "zeebe:taskDefinition"]. */
  extensionMentions(): string[] | undefined {
    const mentions = [...this.extensionTypes(), ...Object.keys(vendorAttributes(this.el))];
    return mentions.length ? [...new Set(mentions)] : undefined;
  }

  flow(): ViewFlow {
    const flow = this.el;
    const source = peek<El>(flow, 'sourceRef');
    const cond = peek<El>(flow, 'conditionExpression');
    const resource = resourceOf(cond);
    return compact({
      id: shownId(flow),
      target: shownId(peek<El>(flow, 'targetRef')),
      name: nameOf(flow),
      condition: bodyOf(cond),
      conditionResource: resource?.value,
      language: cond ? peek<string>(cond, 'language') || undefined : undefined,
      default: source && peek<El>(source, 'default') === flow ? true : undefined,
      attrs: this.vendorValues((slot, key) => slot === 'condition' && key === resource?.key),
      extensions: this.extensionMentions(),
      extensionElements: nonEmpty(this.extensionTypes()),
    });
  }

  /** The correlation key Camunda 8 matches a bpmn:Message by (its zeebe:subscription), if any. */
  correlationKey(): string | undefined {
    const subscription = ElementFacts.zeebeExt(this.el, 'subscription');
    return subscription ? peek<string>(subscription, 'correlationKey') : undefined;
  }

  /** Vendor values and a compact summary of the extension elements of the element (and of its nested elements). */
  implementation(): Implementation | undefined {
    const attrs = this.vendorValues();
    const all = listAllExtensions(this.el);
    const groups = new Map<string, ExtensionInfo[]>();
    for (const e of all) {
      const key = `${e.slot ? `${e.slot}.` : ''}${e.type}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const ext = [...groups].map(([key, items]) => (items.length > 1 ? `${key} x${items.length}` : this.extensionItem(items[0]!)));
    return attrs || ext.length ? compact<Implementation>({ attrs, ext: nonEmpty(ext) }) : undefined;
  }

  /**
   * The Camunda 8 settings of a node that say what it does (they are zeebe
   * extension elements, so `attrs` cannot show them): the job type, the called
   * process, the FEEL script, the form, the assignment, the multi-instance
   * collection.
   */
  private zeebeProps(props: Record<string, unknown>): void {
    const el = this.el;
    const job = ElementFacts.zeebeExt(el, 'taskDefinition');
    if (job && peek<string>(job, 'type') !== undefined) props['job'] = peek<string>(job, 'type');
    const called = ElementFacts.zeebeExt(el, 'calledElement');
    if (called && props['calledElement'] === undefined && peek<string>(called, 'processId') !== undefined) props['calledElement'] = peek<string>(called, 'processId');
    const script = ElementFacts.zeebeExt(el, 'script');
    if (script) props['script'] = `${peek<string>(script, 'expression') ?? ''}${peek<string>(script, 'resultVariable') ? ` -> ${peek<string>(script, 'resultVariable')}` : ''}`;
    const form = ElementFacts.zeebeExt(el, 'formDefinition');
    const formRef = form ? (peek<string>(form, 'formId') ?? peek<string>(form, 'externalReference') ?? peek<string>(form, 'formKey')) : undefined;
    if (formRef !== undefined) props['form'] = formRef;
    const assignment = ElementFacts.zeebeExt(el, 'assignmentDefinition');
    for (const k of ['assignee', 'candidateGroups', 'candidateUsers']) {
      const v = assignment ? peek<string>(assignment, k) : undefined;
      if (v !== undefined) props[k] = v;
    }
    const loop = ElementFacts.zeebeExt(peek<El>(el, 'loopCharacteristics'), 'loopCharacteristics');
    for (const k of ['inputCollection', 'inputElement', 'outputCollection', 'outputElement']) {
      const v = loop ? peek<string>(loop, k) : undefined;
      if (v !== undefined) props[k] = v;
    }
  }

  /** The first generic zeebe extension element `local` of `el` (any prefix bound to the zeebe namespace). */
  private static zeebeExt(el: El | undefined, local: string): El | undefined {
    const container = el ? peek<El>(el, 'extensionElements') : undefined;
    return container ? list(container, 'values').find((v) => (v.$descriptor as { ns?: { uri?: string } }).ns?.uri === ZEEBE_URI && v.$type.endsWith(`:${local}`)) : undefined;
  }

  private extensionItem(e: ExtensionInfo): string {
    const prefix = e.slot ? `${e.slot}.` : '';
    const io = ElementFacts.ioItem(e);
    if (io) return `${prefix}${io}`;
    const children = e.children ?? [];
    if (!children.length) {
      const attrs = Object.entries(e.attrs).map(([k, v]) => `${k}=${ElementFacts.itemValue(v)}`);
      const body = e.body?.trim() ? [`body=${ElementFacts.itemValue(e.body)}`] : [];
      return [`${prefix}${e.type}`, ...attrs, ...body].join(' ');
    }
    const keys = children.slice(0, MAX_CHILDREN).map(ElementFacts.childKey);
    return `${prefix}${e.type}: ${keys.join(', ')}${children.length > MAX_CHILDREN ? `, +${children.length - MAX_CHILDREN} more` : ''}`;
  }

  /** The names an io mapping gives its inputs and outputs (camunda: name, zeebe: target). */
  private static ioItem(e: ExtensionInfo | Omit<ExtensionInfo, 'index'>): string | undefined {
    const local = e.type.split(':')[1] ?? e.type;
    const isIo = local === 'inputOutput' || e.type === 'zeebe:ioMapping';
    if (!isIo) return undefined;
    const ins: string[] = [];
    const outs: string[] = [];
    for (const c of e.children ?? []) {
      const cl = c.type.split(':')[1] ?? c.type;
      const name = c.attrs['name'] ?? c.attrs['target'] ?? '?';
      if (cl === 'inputParameter' || cl === 'input') ins.push(name);
      else if (cl === 'outputParameter' || cl === 'output') outs.push(name);
    }
    const parts = [ins.length ? `in ${ins.join(', ')}` : '', outs.length ? `out ${outs.join(', ')}` : ''].filter(Boolean);
    return `io: ${parts.length ? parts.join('; ') : 'empty'}`;
  }

  /** The key a child of a container is known by (its name, id, target or event), else its local type. */
  private static childKey(c: Omit<ExtensionInfo, 'index'>): string {
    return c.attrs['name'] ?? c.attrs['id'] ?? c.attrs['key'] ?? c.attrs['target'] ?? c.attrs['event'] ?? (c.type.split(':')[1] ?? c.type);
  }

  /** A value inside a summary item: bare when short and plain, else quoted and truncated. */
  private static itemValue(value: string, max = 40): string {
    return /^[^\s,;[\]"]+$/.test(value) && value.length <= max ? value : `"${truncate(value, max).replace(/"/g, '\\"')}"`;
  }
}
