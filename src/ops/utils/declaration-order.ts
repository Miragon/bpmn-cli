/**
 * The declaration order of a scope's flowElements, which the layouter reads:
 * a node right after its source, its flows after it.
 */
import { insertInto, is, many, removeFrom, type El } from '../../model/utils/moddle.js';

/** Inserts elements into a scope's flowElements right after `anchor` (or at the end). */
export function insertAfterInScope(scope: El, anchor: El | undefined, ...els: El[]): void {
  const list = many(scope, 'flowElements');
  for (const el of els) removeFrom(scope, 'flowElements', el);
  const idx = anchor ? list.indexOf(anchor) : -1;
  insertInto(scope, 'flowElements', idx === -1 ? list.length : idx + 1, ...els);
}

/** Inserts elements right before `anchor` (or at the end). */
export function insertBeforeInScope(scope: El, anchor: El | undefined, ...els: El[]): void {
  const list = many(scope, 'flowElements');
  for (const el of els) removeFrom(scope, 'flowElements', el);
  const idx = anchor ? list.indexOf(anchor) : -1;
  insertInto(scope, 'flowElements', idx === -1 ? list.length : idx, ...els);
}

/** The last declared outgoing flow of `source` inside `scope` (keeps branch order tidy). */
export function lastFlowOf(scope: El, source: El): El | undefined {
  const list = many(scope, 'flowElements');
  let last: El | undefined;
  for (const el of list) {
    if (is(el, 'bpmn:SequenceFlow') && el.get<El | undefined>('sourceRef') === source) last = el;
  }
  return last;
}
