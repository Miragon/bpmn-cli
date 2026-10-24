import type { Doc } from '../model/Doc.js';
import { usageError } from '../shared/utils/errors.js';
import { SUB_PROCESS_TYPES } from '../diagram/utils/expansion.js';
import { kindLabel } from '../model/utils/kinds.js';
import { EditTransaction } from './EditTransaction.js';
import type { LayoutDocOptions, MutationResult } from './index.js';

/**
 * `bpmn layout` on an in-memory document: redraws the diagram (expanding /
 * collapsing the given sub-processes, reported as changes), or with `tidy`
 * keeps it and only removes overlaps. Unknown ids and ids that are no
 * sub-process are errors (like `set <id> expanded=`), not silent no-ops.
 */
export class Relayout {
  constructor(private readonly opts: LayoutDocOptions = {}) {}

  /** E_USAGE for layout options that contradict each other (checked before anything is read). */
  assertOptions(): void {
    if (this.opts.tidy && (this.opts.expand !== undefined || this.opts.collapse !== undefined)) {
      throw usageError('--tidy keeps the drawing; --expand / --collapse need a redraw', { hint: 'Run `bpmn layout <file> --expand ...` and `bpmn layout <file> --tidy` separately.' });
    }
  }

  async run(doc: Doc): Promise<MutationResult> {
    const opts = this.opts;
    this.assertOptions();
    if (opts.tidy) return new EditTransaction(doc, [{ op: 'tidy' }], { ...opts, layout: 'auto' }).run();
    const expand = opts.expand ?? [];
    const collapse = opts.collapse ?? [];
    const subs = new Map([...expand, ...collapse].map((id) => [id, doc.require(id, SUB_PROCESS_TYPES, 'sub-process')]));
    const both = expand.filter((id) => collapse.includes(id));
    if (both.length) throw usageError(`${both.join(', ')} given to both --expand and --collapse`);
    const result = await new EditTransaction(doc, [], { ...opts, layout: 'full', expand, collapse }).run();
    for (const [id, expanded] of [...expand.map((id) => [id, true] as const), ...collapse.map((id) => [id, false] as const)]) {
      const sub = subs.get(id)!;
      const name = sub.get<string | undefined>('name');
      result.changes.change({ id, kind: kindLabel(sub), ...(name ? { name } : {}), detail: `expanded=${expanded}` });
    }
    return result;
  }
}
