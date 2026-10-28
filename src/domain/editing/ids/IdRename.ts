import type { EditSession } from '../../document/EditSession.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import { followDiIds } from '../../diagram/utils/di-ids.js';
import { cutAt, MAX_ID } from '../../document/utils/slug.js';
import { IdRegistry } from '../../document/ids/IdRegistry.js';
import { kindRequest, type IdRequest } from '../../document/utils/requests.js';
import type { IdState } from '../../document/ids/IdStyle.js';
import { kindLabel, kindOf, triggerOf } from '../../document/Kinds.js';
import { is, walk, type El } from '../../document/utils/moddle.js';
import { CAMUNDA } from '../../document/vendor/CamundaDescriptor.js';
import { FlowIdFollower } from '../connections/FlowIdFollower.js';
import { descriptorOf, idOf } from '../../document/utils/elements.js';

/**
 * Renames ids (`set id=`) and handles ids a retype or trigger change leaves with a stale
 * prefix: a batch-generated id follows the new type, any other keeps its id with a warning.
 */
export class IdRename {
  constructor(private readonly edit: EditSession) {}

  static stateOf(el: El): IdState {
    const trigger = triggerOf(el);
    return { type: el.$type, ...(trigger ? { trigger } : {}) };
  }

  /**
   * Also re-points string references like calledElement; DI ids derived from the old id
   * (`BPMNShape_<old>`, `<old>_di`) follow.
   * Id-valued attributes of vendor extension elements, plain strings in the model, are re-pointed too.
   */
  rename(el: El, newId: string): void {
    const doc = this.edit.doc;
    const old = idOf(el);
    if (old === newId) return;
    this.edit.allocator.claim(newId);
    el.set('id', newId);
    if (old) {
      doc.ids.release(old);
      followDiIds(doc.definitions, el, old, newId, doc.ids);
    }
    const vendorRefs = CAMUNDA.idReferenceAttrs().filter((reference) => is(el, reference.target));
    for (const element of walk(doc.definitions)) {
      if (is(element, 'bpmn:CallActivity') && element.get<string | undefined>('calledElement') === old) element.set('calledElement', newId);
      if (!descriptorOf(element).isGeneric) continue;
      const any = element as unknown as Record<string, unknown>;
      if (element.$type === 'zeebe:calledElement' && any['processId'] === old) any['processId'] = newId;
      if (!vendorRefs.length) continue;
      const [prefix, local] = element.$type.split(':');
      if (!prefix || !local || !CAMUNDA.reads(doc.namespaceUri(prefix))) continue;
      for (const ref of vendorRefs) {
        if (ref.element !== `camunda:${local}`) continue;
        if (any[ref.attr] === old) any[ref.attr] = newId;
        if (element.$attrs?.[ref.attr] === old) element.$attrs[ref.attr] = newId;
      }
    }
    doc.invalidate();
  }

  /**
   * An id the batch generated is nobody's API yet, so where a retype leaves it a stale
   * prefix it takes the id of what the element is now (serviceTask_check -> userTask_check),
   * and so do the flows named after it. Any other id is recorded for W_ID_PREFIX_STALE.
   * The stale prefix is judged from the id it wanted: a collision suffix under the old prefix is
   * not the new one's.
   */
  recordState(el: El, before: IdState, wasLabel: string): void {
    const style = this.edit.idStyle;
    if (!style.declared) return;
    const id = idOf(el);
    const allocator = this.edit.allocator;
    const base = allocator.generatedBase(id);
    if (base === undefined) {
      this.edit.recordIdState(id, before, wasLabel);
      return;
    }
    const stale = style.stalePrefix(base, before, IdRename.stateOf(el), IdRename.requestOf(el));
    if (!stale) return;
    const wanted = cutAt(stale.suggested, MAX_ID);
    const next = allocator.regenerated(id, wanted, style.suffixSep(kindOf(el)?.kind ?? el.$type));
    const flows = new FlowIdFollower(this.edit).namedAfter(el).map((flow) => ({ flow, was: `${idOf(flow.get<El>('sourceRef'))} -> ${idOf(flow.get<El>('targetRef'))}` }));
    this.rename(el, next);
    allocator.markGenerated(next, wanted);
    this.edit.recordRegenerated(id, next, undefined, el);
    for (const { flow, was } of flows) new FlowIdFollower(this.edit).followRenamedEnd(flow, was);
  }

  /**
   * Checked against the final state, so an element a later op renamed, removed or made
   * fit again gets no warning. Ids are API: the warning suggests a rename, never does one.
   */
  reportStalePrefixes(changes: ChangeSet): void {
    const doc = this.edit.doc;
    const states = this.edit.takeIdStates();
    if (!states.size) return;
    const style = this.edit.idStyle;
    const hinted = new IdRegistry(doc.ids.values());
    for (const [id, { before, wasLabel }] of states) {
      const el = doc.get(id);
      const stale = el && style.stalePrefix(id, before, IdRename.stateOf(el), IdRename.requestOf(el));
      if (!el || !stale) continue;
      const sep = style.suffixSep(kindOf(el)?.kind ?? el.$type);
      const suggested = this.edit.allocator.suffixed(stale.suggested, sep, (taken) => hinted.has(taken), () => stale.suggested);
      hinted.claim(suggested);
      const rule = `element-id-naming (${this.edit.conventions?.source ?? 'the host'})`;
      const expects = `${stale.heads.join(' or ')} for ${IdRename.aKind(kindLabel(el))}`;
      changes.warn({
        code: 'W_ID_PREFIX_STALE',
        message: stale.was !== undefined ? `${id} keeps its id, whose prefix ${stale.was} is that of ${IdRename.aKind(wasLabel)}; ${rule} expects ${expects}` : `${id} keeps its id, which ${rule} did not check on ${IdRename.aKind(wasLabel)}; it expects ${expects}`,
        element: id,
        hint: `Code, tests and links that use the id keep working; to follow the convention: \`bpmn set <file> ${id} id=${suggested}\`.`,
      });
    }
  }

  /** `u` is left out: userTask, the one kind starting with it, is said like `you`. */
  private static aKind(kind: string): string {
    return `${/^[aeio]/i.test(kind) ? 'an' : 'a'} ${kind}`;
  }

  private static requestOf(el: El): IdRequest | undefined {
    const def = kindOf(el);
    if (!def) return undefined;
    const trigger = triggerOf(el);
    const name = el.get<string | undefined>('name');
    return kindRequest(def, { ...(trigger && trigger !== 'none' ? { trigger } : {}), ...(name ? { name } : {}) });
  }
}
