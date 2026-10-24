/**
 * Renaming ids: `set id=` and the ids a retype or a trigger change leaves
 * a stale prefix (recordState: an id the batch generated takes the new
 * prefix; any other keeps its id, W_ID_PREFIX_STALE names the `bpmn set`
 * that renames it: reportStalePrefixes, against the final state).
 */
import type { Doc } from '../model/Doc.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { followDiIds } from '../diagram/utils/di-ids.js';
import { cutAt, MAX_ID } from '../ids/utils/slug.js';
import { IdRegistry } from '../ids/IdRegistry.js';
import { kindRequest, type IdRequest } from '../ids/utils/requests.js';
import type { IdState } from '../ids/IdStyle.js';
import { kindLabel, kindOf, triggerOf } from '../model/utils/kinds.js';
import { is, walk, type El } from '../model/utils/moddle.js';
import { CAMUNDA } from '../platform/CamundaDescriptor.js';
import { FlowIdFollower } from './FlowIdFollower.js';
import { descriptorOf, idOf } from './utils/elements.js';

export class IdRenamer {
  constructor(private readonly doc: Doc) {}

  /** The type and trigger of an element (W_ID_PREFIX_STALE compares them before and after a retype or a trigger change). */
  static stateOf(el: El): IdState {
    const trigger = triggerOf(el);
    return { type: el.$type, ...(trigger ? { trigger } : {}) };
  }

  /**
   * Renames an element id, re-pointing every reference (incl. string refs
   * like calledElement); a DI shape or edge id derived from the old id
   * follows (diagram/utils/di-ids.ts followDiIds: `BPMNShape_<old>`, `<old>_di`).
   */
  rename(el: El, newId: string): void {
    const doc = this.doc;
    const old = idOf(el);
    if (old === newId) return;
    doc.claimId(newId);
    el.set('id', newId);
    if (old) {
      doc.ids.release(old);
      followDiIds(doc.definitions, el, old, newId, doc.ids);
    }
    // id-valued attributes of vendor extension elements are plain strings in the model
    const vendorRefs = CAMUNDA.idReferenceAttrs().filter((r) => is(el, r.target));
    for (const e of walk(doc.definitions)) {
      if (is(e, 'bpmn:CallActivity') && e.get<string | undefined>('calledElement') === old) e.set('calledElement', newId);
      if (!descriptorOf(e).isGeneric) continue;
      const any = e as unknown as Record<string, unknown>;
      if (e.$type === 'zeebe:calledElement' && any['processId'] === old) any['processId'] = newId;
      if (!vendorRefs.length) continue;
      const [prefix, local] = e.$type.split(':');
      if (!prefix || !local || !CAMUNDA.reads(doc.namespaceUri(prefix))) continue;
      for (const ref of vendorRefs) {
        if (ref.element !== `camunda:${local}`) continue;
        if (any[ref.attr] === old) any[ref.attr] = newId;
        if (e.$attrs?.[ref.attr] === old) e.$attrs[ref.attr] = newId;
      }
    }
    doc.invalidate();
  }

