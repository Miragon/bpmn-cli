#!/usr/bin/env node
/**
 * Layout regression harness.
 *
 * Re-lays out every scenario in tools/scenarios with the current build and
 * scores the diagram interchange it produced. Use it after every change to
 * src/domain/diagram/layout/*: a change is good when the total score drops and no single
 * file gets worse.
 *
 *   npm run build
 *   node tools/layout-regress.mjs                      # score every scenario
 *   node tools/layout-regress.mjs --verbose            # list the offending ids
 *   node tools/layout-regress.mjs --filter claim       # only matching files
 *   node tools/layout-regress.mjs --save base.json     # record a baseline
 *   node tools/layout-regress.mjs --compare base.json  # per-file better / worse
 *
 * Metrics (weight in the score):
 *   crossings 5      two edges crossing properly, neither the dotted line of a text
 *                    annotation (a line through the annotation's text is `through`)
 *   overlaps 10      two leaf shapes overlapping (a boundary event may overlap its host;
 *                    pools, lanes, expanded sub-processes and groups are no leaves)
 *   through 8        an edge segment cutting a shape it does not connect (a real
 *                    segment-rectangle test, so a diagonal passing a shape does not count)
 *   diagonal 3       a non-orthogonal sequence or message flow
 *   missing 10       a semantic element without DI
 *   labelClash 2     a label box on a shape or on another label
 *   labelOnLine 1    label text crossed by a line
 *   inOut 3          an incoming and an outgoing flow of one node sharing a line
 *   parallelRun 1    two unrelated edges running collinear for more than 20px
 *   outsideLane 6    a node outside the lane it belongs to
 *   outsidePool 8    a node outside its pool
 *   outsideSub 8     a node outside its expanded sub-process
 *   edgeLeavesLane 1 a flow inside one lane leaving it
 *   edgeOutside 4    a flow leaving its pool or sub-process
 *   msgThroughPool 5 a message flow crossing a pool it does not touch
 *   laneGap 2        lanes not filling their pool
 *   failed 50        the layout command itself failed
 *
 * Crossings between a compensation or data association and a sequence flow,
 * and joins bundling into a gateway's bottom vertex, are conventional in BPMN:
 * expect a residual score rather than zero.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';
import { CLI_ENV } from './fuzz/lib/setup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'bpmn.js');
const SCENARIOS = join(ROOT, 'tools', 'scenarios');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const verbose = flag('--verbose');
const filter = value('--filter');
const save = value('--save');
const compare = value('--compare');
const keep = flag('--keep');
const WORK = value('--work') ?? join(ROOT, 'tools', '.regress-work');
mkdirSync(WORK, { recursive: true });

const sources = readdirSync(SCENARIOS)
  .filter((fileName) => fileName.endsWith('.bpmn') && (!filter || fileName.includes(filter)))
  .sort()
  .map((fileName) => ({ key: fileName, src: join(SCENARIOS, fileName) }));

const moddle = new BpmnModdle();
const is = (el, type) => !!el && typeof el.$instanceOf === 'function' && el.$instanceOf(type);
const segs = (pts) => {
  const pairs = [];
  for (let pointIndex = 0; pointIndex + 1 < pts.length; pointIndex++) {
    pairs.push([pts[pointIndex], pts[pointIndex + 1]]);
  }
  return pairs;
};
const orient = (start, end, point) => Math.sign((end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x));
const cross = ([firstStart, firstEnd], [secondStart, secondEnd]) => { const o1 = orient(firstStart, firstEnd, secondStart), o2 = orient(firstStart, firstEnd, secondEnd), o3 = orient(secondStart, secondEnd, firstStart), o4 = orient(secondStart, secondEnd, firstEnd); return o1 !== o2 && o3 !== o4 && o1 && o2 && o3 && o4; };
const hits = ([segStart, segEnd], bounds, shrink = 2) => Math.min(segStart.x, segEnd.x) < bounds.x + bounds.width - shrink && Math.max(segStart.x, segEnd.x) > bounds.x + shrink && Math.min(segStart.y, segEnd.y) < bounds.y + bounds.height - shrink && Math.max(segStart.y, segEnd.y) > bounds.y + shrink;
// the segment itself meets the shrunk box (Liang-Barsky on the open box); axis-parallel: the bounding-box test
const slab = (origin, delta, lo, hi) => { const entry = (lo - origin) / delta, exit = (hi - origin) / delta; return entry < exit ? [entry, exit] : [exit, entry]; };
const cuts = (seg, bounds, shrink = 2) => {
  const [segStart, segEnd] = seg;
  if (segStart.x === segEnd.x || segStart.y === segEnd.y) {
    return hits(seg, bounds, shrink);
  }
  const x0 = bounds.x + shrink, x1 = bounds.x + bounds.width - shrink, y0 = bounds.y + shrink, y1 = bounds.y + bounds.height - shrink;
  if (x0 >= x1 || y0 >= y1) return false;
  const [ax, bx] = slab(segStart.x, segEnd.x - segStart.x, x0, x1), [ay, by] = slab(segStart.y, segEnd.y - segStart.y, y0, y1);
  const lo = Math.max(ax, ay), hi = Math.min(bx, by);
  return lo < hi && lo < 1 && hi > 0;
};
const overlap = (first, second) => first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
const inside = (inner, outer, tol = 0) => inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.width <= outer.x + outer.width + tol && inner.y + inner.height <= outer.y + outer.height + tol;
const ptIn = (point, bounds, tol = 0) => point.x >= bounds.x - tol && point.x <= bounds.x + bounds.width + tol && point.y >= bounds.y - tol && point.y <= bounds.y + bounds.height + tol;
const collinear = ([firstStart, firstEnd], [secondStart, secondEnd]) => {
  if (firstStart.x === firstEnd.x && secondStart.x === secondEnd.x && firstStart.x === secondStart.x) {
    return Math.min(Math.max(firstStart.y, firstEnd.y), Math.max(secondStart.y, secondEnd.y)) - Math.max(Math.min(firstStart.y, firstEnd.y), Math.min(secondStart.y, secondEnd.y));
  }
  if (firstStart.y === firstEnd.y && secondStart.y === secondEnd.y && firstStart.y === secondStart.y) {
    return Math.min(Math.max(firstStart.x, firstEnd.x), Math.max(secondStart.x, secondEnd.x)) - Math.max(Math.min(firstStart.x, firstEnd.x), Math.min(secondStart.x, secondEnd.x));
  }
  return 0;
};
const glyph = (lb, name) => { const est = Math.max(6, name.length * 6); const glyphWidth = Math.min(est, 90); const lines = Math.max(1, Math.ceil(est / 90)); return { x: lb.x + lb.width / 2 - glyphWidth / 2, y: lb.y, width: glyphWidth, height: lines * 14 }; };
const idOf = (el) => el && el.id;
// the same rule as src/domain/diagram/utils/annotations.ts
const annotationLine = (el) => is(el, 'bpmn:Association') && (is(el.sourceRef, 'bpmn:TextAnnotation') || is(el.targetRef, 'bpmn:TextAnnotation'));

const KEYS = ['crossings', 'overlaps', 'through', 'diagonal', 'missing', 'labelClash', 'labelOnLine', 'inOut', 'parallelRun', 'outsideLane', 'outsidePool', 'outsideSub', 'edgeLeavesLane', 'edgeOutside', 'msgThroughPool', 'laneGap', 'failed'];
const WEIGHTS = { crossings: 5, overlaps: 10, through: 8, diagonal: 3, missing: 10, labelClash: 2, labelOnLine: 1, inOut: 3, parallelRun: 1, outsideLane: 6, outsidePool: 8, outsideSub: 8, edgeLeavesLane: 1, edgeOutside: 4, msgThroughPool: 5, laneGap: 2, failed: 50 };

async function analyse(xml) {
  const { rootElement: defs, warnings } = await moddle.fromXML(xml);
  const report = Object.fromEntries(KEYS.map((metricKey) => [metricKey, []]));
  if (warnings.length) report.failed.push(`import warnings: ${warnings.length}`);
  const parentOf = new Map(), laneOf = new Map(), partOfProc = new Map();
  const need = new Set();
  const walk = (scope) => {
    for (const fe of scope.flowElements || []) {
      parentOf.set(fe.id, scope);
      if (is(fe, 'bpmn:FlowNode') || is(fe, 'bpmn:SequenceFlow') || is(fe, 'bpmn:DataObjectReference') || is(fe, 'bpmn:DataStoreReference')) {
        need.add(fe.id);
      }
      if (is(fe, 'bpmn:SubProcess')) walk(fe);
      for (const da of [...(fe.dataInputAssociations || []), ...(fe.dataOutputAssociations || [])]) {
        need.add(da.id);
      }
    }
    for (const artifact of scope.artifacts || []) {
      parentOf.set(artifact.id, scope);
      if (is(artifact, 'bpmn:TextAnnotation') || is(artifact, 'bpmn:Association')) {
        need.add(artifact.id);
      }
    }
    const lanes = (ls) => {
      for (const lane of ls || []) {
        for (const flowNode of lane.flowNodeRef || []) {
          laneOf.set(flowNode.id, lane);
        }
        if (lane.childLaneSet) lanes(lane.childLaneSet.lanes);
      }
    };
    for (const ls of scope.laneSets || []) {
      lanes(ls.lanes);
    }
  };
  for (const root of defs.rootElements || []) {
    if (is(root, 'bpmn:Process')) walk(root);
    if (is(root, 'bpmn:Collaboration')) {
      for (const participant of root.participants || []) {
        need.add(participant.id);
        if (participant.processRef) {
          partOfProc.set(participant.processRef.id, participant);
        }
      }
      for (const messageFlow of root.messageFlows || []) {
        need.add(messageFlow.id);
      }
    }
  }
  // only the laid-out root needs DI: further root processes are a documented limitation
  const collab = (defs.rootElements || []).find((rootElement) => is(rootElement, 'bpmn:Collaboration'));
  const laidProcesses = collab
    ? new Set((collab.participants || []).map((participant) => participant.processRef?.id).filter(Boolean))
    : new Set([(defs.rootElements || []).find((rootElement) => is(rootElement, 'bpmn:Process'))?.id].filter(Boolean));
  for (const id of [...need]) {
    let scope = parentOf.get(id);
    while (scope && !is(scope, 'bpmn:Process')) {
      scope = scope.$parent;
    }
    if (scope && !laidProcesses.has(scope.id)) need.delete(id);
  }
  const seen = new Set();
  for (const diagram of defs.diagrams || []) {
    const plane = diagram.plane;
    const shapes = [], edges = [];
    for (const pe of plane.planeElement || []) {
      const el = pe.bpmnElement;
      if (!el) continue;
      seen.add(el.id);
      const lb = pe.label?.bounds ? { x: pe.label.bounds.x, y: pe.label.bounds.y, width: pe.label.bounds.width, height: pe.label.bounds.height } : undefined;
      if (is(pe, 'bpmndi:BPMNShape')) {
        const bounds = { x: pe.bounds.x, y: pe.bounds.y, width: pe.bounds.width, height: pe.bounds.height };
        const container = (is(el, 'bpmn:SubProcess') && pe.isExpanded) || is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane');
        shapes.push({ id: el.id, el, b: bounds, container, expanded: !!pe.isExpanded, label: lb });
      } else {
        const ends = new Set([idOf(el.sourceRef), idOf(el.targetRef)]);
        if (Array.isArray(el.sourceRef)) {
          for (const source of el.sourceRef) {
            ends.add(source.id);
          }
        }
        if (el.$parent && is(el.$parent, 'bpmn:FlowNode')) ends.add(el.$parent.id);
        edges.push({ id: el.id, el, pts: pe.waypoint.map((waypoint) => ({ x: waypoint.x, y: waypoint.y })), ends, label: lb });
      }
    }
    const box = new Map(shapes.map((shape) => [shape.id, shape]));
    const leaf = shapes.filter((shape) => !shape.container && !is(shape.el, 'bpmn:Group'));
    const att = (el) => el.attachedToRef?.id;
    for (let firstIndex = 0; firstIndex < leaf.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < leaf.length; secondIndex++) {
        const first = leaf[firstIndex], second = leaf[secondIndex];
        if ((is(first.el, 'bpmn:BoundaryEvent') && att(first.el) === second.id) || (is(second.el, 'bpmn:BoundaryEvent') && att(second.el) === first.id)) {
          continue;
        }
        if (overlap(first.b, second.b)) {
          report.overlaps.push(`${first.id}~${second.id}`);
        }
      }
    }
    for (const edge of edges) {
      const flow = is(edge.el, 'bpmn:SequenceFlow') || is(edge.el, 'bpmn:MessageFlow');
      for (const segment of segs(edge.pts)) {
        if (flow && segment[0].x !== segment[1].x && segment[0].y !== segment[1].y) {
          report.diagonal.push(edge.id);
        }
        for (const sh of leaf) {
          if (edge.ends.has(sh.id)) continue;
          if (is(sh.el, 'bpmn:BoundaryEvent') && edge.ends.has(att(sh.el))) continue;
          if (cuts(segment, sh.b)) report.through.push(`${edge.id}->${sh.id}`);
        }
      }
    }
    for (let firstIndex = 0; firstIndex < edges.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex++) {
        const firstSegments = segs(edges[firstIndex].pts), secondSegments = segs(edges[secondIndex].pts);
        if (!annotationLine(edges[firstIndex].el) && !annotationLine(edges[secondIndex].el) && firstSegments.some((firstSegment) => secondSegments.some((secondSegment) => cross(firstSegment, secondSegment)))) {
          report.crossings.push(`${edges[firstIndex].id}x${edges[secondIndex].id}`);
        }
        const related = [...edges[firstIndex].ends].some((endId) => edges[secondIndex].ends.has(endId));
        if (!related) {
          let len = 0;
          for (const firstSegment of firstSegments) {
            for (const secondSegment of secondSegments) {
              len += Math.max(0, collinear(firstSegment, secondSegment));
            }
          }
          if (len > 20) {
            report.parallelRun.push(`${edges[firstIndex].id}=${edges[secondIndex].id}(${len})`);
          }
        }
      }
    }
    const labels = [];
    for (const shape of shapes) {
      if (shape.label) {
        labels.push({ owner: shape.id, box: shape.label, text: glyph(shape.label, shape.el.name || '') });
      }
    }
    for (const edge of edges) {
      if (edge.label) {
        labels.push({ owner: edge.id, box: edge.label, text: glyph(edge.label, edge.el.name || '') });
      }
    }
    for (let labelIndex = 0; labelIndex < labels.length; labelIndex++) {
      const label = labels[labelIndex];
      for (const shape of leaf) {
        if (shape.id !== label.owner && overlap(label.box, shape.b)) {
          report.labelClash.push(`${label.owner}#L~${shape.id}`);
        }
      }
      for (let otherIndex = labelIndex + 1; otherIndex < labels.length; otherIndex++) {
        if (overlap(label.box, labels[otherIndex].box)) {
          report.labelClash.push(`${label.owner}#L~${labels[otherIndex].owner}#L`);
        }
      }
      for (const edge of edges) {
        if (segs(edge.pts).some((segment) => hits(segment, label.text, 0))) {
          report.labelOnLine.push(`${label.owner}#L~${edge.id}`);
        }
      }
    }
    const flows = edges.filter((edge) => is(edge.el, 'bpmn:SequenceFlow'));
    for (const shape of shapes) {
      const into = flows.filter((flowEdge) => idOf(flowEdge.el.targetRef) === shape.id), outOf = flows.filter((flowEdge) => idOf(flowEdge.el.sourceRef) === shape.id);
      for (const incoming of into) {
        for (const outgoing of outOf) {
          if (incoming !== outgoing && segs(incoming.pts).some((inSegment) => segs(outgoing.pts).some((outSegment) => collinear(inSegment, outSegment) > 0))) {
            report.inOut.push(`${incoming.id}|${outgoing.id}@${shape.id}`);
          }
        }
      }
    }
    for (const shape of shapes) {
      if (is(shape.el, 'bpmn:Participant') || is(shape.el, 'bpmn:Lane')) continue;
      const parent = parentOf.get(shape.id);
      if (parent && is(parent, 'bpmn:SubProcess') && box.get(parent.id)?.expanded && !inside(shape.b, box.get(parent.id).b)) {
        report.outsideSub.push(shape.id);
      }
      const lane = laneOf.get(shape.id);
      if (lane && box.has(lane.id) && !is(shape.el, 'bpmn:BoundaryEvent') && !inside(shape.b, box.get(lane.id).b)) {
        report.outsideLane.push(shape.id);
      }
      if (parent && is(parent, 'bpmn:Process') && partOfProc.has(parent.id)) {
        const pb = box.get(partOfProc.get(parent.id).id);
        if (pb && !inside(shape.b, pb.b)) report.outsidePool.push(shape.id);
      }
    }
    const pools = shapes.filter((shape) => is(shape.el, 'bpmn:Participant'));
    for (const pool of pools) {
      const proc = pool.el.processRef;
      if (!proc) continue;
      for (const ls of proc.laneSets || []) {
        const top = ls.lanes || [];
        if (!top.length) continue;
        const first = box.get(top[0].id), last = box.get(top[top.length - 1].id);
        if (first && Math.abs(first.b.y - pool.b.y) > 1) {
          report.laneGap.push(`${top[0].id}:top`);
        }
        if (last && Math.abs(last.b.y + last.b.height - (pool.b.y + pool.b.height)) > 1) {
          report.laneGap.push(`${top[top.length - 1].id}:bottom`);
        }
      }
    }
    for (const edge of edges) {
      if (is(edge.el, 'bpmn:SequenceFlow')) {
        const parent = parentOf.get(edge.id);
        let cont;
        if (parent && is(parent, 'bpmn:SubProcess')) {
          cont = box.get(parent.id)?.expanded ? box.get(parent.id).b : undefined;
        } else if (parent && partOfProc.has(parent.id)) {
          cont = box.get(partOfProc.get(parent.id).id)?.b;
        }
        if (cont && edge.pts.some((point) => !ptIn(point, cont))) {
          report.edgeOutside.push(edge.id);
        }
        const sl = laneOf.get(idOf(edge.el.sourceRef)), tl = laneOf.get(idOf(edge.el.targetRef));
        if (sl && sl === tl && box.has(sl.id) && edge.pts.some((point) => !ptIn(point, box.get(sl.id).b))) {
          report.edgeLeavesLane.push(edge.id);
        }
      }
      if (is(edge.el, 'bpmn:MessageFlow')) {
        const ends = new Set([idOf(edge.el.sourceRef), idOf(edge.el.targetRef)]);
        for (const id of [...ends]) {
          let pr = parentOf.get(id);
          while (pr && !is(pr, 'bpmn:Process')) {
            pr = pr.$parent;
          }
          if (pr && partOfProc.has(pr.id)) ends.add(partOfProc.get(pr.id).id);
        }
        for (const segment of segs(edge.pts)) {
          for (const pool of pools) {
            if (!ends.has(pool.id) && hits(segment, pool.b)) {
              report.msgThroughPool.push(`${edge.id}->${pool.id}`);
            }
          }
        }
      }
    }
  }
  for (const id of need) {
    if (!seen.has(id)) report.missing.push(id);
  }
  for (const metricKey of KEYS) {
    report[metricKey] = [...new Set(report[metricKey])];
  }
  return report;
}

const results = {};
const totals = Object.fromEntries(KEYS.map((metricKey) => [metricKey, 0]));
let score = 0;
for (const { key, src } of sources) {
  const work = join(WORK, key);
  copyFileSync(src, work);
  const run = spawnSync(process.execPath, [BIN, 'layout', work, '--force', '--no-lint-config'], { encoding: 'utf8', timeout: 15000, env: CLI_ENV });
  let report;
  if (run.status !== 0) {
    report = Object.fromEntries(KEYS.map((metricKey) => [metricKey, []]));
    report.failed.push((run.stderr || run.error?.message || 'failed').split('\n')[0]);
  } else {
    report = await analyse(readFileSync(work, 'utf8'));
  }
  results[key] = report;
  let fileScore = 0;
  for (const metricKey of KEYS) {
    totals[metricKey] += report[metricKey].length;
    fileScore += report[metricKey].length * WEIGHTS[metricKey];
  }
  report.score = fileScore;
  score += fileScore;
  const bad = KEYS.filter((metricKey) => report[metricKey].length);
  if (verbose || bad.length) {
    console.log(`${key.padEnd(56)} score=${String(fileScore).padStart(4)} ${bad.map((metricKey) => `${metricKey}=${report[metricKey].length}`).join(' ')}`);
    if (verbose) {
      for (const metricKey of bad) {
        console.log(`     ${metricKey}: ${report[metricKey].slice(0, 8).join(', ')}${report[metricKey].length > 8 ? ' ...' : ''}`);
      }
    }
  }
}
console.log(`\nFILES ${sources.length}  SCORE ${score}`);
console.log(KEYS.map((metricKey) => `${metricKey}=${totals[metricKey]}`).join('  '));
if (save) writeFileSync(save, JSON.stringify(results, null, 1));
if (compare && existsSync(compare)) {
  const base = JSON.parse(readFileSync(compare, 'utf8'));
  const worse = [], better = [];
  for (const [scenarioKey, report] of Object.entries(results)) {
    const baseReport = base[scenarioKey];
    if (!baseReport) continue;
    if (report.score > baseReport.score) {
      worse.push(`${scenarioKey}: ${baseReport.score} -> ${report.score}`);
    }
    if (report.score < baseReport.score) {
      better.push(`${scenarioKey}: ${baseReport.score} -> ${report.score}`);
    }
  }
  console.log(`\nBETTER (${better.length})`);
  for (const line of better) {
    console.log(`  ${line}`);
  }
  console.log(`WORSE (${worse.length})`);
  for (const line of worse) {
    console.log(`  ${line}`);
  }
}
if (!keep) {
  rmSync(WORK, { recursive: true, force: true });
} else {
  console.log(`\nlaid-out files kept in ${WORK} (render them to look at the result)`);
}
