import type { ShownView } from '../../../domain/views/ViewRequest.js';
import { AroundText } from './AroundText.js';
import { ContextText } from './ContextText.js';
import { DetailText } from './DetailText.js';
import { LayoutText } from './LayoutText.js';
import { ModelViewText } from './ModelViewText.js';

/** `bpmn show`: whichever view was asked for, as text. */
export class ShownText {
  constructor(private readonly shown: ShownView) {}

  text(): string {
    const shown = this.shown;
    const text =
      shown.kind === 'layout' ? new LayoutText(shown.view).text() : shown.kind === 'detail' ? new DetailText(shown.view).text() : shown.kind === 'context' ? new ContextText(shown.view).text() : shown.kind === 'around' ? new AroundText(shown.view).text() : new ModelViewText(shown.view).text();
    return text.replace(/\n$/, '');
  }
}
