/** The layouter reads flowElements order: a node right after its source, its flows after it. */
import { insertInto, is, many, removeFrom, type El } from '../../document/utils/moddle.js';

export function insertAfterInScope(scope: El, anchor: El | undefined, ...els: El[]): void {
  const list = many(scope, 'flowElements');
  for (const el of els) {
    removeFrom(scope, 'flowElements', el);
  }
  const idx = anchor ? list.indexOf(anchor) : -1;
  insertInto(scope, 'flowElements', idx === -1 ? list.length : idx + 1, ...els);
}

export function insertBeforeInScope(scope: El, anchor: El | undefined, ...els: El[]): void {
  const list = many(scope, 'flowElements');
  for (const el of els) {
    removeFrom(scope, 'flowElements', el);
  }
  const idx = anchor ? list.indexOf(anchor) : -1;
  insertInto(scope, 'flowElements', idx === -1 ? list.length : idx, ...els);
}

export function lastFlowOf(scope: El, source: El): El | undefined {
  const list = many(scope, 'flowElements');
  let last: El | undefined;
  for (const el of list) {
    if (is(el, 'bpmn:SequenceFlow') && el.get<El | undefined>('sourceRef') === source) {
      last = el;
    }
  }
  return last;
}