  /**
   * Records what `el` was (`before`, `wasLabel`) when a retype or a trigger
   * change kept its id, for W_ID_PREFIX_STALE (reportStalePrefixes, at the
   * end of the op on its own or of the batch). An id the batch generated
   * (IdAllocator.generatedBase) is nobody's API yet: where the change leaves it a
   * prefix the declared conventions do not accept, the element takes the id
   * of what it is now (IdStyle.stalePrefix on the id it wanted:
   * serviceTask_checkInvoice, retyped to a user task, is
   * userTask_checkInvoice; scriptTask_run of a type the rule switches off,
   * retyped to a service task, serviceTask_run; a taken one gets a suffix),
   * a rename the batch's entries, their details, notes and warnings follow
   * (Rename.regenerated), and no warning. The flows the batch named after it
   * follow too (FlowIdFollower.namedAfter: SFGoToSTCheck becomes SFGoToUTCheck). Nothing
   * without declared conventions.
   */
  recordState(el: El, before: IdState, wasLabel: string): void {
    const doc = this.doc;
    const style = doc.idStyle;
    if (!style.declared) return;
    const id = idOf(el);
    const allocator = doc.edit.allocator;
    const base = allocator.generatedBase(id);
    if (base === undefined) {
      doc.edit.recordIdState(id, before, wasLabel);
      return;
    }
    // from the id it wanted: a collision suffix under the old prefix is not the new one's
    const stale = style.stalePrefix(base, before, IdRenamer.stateOf(el), IdRenamer.requestOf(el));
    if (!stale) return;
    const wanted = cutAt(stale.suggested, MAX_ID);
    const next = allocator.regenerated(id, wanted, style.suffixSep(kindOf(el)?.kind ?? el.$type));
    // the ends before the rename: what the flows named
    const follower = new FlowIdFollower(doc);
    const flows = follower.namedAfter(el).map((f) => ({ flow: f, was: `${idOf(f.get<El>('sourceRef'))} -> ${idOf(f.get<El>('targetRef'))}` }));
    this.rename(el, next);
    allocator.markGenerated(next, wanted);
    doc.edit.recordRegenerated(id, next, undefined, el);
    for (const { flow, was } of flows) follower.followRenamedEnd(flow, was);
  }

  /**
   * W_ID_PREFIX_STALE on `cs` for each element a retype or a trigger change
   * kept the id of (EditContext.takeIdStates), whose prefix the declared id
   * conventions (element-id-naming) accept for what it was before the first
   * change, or that they did not check then (none declared for it), and not
   * for what it is now, after the last: its prefix then, the prefixes for
   * its final type and trigger, and the `bpmn set` that renames it (free in
   * the file and among the hints). Ids are API, so it keeps the id. None for
   * an element a later op renamed or removed, or that fits again.
   */
  reportStalePrefixes(cs: ChangeSet): void {
    const doc = this.doc;
    const states = doc.edit.takeIdStates();
    if (!states.size) return;
    const style = doc.idStyle;
    const hinted = new IdRegistry(doc.ids.values());
    for (const [id, { before, wasLabel }] of states) {
      const el = doc.get(id);
      const stale = el && style.stalePrefix(id, before, IdRenamer.stateOf(el), IdRenamer.requestOf(el));
      if (!el || !stale) continue;
      const sep = style.suffixSep(kindOf(el)?.kind ?? el.$type);
      const suggested = doc.edit.allocator.suffixed(stale.suggested, sep, (taken) => hinted.has(taken), () => stale.suggested);
      hinted.claim(suggested);
      const rule = `element-id-naming (${doc.edit.conventions?.source ?? 'the host'})`;
      const expects = `${stale.heads.join(' or ')} for ${IdRenamer.aKind(kindLabel(el))}`;
      cs.warn({
        code: 'W_ID_PREFIX_STALE',
        message: stale.was !== undefined ? `${id} keeps its id, whose prefix ${stale.was} is that of ${IdRenamer.aKind(wasLabel)}; ${rule} expects ${expects}` : `${id} keeps its id, which ${rule} did not check on ${IdRenamer.aKind(wasLabel)}; it expects ${expects}`,
        element: id,
        hint: `Code, tests and links that use the id keep working; to follow the convention: \`bpmn set <file> ${id} id=${suggested}\`.`,
      });
    }
  }

  /** A kind with its article: `an endEvent`, `an intermediateCatchEvent:message`, `a userTask` (userTask is the one kind with a u, said like `you`). */
  private static aKind(kind: string): string {
    return `${/^[aeio]/i.test(kind) ? 'an' : 'a'} ${kind}`;
  }

  /** The id request for what an element is now (its kind, trigger and name): IdStyle.stalePrefix where no declared prefix fitted what it was. */
  private static requestOf(el: El): IdRequest | undefined {
    const def = kindOf(el);
    if (!def) return undefined;
    const trigger = triggerOf(el);
    const name = el.get<string | undefined>('name');
    return kindRequest(def, { ...(trigger && trigger !== 'none' ? { trigger } : {}), ...(name ? { name } : {}) });
  }
}
