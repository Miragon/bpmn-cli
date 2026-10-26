import { PropertyCoercer } from './PropertyCoercer.js';
import type { Doc } from '../document/Doc.js';
import { diExpansionState } from '../diagram/utils/expansion.js';
import { is, nameOf, type El } from '../document/utils/moddle.js';
import { descriptorOf, idOf, isEl, ownValue, typeLabel, vendorAttributes } from '../document/utils/elements.js';
import { nestedEntries } from '../document/utils/nested-slots.js';
import { EventTrigger } from './events/EventTrigger.js';

/** The settable view of an element's properties (`show <id>`), keyed as `set` takes them. */
export class ElementProperties {
  private readonly coercer: PropertyCoercer;

  constructor(private readonly doc: Doc) {
    this.coercer = new PropertyCoercer(doc);
  }

  read(el: El): Record<string, unknown> {
    const out: Record<string, unknown> = { id: idOf(el) };
    const name = nameOf(el);
    if (name) out['name'] = name;
    const docs = (ownValue(el, 'documentation') as El[] | undefined) ?? [];
    const text = docs
      .map((documentation) => documentation.get<string | undefined>('text'))
      .filter(Boolean)
      .join('\n');
    if (text) out['doc'] = text;
    for (const property of descriptorOf(el).properties ?? []) {
      if (property.name === 'id' || property.name === 'name' || property.name === 'default' || !this.coercer.isSettable(property)) continue;
      const propValue = ownValue(el, property.name);
      if (propValue === undefined || propValue === null || propValue === '') continue;
      out[property.name] = property.isReference && isEl(propValue) ? idOf(propValue) : propValue;
    }
    for (const [attrName, attrValue] of Object.entries(el.$attrs ?? {})) {
      if (attrName.startsWith('xmlns') || typeof attrValue === 'object') continue;
      out[attrName] = attrValue;
    }
    if (is(el, 'bpmn:SequenceFlow')) {
      const cond = el.get<El | undefined>('conditionExpression');
      const body = cond?.get<string | undefined>('body');
      if (body) out['condition'] = body;
      const language = cond?.get<string | undefined>('language');
      if (language) out['language'] = language;
      const src = el.get<El | undefined>('sourceRef');
      const tgt = el.get<El | undefined>('targetRef');
      if (src) out['source'] = idOf(src);
      if (tgt) out['target'] = idOf(tgt);
      if (src?.get<El | undefined>('default') === el) out['default'] = true;
    } else {
      const def = ownValue(el, 'default');
      if (isEl(def)) out['default'] = idOf(def);
    }
    if (is(el, 'bpmn:Event')) {
      const { trigger, opts } = new EventTrigger(el).read();
      out['trigger'] = trigger;
      const { timerKind: _ignored, ...rest } = opts;
      Object.assign(out, rest);
    }
    if (is(el, 'bpmn:Activity')) {
      const loop = el.get<El | undefined>('loopCharacteristics');
      if (is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
        out['loop'] = loop!.get<boolean | undefined>('isSequential') ? 'sequential' : 'parallel';
        const card = loop!.get<El | undefined>('loopCardinality')?.get<string | undefined>('body');
        const done = loop!.get<El | undefined>('completionCondition')?.get<string | undefined>('body');
        if (card) out['cardinality'] = card;
        if (done) out['completion'] = done;
      } else if (is(loop, 'bpmn:StandardLoopCharacteristics')) {
        out['loop'] = 'standard';
      }
      const own = is(el, 'bpmn:AdHocSubProcess') && !is(loop, 'bpmn:MultiInstanceLoopCharacteristics') ? el.get<El | undefined>('completionCondition')?.get<string | undefined>('body') : undefined;
      if (own) out['completion'] = own;
    }
    if (is(el, 'bpmn:SubProcess')) {
      const requested = this.doc.layoutRequests.requested(idOf(el));
      out['expanded'] = requested ?? diExpansionState(this.doc.definitions).get(idOf(el)) ?? true;
    }
    if (is(el, 'bpmn:FlowNode')) {
      const lanes = this.doc.lanesOf(el);
      const lane = lanes[lanes.length - 1];
      if (lane) out['lane'] = idOf(lane);
    }
    if (is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask')) {
      const message = ownValue(el, 'messageRef');
      if (isEl(message)) out['message'] = message.get<string | undefined>('name') ?? idOf(message);
    }
    for (const { prefix, el: nestedEl } of nestedEntries(el)) {
      // several event definitions: each under its position (definition[1]: timerEventDefinition)
      if (prefix.includes('[')) out[prefix] = typeLabel(nestedEl);
      const nestedId = nestedEl.get<string | undefined>('id');
      if (nestedId) out[`${prefix}.id`] = nestedId;
      for (const [attrName, attrValue] of Object.entries(vendorAttributes(nestedEl))) out[`${prefix}.${attrName}`] = attrValue;
    }
    return out;
  }
}
