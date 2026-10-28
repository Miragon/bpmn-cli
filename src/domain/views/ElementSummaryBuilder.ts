import type { Doc } from '../document/Doc.js';
import { kindOrTypeLabel } from '../document/Kinds.js';
import { is, shownId, type El } from '../document/utils/moddle.js';
import { laneOf } from '../document/utils/lanes.js';
import { ElementFacts } from './ElementFacts.js';
import type { ElementSummary } from './model-view.js';
import { compact, nameOf } from './utils/view.js';

export interface SummaryOptions {
  kindLabel?: (el: El) => string;
  zeebe?: boolean;
}

export class ElementSummaryBuilder {
  constructor(private readonly doc: Doc) {}

  build(el: El, { kindLabel = kindOrTypeLabel, zeebe }: SummaryOptions = {}): ElementSummary {
    const facts = new ElementFacts(el);
    const ownsLane = is(el, 'bpmn:FlowNode') && !is(el, 'bpmn:BoundaryEvent');
    return compact<ElementSummary>({
      id: shownId(el),
      kind: kindLabel(el),
      name: nameOf(el),
      trigger: is(el, 'bpmn:Event') ? facts.trigger() : undefined,
      nonInterrupting: facts.nonInterrupting(),
      documentation: facts.documentation(),
      props: facts.props({ zeebe }),
      lane: ownsLane ? laneOf(this.doc, el)?.get<string>('id') : undefined,
      outgoing: this.doc.outgoing(el).map((flow) => new ElementFacts(flow).flow()),
    });
  }
}
