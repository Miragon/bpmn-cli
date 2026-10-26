import type { Doc } from '../model/Doc.js';
import { usageError } from '../shared/utils/errors.js';
import { type AroundView, type ElementContext } from './context.js';
import { type LayoutView } from './layout-view.js';
import { type ElementDetail, type ModelView } from './model-view.js';
import { AroundWindow } from './AroundWindow.js';
import { ElementContextBuilder } from './ElementContextBuilder.js';
import { ElementDetailBuilder } from './ElementDetailBuilder.js';
import { LayoutViewBuilder } from './LayoutViewBuilder.js';
import { ModelViewBuilder } from './ModelViewBuilder.js';

/** What viewXml / showXml show: the model, one element, a neighbourhood, or the drawing. */
export interface ViewOptions {
  /** `bpmn show <file> <id>` */
  id?: string;
  /** `--context`: with `id`, the element in its context */
  context?: boolean;
  /** `--around <id>` */
  around?: string;
  /** `--depth`, default 2 */
  depth?: number;
  /** `--inner` */
  inner?: boolean;
  /** `--scope` */
  scope?: string;
  /** `--layout`: the drawing instead of the model */
  layout?: boolean;
}

export type ShownView =
  | { kind: 'model'; view: ModelView }
  | { kind: 'detail'; view: ElementDetail }
  | { kind: 'context'; view: ElementContext }
  | { kind: 'around'; view: AroundView }
  | { kind: 'layout'; view: LayoutView };

export class ViewRequest {
  constructor(private readonly opts: ViewOptions = {}) {
    const used = (keys: Array<keyof ViewOptions>) => keys.filter((option) => opts[option] !== undefined && opts[option] !== false);
    const flag = (option: string) => (option === 'id' ? 'the element id' : `--${option}`);
    if (opts.layout) {
      const extra = used(['id', 'scope', 'around', 'context']);
      if (extra.length) throw usageError(`--layout shows the whole drawing; drop ${extra.map(flag).join(' and ')}`, { hint: 'Use `bpmn show <file> --layout` and look up the id in the rows.' });
    }
    if (opts.around !== undefined) {
      const extra = used(['id', 'scope', 'context']);
      if (extra.length) throw usageError(`--around <id> names the element itself; drop ${extra.map(flag).join(' and ')}`, { hint: 'Use `bpmn show <file> --around <id> [--depth n]`, or `bpmn show <file> <id> --context` for one element in its context.' });
    } else ViewRequest.assertAroundFlags(undefined, used(['depth', 'inner']).map(flag), 'show');
    if (opts.context && opts.id === undefined) throw usageError('--context needs an element id', { hint: 'Use `bpmn show <file> <id> --context`.' });
    if (opts.context && opts.scope !== undefined) throw usageError('--context shows one element; drop --scope', { hint: 'Use `bpmn show <file> <id> --context`.' });
  }

  static assertAroundFlags(around: string | undefined, flags: string[], command: 'show' | 'render'): void {
    if (around === undefined && flags.length) throw usageError(`${flags.join(' and ')} ${flags.length > 1 ? 'go' : 'goes'} only with --around <id>`, { hint: `Use \`bpmn ${command} <file> --around <id> --depth <n>\`.` });
  }

  of(doc: Doc): ShownView {
    const opts = this.opts;
    if (opts.layout) return { kind: 'layout', view: new LayoutViewBuilder(doc.definitions).build() };
    if (opts.around !== undefined) return { kind: 'around', view: new AroundWindow(doc, opts.around, { ...(opts.depth !== undefined ? { depth: opts.depth } : {}), inner: !!opts.inner }).view() };
    if (opts.id !== undefined && opts.context) return { kind: 'context', view: new ElementContextBuilder(doc, opts.id).build() };
    if (opts.id !== undefined) return { kind: 'detail', view: new ElementDetailBuilder(doc, doc.require(opts.id)).build() };
    const view = new ModelViewBuilder(doc).build();
    return { kind: 'model', view: opts.scope ? new ModelViewBuilder(doc).scope(view, opts.scope) : view };
  }
}
