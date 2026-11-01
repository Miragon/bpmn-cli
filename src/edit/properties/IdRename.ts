import { type BpmnElement, CAMUNDA, type ChangeSet, DiIdStyle, ElementWalk, IdCut, IdRegistry, type IdRequest, IdRequests, type IdState, Kinds, Triggers } from '../../model/index.js';
import { FlowIdFollower } from '../flows/FlowIdFollower.js';
import type { EditSession } from '../session/EditSession.js';

type VendorIdReference = ReturnType<typeof CAMUNDA.idReferenceAttrs>[number];

export class IdRename {
  constructor(private readonly edit: EditSession) {}

  static stateOf(el: BpmnElement): IdState {
    const trigger = Triggers.of(el);
    return { type: el.type, ...(trigger ? { trigger } : {}) };
  }

  rename(el: BpmnElement, newId: string): void {
    const document = this.edit.document;
    const old = el.id;
    if (old === newId) {
      return;
    }
    this.edit.allocator.claim(newId);
    el.set('id', newId);
    if (old) {
      document.ids.registry.release(old);
      DiIdStyle.followRename(document.tree.definitions, el, old, newId, document.ids.registry);
    }
    const vendorRefs = CAMUNDA.idReferenceAttrs().filter((reference) => el.is(reference.target));
    for (const element of new ElementWalk(document.tree.definitions).depthFirst()) {
      if (element.is('bpmn:CallActivity') && element.get<string | undefined>('calledElement') === old) {
        element.set('calledElement', newId);
      }
      if (element.descriptor.isGeneric) {
        this.followInGeneric(element, old, newId, vendorRefs);
      }
    }
    document.tree.invalidate();
  }

  private followInGeneric(element: BpmnElement, old: string, newId: string, vendorRefs: VendorIdReference[]): void {
    if (element.type === 'zeebe:calledElement' && element.peek('processId') === old) {
      element.set('processId', newId);
    }
    if (!vendorRefs.length) {
      return;
    }
    const [prefix, local] = element.type.split(':');
    if (!prefix || !local || !CAMUNDA.reads(this.edit.document.namespaces.uriOf(prefix))) {
      return;
    }
    for (const ref of vendorRefs.filter((reference) => reference.element === `camunda:${local}`)) {
      if (element.peek(ref.attr) === old) {
        element.set(ref.attr, newId);
      }
      if (element.attrs?.[ref.attr] === old) {
        element.attrs[ref.attr] = newId;
      }
    }
  }

  recordState(el: BpmnElement, before: IdState, wasLabel: string): void {
    const style = this.edit.idStyle;
    const id = el.id;
    const allocator = this.edit.allocator;
    const base = allocator.generatedBase(id);
    if (base === undefined) {
      if (style.declared) {
        this.edit.journal.recordIdState(id, before, wasLabel);
      }
      return;
    }
    const stale = style.stalePrefix(base, before, IdRename.stateOf(el), IdRename.requestOf(el));
    if (!stale) {
      return;
    }
    const wanted = IdCut.cutAt(stale.suggested, IdCut.MAX_ID);
    const next = allocator.regenerated(wanted, style.suffixSep());
    const flows = new FlowIdFollower(this.edit).namedAfter(el).map((flow) => ({ flow, was: `${flow.get<BpmnElement>('sourceRef').id} -> ${flow.get<BpmnElement>('targetRef').id}` }));
    this.rename(el, next);
    allocator.markGenerated(next, wanted);
    this.edit.journal.recordRegenerated(id, next, undefined, el);
    for (const { flow, was } of flows) {
      new FlowIdFollower(this.edit).followRenamedEnd(flow, was);
    }
  }

  reportStalePrefixes(changes: ChangeSet): void {
    const document = this.edit.document;
    const states = this.edit.journal.takeIdStates();
    if (!states.size) {
      return;
    }
    const style = this.edit.idStyle;
    const hinted = new IdRegistry(document.ids.registry.values());
    for (const [id, { before, wasLabel }] of states) {
      const el = document.tree.byId(id);
      const stale = el && style.stalePrefix(id, before, IdRename.stateOf(el), IdRename.requestOf(el));
      if (!el || !stale) {
        continue;
      }
      const sep = style.suffixSep();
      const suggested = this.edit.allocator.suffixed(stale.suggested, sep, (taken) => hinted.has(taken), () => stale.suggested);
      hinted.claim(suggested);
      const rule = `element-id-naming (${this.edit.conventions?.source ?? 'the host'})`;
      const expects = `${stale.heads.join(' or ')} for ${IdRename.aKind(Kinds.label(el))}`;
      changes.warn({
        code: 'W_ID_PREFIX_STALE',
        message: stale.was !== undefined ? `${id} keeps its id, whose prefix ${stale.was} is that of ${IdRename.aKind(wasLabel)}; ${rule} expects ${expects}` : `${id} keeps its id, which ${rule} did not check on ${IdRename.aKind(wasLabel)}; it expects ${expects}`,
        element: id,
        hint: `Code, tests and links that use the id keep working; to follow the convention: \`bpmn set <file> ${id} id=${suggested}\`.`,
      });
    }
  }

  private static aKind(kind: string): string {
    return `${/^[aeio]/i.test(kind) ? 'an' : 'a'} ${kind}`;
  }

  private static requestOf(el: BpmnElement): IdRequest | undefined {
    const def = Kinds.of(el);
    if (!def) {
      return undefined;
    }
    const trigger = Triggers.of(el);
    const name = el.get<string | undefined>('name');
    return IdRequests.kindRequest(def, { ...(trigger && trigger !== 'none' ? { trigger } : {}), ...(name ? { name } : {}) });
  }
}
