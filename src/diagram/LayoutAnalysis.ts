import { is, parseXml, type El } from '../model/utils/moddle.js';
import { PlaneAnalysis, type Add } from './PlaneAnalysis.js';
import { enclosingProcess, type MetricIndex } from './utils/harness.js';
import { idOf, raw, rawList } from './utils/raw.js';
import { KEYS, perKey, scoreOf, type LayoutMetrics, type LayoutProblem } from './utils/problems.js';

/**
 * Layout quality metrics with element ids, a library port of the regression harness's `analyse()`.
 * For the harness kinds the metrics, de-duplication and weights must match: change both together.
 * Reads the model raw, since `get()` would materialise empty collections.
 */
export class LayoutAnalysis {
  private readonly index: MetricIndex = { parentOf: new Map(), laneOf: new Map(), poolOf: new Map(), need: new Set(), next: new Map() };
  private readonly keys = perKey(() => new Set<string>());
  private readonly found = perKey<LayoutProblem[]>(() => []);

  /** `importWarnings` is reported as one `failed` problem. */
  static of(defs: El, opts: { importWarnings?: number } = {}): LayoutMetrics {
    return new LayoutAnalysis(defs).run(opts.importWarnings);
  }

  static async ofXml(xml: string): Promise<LayoutMetrics> {
    const { definitions, importWarnings } = await parseXml(xml);
    return LayoutAnalysis.of(definitions, { importWarnings: importWarnings.length });
  }

  private constructor(private readonly defs: El) {}

  private readonly add: Add = (kind, key, ids, detail) => {
    if (this.keys[kind].has(key)) return;
    this.keys[kind].add(key);
    this.found[kind].push(detail === undefined ? { kind, ids } : { kind, ids, detail });
  };

  private run(importWarnings: number | undefined): LayoutMetrics {
    if (importWarnings) {
      const message = `import warnings: ${importWarnings}`;
      this.add('failed', message, [], message);
    }
    this.indexDefinitions();
    const seen = new Set<string>();
    for (const diagram of rawList(this.defs, 'diagrams')) new PlaneAnalysis(raw(diagram, 'plane'), this.index, seen, this.add).run();
    for (const id of this.index.need) if (!seen.has(id)) this.add('missing', id, [id]);
    const counts = perKey(() => 0);
    for (const k of KEYS) counts[k] = this.found[k].length;
    return { counts, problems: KEYS.flatMap((k) => this.found[k]), score: scoreOf(counts) };
  }

  private indexDefinitions(): void {
    const roots = rawList(this.defs, 'rootElements');
    for (const root of roots) {
      if (is(root, 'bpmn:Process')) this.collectScope(root);
      if (is(root, 'bpmn:Collaboration')) {
        for (const p of rawList(root, 'participants')) {
          const id = idOf(p);
          if (id) this.index.need.add(id);
          const procId = idOf(raw<El>(p, 'processRef'));
          if (procId) this.index.poolOf.set(procId, p);
        }
        for (const m of rawList(root, 'messageFlows')) {
          const id = idOf(m);
          if (id) this.index.need.add(id);
        }
      }
    }
    this.dropUnlaidProcesses(roots);
  }

  private collectLanes(lanes: El[], laneOf: Map<string, El>): void {
    for (const lane of lanes) {
      for (const node of rawList(lane, 'flowNodeRef')) {
        const id = idOf(node);
        if (id) laneOf.set(id, lane);
      }
      const child = raw<El>(lane, 'childLaneSet');
      if (child) this.collectLanes(rawList(child, 'lanes'), laneOf);
    }
  }

  private link(from: string | undefined, to: string | undefined): void {
    if (!from || !to) return;
    const list = this.index.next.get(from);
    if (list) list.push(to);
    else this.index.next.set(from, [to]);
  }

  private collectScope(scope: El): void {
    for (const fe of rawList(scope, 'flowElements')) {
      const id = idOf(fe);
      if (id) {
        this.index.parentOf.set(id, scope);
        const drawn = is(fe, 'bpmn:FlowNode') || is(fe, 'bpmn:SequenceFlow') || is(fe, 'bpmn:DataObjectReference') || is(fe, 'bpmn:DataStoreReference');
        if (drawn) this.index.need.add(id);
      }
      if (is(fe, 'bpmn:SubProcess')) this.collectScope(fe);
      if (is(fe, 'bpmn:SequenceFlow')) this.link(idOf(raw(fe, 'sourceRef')), idOf(raw(fe, 'targetRef')));
      if (is(fe, 'bpmn:BoundaryEvent')) this.link(idOf(raw(fe, 'attachedToRef')), id);
      for (const da of [...rawList(fe, 'dataInputAssociations'), ...rawList(fe, 'dataOutputAssociations')]) {
        const daId = idOf(da);
        if (daId) this.index.need.add(daId);
      }
    }
    for (const a of rawList(scope, 'artifacts')) {
      const id = idOf(a);
      if (!id) continue;
      this.index.parentOf.set(id, scope);
      if (is(a, 'bpmn:TextAnnotation') || is(a, 'bpmn:Association')) this.index.need.add(id);
    }
    for (const ls of rawList(scope, 'laneSets')) this.collectLanes(rawList(ls, 'lanes'), this.index.laneOf);
  }

  /** only the laid-out root needs DI: further root processes are a documented limitation */
  private dropUnlaidProcesses(roots: El[]): void {
    const collab = roots.find((e) => is(e, 'bpmn:Collaboration'));
    const laid = new Set<string>();
    if (collab) {
      for (const p of rawList(collab, 'participants')) {
        const id = idOf(raw<El>(p, 'processRef'));
        if (id) laid.add(id);
      }
    } else {
      const id = idOf(roots.find((e) => is(e, 'bpmn:Process')));
      if (id) laid.add(id);
    }
    for (const id of [...this.index.need]) {
      const proc = enclosingProcess(this.index.parentOf.get(id));
      if (proc && !laid.has(idOf(proc) ?? '')) this.index.need.delete(id);
    }
  }
}
