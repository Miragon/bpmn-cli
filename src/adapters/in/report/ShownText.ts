import type { ShownView } from '../../../domain/views/ViewRequest.js';
import { AroundText } from './AroundText.js';
import { ContextText } from './ContextText.js';
import { DetailText } from './DetailText.js';
import { LayoutText } from './LayoutText.js';
import { ModelViewText } from './ModelViewText.js';

type ViewOfKind<Kind extends ShownView['kind']> = Extract<ShownView, { kind: Kind }>['view'];

const RENDERERS: { [Kind in ShownView['kind']]: (view: ViewOfKind<Kind>) => string } = {
  model: (view) => new ModelViewText(view).text(),
  detail: (view) => new DetailText(view).text(),
  context: (view) => new ContextText(view).text(),
  around: (view) => new AroundText(view).text(),
  layout: (view) => new LayoutText(view).text(),
};

/** `bpmn show`: whichever view was asked for, as text. */
export class ShownText {
  constructor(private readonly shown: ShownView) {}

  text(): string {
    const render = RENDERERS[this.shown.kind] as (view: ShownView['view']) => string;
    return render(this.shown.view).replace(/\n$/, '');
  }
}
