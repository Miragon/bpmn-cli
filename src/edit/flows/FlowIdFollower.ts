import { type BpmnElement, DiIdStyle, ElementLabels, type IdRequest, IdRequests, IdSlug, IdWords } from '../../model/index.js';
import type { EditSession, FormerEnd } from '../session/EditSession.js';

export class FlowIdFollower {
  constructor(private readonly edit: EditSession) {}

  recordFormerEnd(node: BpmnElement): void {
    if (!node.is('bpmn:FlowNode') || !(node.list('incoming').length || node.list('outgoing').length)) {
      return;
    }
    this.edit.recordFormerEnd(node, { id: node.id, labels: FlowIdFollower.endLabels(node) });
  }

  namesEnds(id: string | undefined, source: BpmnElement, target: BpmnElement): boolean {
    if (!id) {
      return false;
    }
    const names = (el: BpmnElement): FormerEnd[] => [{ id: el.id, labels: FlowIdFollower.endLabels(el) }, ...this.edit.formerEndsOf(el)];
    const targets = names(target);
    return names(source).some((sourceName) =>
      targets.some((targetName) => sourceName.labels.some((sourceLabel) => targetName.labels.some((targetLabel) => this.edit.allocator.isDerived(id, IdRequests.connectionRequest('bpmn:SequenceFlow', sourceName.id, targetName.id, { sourceLabel, targetLabel }))))),
    );
  }

  follow(flow: BpmnElement, oldSource: BpmnElement | undefined, oldTarget: BpmnElement | undefined, wanted?: string): string | undefined {
    const document = this.edit.document;
    if (!flow.is('bpmn:SequenceFlow') || !oldSource || !oldTarget) {
      return undefined;
    }
    const source = flow.get<BpmnElement | undefined>('sourceRef');
    const target = flow.get<BpmnElement | undefined>('targetRef');
    if (!source || !target || (source === oldSource && target === oldTarget)) {
      return undefined;
    }
    const old = flow.id;
    if (!old) {
      flow.set('id', this.edit.allocator.explicitOr(wanted, ElementLabels.flowRequest('bpmn:SequenceFlow', source, target)));
      document.tree.invalidate();
      return '';
    }
    if (!this.namesEnds(old, oldSource, oldTarget)) {
      return undefined;
    }
    const oldIds = [oldSource.id, oldTarget.id] as const;
    document.ids.registry.release(old);
    const id = this.edit.allocator.allocate(ElementLabels.flowRequest('bpmn:SequenceFlow', source, target)).id;
    if (id === old) {
      return undefined;
    }
    flow.set('id', id);
    this.edit.journal.recordRename(old, id, `${oldIds[0]} -> ${oldIds[1]}`, flow);
    this.followEdgeId(flow, old, id);
    return old;
  }

  namedAfter(node: BpmnElement): BpmnElement[] {
    const document = this.edit.document;
    const flows = new Set([...node.list('incoming'), ...node.list('outgoing')]);
    for (const root of document.tree.definitions.list('rootElements')) {
      if (!root.is('bpmn:Collaboration')) {
        continue;
      }
      for (const flow of root.list('messageFlows')) {
        if (flow.get<BpmnElement | undefined>('sourceRef') === node || flow.get<BpmnElement | undefined>('targetRef') === node) {
          flows.add(flow);
        }
      }
    }
    return [...flows].filter((flow) => !!flow.get<BpmnElement | undefined>('sourceRef') && !!flow.get<BpmnElement | undefined>('targetRef') && this.edit.allocator.generatedFrom(flow.id, FlowIdFollower.connectionRequestOf(flow)));
  }

  followRenamedEnd(flow: BpmnElement, was: string): void {
    const document = this.edit.document;
    const old = flow.id;
    const req = FlowIdFollower.connectionRequestOf(flow);
    if (this.edit.allocator.generatedFrom(old, req)) {
      return;
    }
    document.ids.registry.release(old);
    const id = this.edit.allocator.allocate(req).id;
    if (id === old) {
      return;
    }
    flow.set('id', id);
    this.edit.journal.recordRegenerated(old, id, was, flow);
    this.followEdgeId(flow, old, id);
  }

  private static endLabels(el: BpmnElement): string[] {
    const labels = [new ElementLabels(el).label(), IdWords.speakingStem(el.id), ...new ElementLabels(el).formerLabels()].filter((label): label is string => !!label);
    const name = el.get<string | undefined>('name');
    if (IdSlug.hasIdWords(name) && !labels.some((label) => label === name || (!label.includes('_') && IdSlug.slugify(label) === IdSlug.slugify(name)))) {
      labels.push(name!);
    }
    return [...new Set(labels)];
  }

  private followEdgeId(flow: BpmnElement, old: string, id: string): void {
    DiIdStyle.followRename(this.edit.document.tree.definitions, flow, old, id, this.edit.document.ids.registry);
    this.edit.document.tree.invalidate();
  }

  private static connectionRequestOf(flow: BpmnElement): IdRequest {
    return ElementLabels.flowRequest(flow.type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', flow.get<BpmnElement>('sourceRef'), flow.get<BpmnElement>('targetRef'));
  }
}
