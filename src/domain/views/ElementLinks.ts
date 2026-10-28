import type { Doc } from '../document/Doc.js';
import { is, list, peek, shownId, type El } from '../document/utils/moddle.js';
import { laneOf } from '../document/utils/lanes.js';
import type { DetailData, DetailMessageFlow, ViewAnnotation, ViewData, ViewMessageFlow } from './model-view.js';
import { compact, nameOf, nonEmpty, refLabel, scopesWithin } from './utils/view.js';

export class ElementLinks {
  private associationList?: El[];

  constructor(private readonly doc: Doc) {}

  associations(): El[] {
    if (!this.associationList) {
      const collab = this.doc.collaboration();
      const owners = [...this.doc.processes().flatMap(scopesWithin), ...(collab ? [collab] : [])];
      this.associationList = owners.flatMap((owner) => list(owner, 'artifacts')).filter((artifact) => is(artifact, 'bpmn:Association'));
    }
    return this.associationList;
  }

  annotationsIn(owners: El[]): ViewAnnotation[] {
    const out: ViewAnnotation[] = [];
    for (const owner of owners) {
      for (const el of list(owner, 'artifacts')) {
        if (!is(el, 'bpmn:TextAnnotation')) continue;
        const attachedTo: string[] = [];
        for (const association of this.associations()) {
          const source = peek<El>(association, 'sourceRef');
          const target = peek<El>(association, 'targetRef');
          if (source === el && target) attachedTo.push(shownId(target));
          else if (target === el && source) attachedTo.push(shownId(source));
        }
        const text = peek<string>(el, 'text');
        out.push(compact<ViewAnnotation>({ id: shownId(el), text: text ? String(text) : undefined, attachedTo }));
      }
    }
    return out;
  }

  annotationsOf(el: El): Array<{ id: string; text?: string }> {
    const out: Array<{ id: string; text?: string }> = [];
    for (const association of this.associations()) {
      const source = peek<El>(association, 'sourceRef');
      const target = peek<El>(association, 'targetRef');
      const other = source === el ? target : target === el ? source : undefined;
      if (!other || !is(other, 'bpmn:TextAnnotation') || out.some((listed) => listed.id === shownId(other))) continue;
      const text = peek<string>(other, 'text');
      out.push(compact({ id: shownId(other), text: text ? String(text) : undefined }));
    }
    return out;
  }

  poolOf(el: El): El | undefined {
    if (is(el, 'bpmn:Participant')) return el;
    const process = this.doc.processOf(el);
    return process ? this.doc.participantOf(process) : undefined;
  }

  messageFlowsOf(el: El): DetailMessageFlow[] {
    const out: DetailMessageFlow[] = [];
    for (const mf of this.doc.messageFlows()) {
      const direction = peek<El>(mf, 'sourceRef') === el ? 'out' : peek<El>(mf, 'targetRef') === el ? 'in' : undefined;
      if (direction) out.push(this.messageFlowEntry(mf, direction));
    }
    return out;
  }

  messageFlowEntry(mf: El, direction: 'in' | 'out'): DetailMessageFlow {
    const partner = peek<El>(mf, direction === 'out' ? 'targetRef' : 'sourceRef');
    const pool = partner ? this.poolOf(partner) : undefined;
    const message = peek<El>(mf, 'messageRef');
    return compact<DetailMessageFlow>({
      direction,
      id: shownId(mf),
      name: nameOf(mf),
      message: message ? refLabel(message) : undefined,
      partner: shownId(partner),
      partnerName: partner ? nameOf(partner) : undefined,
      pool: pool && pool !== partner ? shownId(pool) : undefined,
      poolName: pool && pool !== partner ? nameOf(pool) : undefined,
    });
  }

  viewMessageFlowOf(mf: El, nameOf: (el: El) => string | undefined): ViewMessageFlow {
    const named = (el: El | undefined) => (el ? nameOf(el) : undefined);
    const source = peek<El>(mf, 'sourceRef');
    const target = peek<El>(mf, 'targetRef');
    const message = peek<El>(mf, 'messageRef');
    return compact<ViewMessageFlow>({
      id: shownId(mf),
      source: shownId(source),
      target: shownId(target),
      name: named(mf),
      message: message ? (named(message) ?? shownId(message)) : undefined,
      sourceName: named(source),
      targetName: named(target),
    });
  }

  viewDataOf(data: El): ViewData {
    const kind = is(data, 'bpmn:DataStoreReference') ? 'dataStore' : 'dataObject';
    return compact<ViewData>({ id: shownId(data), kind, name: nameOf(data), from: [], to: [] });
  }

  dataRefsOf(el: El): { reads: El[]; writes: El[] } {
    const isData = (data: El | undefined): data is El => !!data && (is(data, 'bpmn:DataObjectReference') || is(data, 'bpmn:DataStoreReference'));
    const reads = list(el, 'dataInputAssociations').flatMap((association) => list(association, 'sourceRef')).filter(isData);
    const writes = list(el, 'dataOutputAssociations').map((association) => peek<El>(association, 'targetRef')).filter(isData);
    return { reads, writes };
  }

  dataLinksOf(el: El): DetailData | undefined {
    const ref = (data: El | undefined) => (data ? compact({ id: shownId(data), name: nameOf(data) }) : undefined);
    if (is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference')) {
      const process = this.doc.processOf(el);
      const nodes = process ? scopesWithin(process).flatMap((scope) => this.doc.flowNodes(scope)) : [];
      const writtenBy = nodes.filter((node) => list(node, 'dataOutputAssociations').some((association) => peek<El>(association, 'targetRef') === el)).map(shownId);
      const readBy = nodes.filter((node) => list(node, 'dataInputAssociations').some((association) => list(association, 'sourceRef').includes(el))).map(shownId);
      return readBy.length || writtenBy.length ? compact<DetailData>({ readBy: nonEmpty(readBy), writtenBy: nonEmpty(writtenBy) }) : undefined;
    }
    const refs = this.dataRefsOf(el);
    const reads = refs.reads.map((data) => ref(data)!);
    const writes = refs.writes.map((data) => ref(data)!);
    return reads.length || writes.length ? compact<DetailData>({ reads: nonEmpty(reads), writes: nonEmpty(writes) }) : undefined;
  }

  /** Its own lane, a boundary event's host's, else the nearest sub-process's (`via`). */
  effectiveLane(el: El): { lane: El; via?: El } | undefined {
    const own = laneOf(this.doc, el);
    if (own) return { lane: own };
    const host = is(el, 'bpmn:BoundaryEvent') ? peek<El>(el, 'attachedToRef') : undefined;
    if (host) {
      const found = this.effectiveLane(host);
      if (found) return { lane: found.lane, via: found.via ?? host };
    }
    let scope = this.doc.scopeOf(el);
    while (scope && is(scope, 'bpmn:SubProcess')) {
      const lane = laneOf(this.doc, scope);
      if (lane) return { lane, via: scope };
      scope = this.doc.scopeOf(scope);
    }
    return undefined;
  }
}
