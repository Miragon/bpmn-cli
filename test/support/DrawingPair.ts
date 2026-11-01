import { DrawingSnapshot } from '../../src/drawing/index.js';
import { ChangeSet, DocumentReader, type BpmnDocument, type BpmnElement } from '../../src/model/index.js';
import { Fixtures } from './Fixtures.js';

export interface RecordedChanges {
  created: string[];
  changed: string[];
  removed: string[];
  relocated: string[];
  expand: string[];
  collapse: string[];
  renamed: Array<{ from: string; to: string }>;
}

export interface WalkStep {
  name?: string;
  before: string;
  after?: string;
  noLayout?: RecordedChanges & { file: string };
}

export interface PairParts {
  document: BpmnDocument;
  before: DrawingSnapshot;
  changes: ChangeSet;
}

const PLACEMENT = 'drawing/placement';

export class DrawingPair {
  private static readonly RECORDED = JSON.parse(Fixtures.text(`${PLACEMENT}/changes.json`)) as Record<string, RecordedChanges>;

  static read(name: string): Promise<PairParts> {
    return DrawingPair.of(Fixtures.text(`${PLACEMENT}/${name}.before.bpmn`), Fixtures.text(`${PLACEMENT}/${name}.after.bpmn`), DrawingPair.RECORDED[name]!);
  }

  static walkSteps(walk: string): Array<WalkStep & { noLayout: NonNullable<WalkStep['noLayout']> }> {
    const { steps } = JSON.parse(Fixtures.text(`walks/${walk}`)) as { steps: WalkStep[] };
    return steps.filter((step): step is WalkStep & { noLayout: NonNullable<WalkStep['noLayout']> } => !!step.noLayout && !!step.after);
  }

  static parsed(xml: string): Promise<BpmnDocument> {
    return new DocumentReader().read(xml);
  }

  static async drawn(path: string, changes = new ChangeSet()): Promise<PairParts> {
    const document = await Fixtures.read(path);
    return { document, before: DrawingSnapshot.of(document), changes };
  }

  static async of(beforeXml: string, afterXml: string, recorded: RecordedChanges): Promise<PairParts> {
    const reader = new DocumentReader();
    const document = await reader.read(afterXml);
    const before = DrawingSnapshot.of(await reader.read(beforeXml));
    DrawingPair.rekey(before, document, recorded);
    return { document, before, changes: DrawingPair.changesOf(recorded) };
  }

  private static changesOf({ created, changed, removed, relocated, expand, collapse }: RecordedChanges): ChangeSet {
    const changes = new ChangeSet();
    created.forEach((id) => changes.create({ id, kind: 'recorded' }));
    changed.forEach((id) => changes.change({ id, kind: 'recorded' }));
    removed.forEach((id) => changes.remove({ id, kind: 'recorded' }));
    changes.relocated.push(...relocated);
    expand.forEach((id) => changes.expansions.expand(id, true));
    collapse.forEach((id) => changes.expansions.expand(id, false));
    return changes;
  }

  private static rekey(before: DrawingSnapshot, document: BpmnDocument, { renamed, expand, collapse }: RecordedChanges): void {
    const idNow = new Map(renamed.map(({ from, to }) => [from, to]));
    const now = (id: string): string => idNow.get(id) ?? id;
    const elementNow = (element: BpmnElement): BpmnElement => document.tree.byId(now(element.peek<string>('id') ?? '')) ?? element;
    const key = (plane: BpmnElement | undefined, di: BpmnElement, id: string | undefined): string => `${plane?.peek<string>('id')}|${di.type}|${id}`;
    const drawn = new Map(document.diagram.planes().flatMap((plane) => plane.list('planeElement').map((di) => [key(plane, di, di.peek<BpmnElement>('bpmnElement')?.peek<string>('id')), di] as const)));
    for (const [di, entry] of [...before.byDi]) {
      before.byDi.delete(di);
      const current = drawn.get(key(entry.planeDi, di, now(entry.id)));
      if (current) {
        before.byDi.set(current, { ...entry, planeDi: current.parent });
      }
    }
    for (const [id, element] of [...before.els]) {
      before.els.set(id, elementNow(element));
    }
    for (const [group, name] of [...before.groupNames]) {
      before.groupNames.delete(group);
      before.groupNames.set(elementNow(group), name);
    }
    before.stickies = before.stickies.map((sticky) => ({ ...sticky, process: elementNow(sticky.process), node: elementNow(sticky.node) }));
    const requested = new Set([...expand, ...collapse]);
    for (const [di, { id, expanded }] of before.byDi) {
      if (expanded !== undefined && requested.has(before.currentId(id))) {
        di.set('isExpanded', expanded);
      }
    }
  }
}
