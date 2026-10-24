import type { Doc } from '../model/Doc.js';
import { usageError } from '../shared/utils/errors.js';
import { aroundView, elementContext, type AroundView, type ElementContext } from './context.js';
import { layoutView, type LayoutView } from './layout-view.js';
import { buildView, elementDetail, scopeView, type ElementDetail, type ModelView } from './model-view.js';

/** What viewXml / showXml show: the model (default, optionally one scope), one element (in its context), the neighbourhood of one, or the drawing. */
export interface ViewOptions {
  /** one element in detail (`bpmn show <file> <id>`) */
  id?: string;
  /** with `id`: the element in its context instead of its details (`--context`) */
  context?: boolean;
  /** only the neighbourhood of this element (`--around <id>`) */
  around?: string;
  /** with `around`: flow steps from the element (`--depth`, default 2) */
  depth?: number;
  /** with `around`: also enter sub-processes from outside (`--inner`) */
  inner?: boolean;
  /** only this process / participant / sub-process (`--scope`) */
  scope?: string;
  /** the drawing instead of the model: rows, colours, label sides, layout problems (`--layout`) */
  layout?: boolean;
}

/** What `show` shows, by kind (viewDoc). */
export type ShownView =
  | { kind: 'model'; view: ModelView }
  | { kind: 'detail'; view: ElementDetail }
  | { kind: 'context'; view: ElementContext }
  | { kind: 'around'; view: AroundView }
  | { kind: 'layout'; view: LayoutView };

export class ViewRequest {
  /** E_USAGE for show options that do not go together (the CLI's flags and the API's options alike). */
  constructor(private readonly opts: ViewOptions = {}) {
    const used = (keys: Array<keyof ViewOptions>) => keys.filter((k) => opts[k] !== undefined && opts[k] !== false);
    const flag = (k: string) => (k === 'id' ? 'the element id' : `--${k}`);
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
    if (opts.layout) return { kind: 'layout', view: layoutView(doc.definitions) };
    if (opts.around !== undefined) return { kind: 'around', view: aroundView(doc, opts.around, { ...(opts.depth !== undefined ? { depth: opts.depth } : {}), inner: !!opts.inner }) };
    if (opts.id !== undefined && opts.context) return { kind: 'context', view: elementContext(doc, opts.id) };
    if (opts.id !== undefined) return { kind: 'detail', view: elementDetail(doc, doc.require(opts.id)) };
    const view = buildView(doc);
    return { kind: 'model', view: opts.scope ? scopeView(doc, view, opts.scope) : view };
  }
}
