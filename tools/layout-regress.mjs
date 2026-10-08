#!/usr/bin/env node
/**
 * Layout regression harness.
 *
 * Re-lays out every scenario in tools/scenarios with the current build and
 * scores the diagram interchange it produced. Use it after every change to
 * src/layout/*: a change is good when the total score drops and no single
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
 *   crossings 5      two edges crossing properly
 *   overlaps 10      two leaf shapes overlapping (a boundary event may overlap its host)
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
 * Crossings between a dotted association and a sequence flow, and joins
 * bundling into a gateway's bottom vertex, are conventional in BPMN: expect a
 * residual score rather than zero.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';

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
  .filter((f) => f.endsWith('.bpmn') && (!filter || f.includes(filter)))
  .sort()
  .map((f) => ({ key: f, src: join(SCENARIOS, f) }));

const moddle = new BpmnModdle();
const is = (el, t) => !!el && typeof el.$instanceOf === 'function' && el.$instanceOf(t);
const segs = (pts) => { const o = []; for (let i = 0; i + 1 < pts.length; i++) o.push([pts[i], pts[i + 1]]); return o; };
const orient = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const cross = ([a, b], [c, d]) => { const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b); return o1 !== o2 && o3 !== o4 && o1 && o2 && o3 && o4; };
const hits = ([p, q], b, shrink = 2) => Math.min(p.x, q.x) < b.x + b.width - shrink && Math.max(p.x, q.x) > b.x + shrink && Math.min(p.y, q.y) < b.y + b.height - shrink && Math.max(p.y, q.y) > b.y + shrink;
// the segment itself meets the shrunk box (Liang-Barsky on the open box); axis-parallel: the bounding-box test
const slab = (p, d, lo, hi) => { const a = (lo - p) / d, b = (hi - p) / d; return a < b ? [a, b] : [b, a]; };
const cuts = (seg, b, shrink = 2) => {
  const [p, q] = seg;
  if (p.x === q.x || p.y === q.y) return hits(seg, b, shrink);
  const x0 = b.x + shrink, x1 = b.x + b.width - shrink, y0 = b.y + shrink, y1 = b.y + b.height - shrink;
  if (x0 >= x1 || y0 >= y1) return false;
  const [ax, bx] = slab(p.x, q.x - p.x, x0, x1), [ay, by] = slab(p.y, q.y - p.y, y0, y1);
  const lo = Math.max(ax, ay), hi = Math.min(bx, by);
  return lo < hi && lo < 1 && hi > 0;
};
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a, b, tol = 0) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.width <= b.x + b.width + tol && a.y + a.height <= b.y + b.height + tol;
const ptIn = (p, b, tol = 0) => p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol;
const collinear = ([a, b], [c, d]) => {
  if (a.x === b.x && c.x === d.x && a.x === c.x) return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  if (a.y === b.y && c.y === d.y && a.y === c.y) return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
  return 0;
};
const glyph = (lb, name) => { const est = Math.max(6, name.length * 6); const w = Math.min(est, 90); const lines = Math.max(1, Math.ceil(est / 90)); return { x: lb.x + lb.width / 2 - w / 2, y: lb.y, width: w, height: lines * 14 }; };
const idOf = (el) => el && el.id;

const KEYS = ['crossings', 'overlaps', 'through', 'diagonal', 'missing', 'labelClash', 'labelOnLine', 'inOut', 'parallelRun', 'outsideLane', 'outsidePool', 'outsideSub', 'edgeLeavesLane', 'edgeOutside', 'msgThroughPool', 'laneGap', 'failed'];
const WEIGHTS = { crossings: 5, overlaps: 10, through: 8, diagonal: 3, missing: 10, labelClash: 2, labelOnLine: 1, inOut: 3, parallelRun: 1, outsideLane: 6, outsidePool: 8, outsideSub: 8, edgeLeavesLane: 1, edgeOutside: 4, msgThroughPool: 5, laneGap: 2, failed: 50 };

async function analyse(xml) {
  const { rootElement: defs, warnings } = await moddle.fromXML(xml);
  const r = Object.fromEntries(KEYS.map((k) => [k, []]));
  if (warnings.length) r.failed.push(`import warnings: ${warnings.length}`);
  const parentOf = new Map(), laneOf = new Map(), partOfProc = new Map();
  const need = new Set();
  const walk = (scope) => {
    for (const fe of scope.flowElements || []) {
      parentOf.set(fe.id, scope);
      if (is(fe, 'bpmn:FlowNode') || is(fe, 'bpmn:SequenceFlow') || is(fe, 'bpmn:DataObjectReference') || is(fe, 'bpmn:DataStoreReference')) need.add(fe.id);
      if (is(fe, 'bpmn:SubProcess')) walk(fe);
      for (const da of [...(fe.dataInputAssociations || []), ...(fe.dataOutputAssociations || [])]) need.add(da.id);
    }
    for (const a of scope.artifacts || []) { parentOf.set(a.id, scope); if (is(a, 'bpmn:TextAnnotation') || is(a, 'bpmn:Association')) need.add(a.id); }
    const lanes = (ls) => { for (const l of ls || []) { for (const n of l.flowNodeRef || []) laneOf.set(n.id, l); if (l.childLaneSet) lanes(l.childLaneSet.lanes); } };
    for (const ls of scope.laneSets || []) lanes(ls.lanes);
  };
  for (const root of defs.rootElements || []) {
    if (is(root, 'bpmn:Process')) walk(root);
    if (is(root, 'bpmn:Collaboration')) {
      for (const p of root.participants || []) { need.add(p.id); if (p.processRef) partOfProc.set(p.processRef.id, p); }
      for (const m of root.messageFlows || []) need.add(m.id);
    }
  }
  // only the laid-out root needs DI: further root processes are a documented limitation
  const collab = (defs.rootElements || []).find((e) => is(e, 'bpmn:Collaboration'));
  const laidProcesses = collab
    ? new Set((collab.participants || []).map((p) => p.processRef?.id).filter(Boolean))
    : new Set([(defs.rootElements || []).find((e) => is(e, 'bpmn:Process'))?.id].filter(Boolean));
  for (const id of [...need]) {
    let scope = parentOf.get(id);
    while (scope && !is(scope, 'bpmn:Process')) scope = scope.$parent;
    if (scope && !laidProcesses.has(scope.id)) need.delete(id);
  }
  const seen = new Set();
  for (const diagram of defs.diagrams || []) {
    const plane = diagram.plane;
    const shapes = [], edges = [];
    for (const pe of plane.planeElement || []) {
      const el = pe.bpmnElement; if (!el) continue;
      seen.add(el.id);
      const lb = pe.label?.bounds ? { x: pe.label.bounds.x, y: pe.label.bounds.y, width: pe.label.bounds.width, height: pe.label.bounds.height } : undefined;
      if (is(pe, 'bpmndi:BPMNShape')) {
        const b = { x: pe.bounds.x, y: pe.bounds.y, width: pe.bounds.width, height: pe.bounds.height };
        const container = (is(el, 'bpmn:SubProcess') && pe.isExpanded) || is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane');
        shapes.push({ id: el.id, el, b, container, expanded: !!pe.isExpanded, label: lb });
      } else {
        const ends = new Set([idOf(el.sourceRef), idOf(el.targetRef)]);
        if (Array.isArray(el.sourceRef)) for (const s of el.sourceRef) ends.add(s.id);
        if (el.$parent && is(el.$parent, 'bpmn:FlowNode')) ends.add(el.$parent.id);
        edges.push({ id: el.id, el, pts: pe.waypoint.map((w) => ({ x: w.x, y: w.y })), ends, label: lb });
      }
    }
    const box = new Map(shapes.map((s) => [s.id, s]));
    const leaf = shapes.filter((s) => !s.container);
    const att = (el) => el.attachedToRef?.id;
    for (let i = 0; i < leaf.length; i++) for (let j = i + 1; j < leaf.length; j++) {
      const a = leaf[i], b = leaf[j];
      if ((is(a.el, 'bpmn:BoundaryEvent') && att(a.el) === b.id) || (is(b.el, 'bpmn:BoundaryEvent') && att(b.el) === a.id)) continue;
      if (overlap(a.b, b.b)) r.overlaps.push(`${a.id}~${b.id}`);
    }
    for (const e of edges) {
      const flow = is(e.el, 'bpmn:SequenceFlow') || is(e.el, 'bpmn:MessageFlow');
      for (const s of segs(e.pts)) {
        if (flow && s[0].x !== s[1].x && s[0].y !== s[1].y) r.diagonal.push(e.id);
        for (const sh of leaf) {
          if (e.ends.has(sh.id)) continue;
          if (is(sh.el, 'bpmn:BoundaryEvent') && e.ends.has(att(sh.el))) continue;
          if (cuts(s, sh.b)) r.through.push(`${e.id}->${sh.id}`);
        }
      }
    }
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
      const A = segs(edges[i].pts), B = segs(edges[j].pts);
      if (A.some((a) => B.some((b) => cross(a, b)))) r.crossings.push(`${edges[i].id}x${edges[j].id}`);
      const related = [...edges[i].ends].some((x) => edges[j].ends.has(x));
      if (!related) { let len = 0; for (const a of A) for (const b of B) len += Math.max(0, collinear(a, b)); if (len > 20) r.parallelRun.push(`${edges[i].id}=${edges[j].id}(${len})`); }
    }
    const labels = [];
    for (const s of shapes) if (s.label) labels.push({ owner: s.id, box: s.label, text: glyph(s.label, s.el.name || '') });
    for (const e of edges) if (e.label) labels.push({ owner: e.id, box: e.label, text: glyph(e.label, e.el.name || '') });
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      for (const s of leaf) if (s.id !== l.owner && overlap(l.box, s.b)) r.labelClash.push(`${l.owner}#L~${s.id}`);
      for (let j = i + 1; j < labels.length; j++) if (overlap(l.box, labels[j].box)) r.labelClash.push(`${l.owner}#L~${labels[j].owner}#L`);
      for (const e of edges) if (segs(e.pts).some((s) => hits(s, l.text, 0))) r.labelOnLine.push(`${l.owner}#L~${e.id}`);
    }
    const flows = edges.filter((e) => is(e.el, 'bpmn:SequenceFlow'));
    for (const s of shapes) {
      const into = flows.filter((e) => idOf(e.el.targetRef) === s.id), outOf = flows.filter((e) => idOf(e.el.sourceRef) === s.id);
      for (const i of into) for (const o of outOf) if (i !== o && segs(i.pts).some((a) => segs(o.pts).some((b) => collinear(a, b) > 0))) r.inOut.push(`${i.id}|${o.id}@${s.id}`);
    }
    for (const s of shapes) {
      if (is(s.el, 'bpmn:Participant') || is(s.el, 'bpmn:Lane')) continue;
      const parent = parentOf.get(s.id);
      if (parent && is(parent, 'bpmn:SubProcess') && box.get(parent.id)?.expanded && !inside(s.b, box.get(parent.id).b)) r.outsideSub.push(s.id);
      const lane = laneOf.get(s.id);
      if (lane && box.has(lane.id) && !is(s.el, 'bpmn:BoundaryEvent') && !inside(s.b, box.get(lane.id).b)) r.outsideLane.push(s.id);
      if (parent && is(parent, 'bpmn:Process') && partOfProc.has(parent.id)) { const pb = box.get(partOfProc.get(parent.id).id); if (pb && !inside(s.b, pb.b)) r.outsidePool.push(s.id); }
    }
    const pools = shapes.filter((s) => is(s.el, 'bpmn:Participant'));
    for (const p of pools) {
      const proc = p.el.processRef; if (!proc) continue;
      for (const ls of proc.laneSets || []) {
        const top = ls.lanes || []; if (!top.length) continue;
        const first = box.get(top[0].id), last = box.get(top[top.length - 1].id);
        if (first && Math.abs(first.b.y - p.b.y) > 1) r.laneGap.push(`${top[0].id}:top`);
        if (last && Math.abs(last.b.y + last.b.height - (p.b.y + p.b.height)) > 1) r.laneGap.push(`${top[top.length - 1].id}:bottom`);
      }
    }
    for (const e of edges) {
      if (is(e.el, 'bpmn:SequenceFlow')) {
        const parent = parentOf.get(e.id);
        let cont;
        if (parent && is(parent, 'bpmn:SubProcess')) cont = box.get(parent.id)?.expanded ? box.get(parent.id).b : undefined;
        else if (parent && partOfProc.has(parent.id)) cont = box.get(partOfProc.get(parent.id).id)?.b;
        if (cont && e.pts.some((p) => !ptIn(p, cont))) r.edgeOutside.push(e.id);
        const sl = laneOf.get(idOf(e.el.sourceRef)), tl = laneOf.get(idOf(e.el.targetRef));
        if (sl && sl === tl && box.has(sl.id) && e.pts.some((p) => !ptIn(p, box.get(sl.id).b))) r.edgeLeavesLane.push(e.id);
      }
      if (is(e.el, 'bpmn:MessageFlow')) {
        const ends = new Set([idOf(e.el.sourceRef), idOf(e.el.targetRef)]);
        for (const id of [...ends]) { let pr = parentOf.get(id); while (pr && !is(pr, 'bpmn:Process')) pr = pr.$parent; if (pr && partOfProc.has(pr.id)) ends.add(partOfProc.get(pr.id).id); }
        for (const s of segs(e.pts)) for (const p of pools) if (!ends.has(p.id) && hits(s, p.b)) r.msgThroughPool.push(`${e.id}->${p.id}`);
      }
    }
  }
  for (const id of need) if (!seen.has(id)) r.missing.push(id);
  for (const k of KEYS) r[k] = [...new Set(r[k])];
  return r;
}

const results = {};
const totals = Object.fromEntries(KEYS.map((k) => [k, 0]));
let score = 0;
for (const { key, src } of sources) {
  const work = join(WORK, key);
  copyFileSync(src, work);
  const run = spawnSync(process.execPath, [BIN, 'layout', work, '--force'], { encoding: 'utf8', timeout: 15000 });
  let r;
  if (run.status !== 0) {
    r = Object.fromEntries(KEYS.map((k) => [k, []]));
    r.failed.push((run.stderr || run.error?.message || 'failed').split('\n')[0]);
  } else {
    r = await analyse(readFileSync(work, 'utf8'));
  }
  results[key] = r;
  let fileScore = 0;
  for (const k of KEYS) { totals[k] += r[k].length; fileScore += r[k].length * WEIGHTS[k]; }
  r.score = fileScore;
  score += fileScore;
  const bad = KEYS.filter((k) => r[k].length);
  if (verbose || bad.length) {
    console.log(`${key.padEnd(56)} score=${String(fileScore).padStart(4)} ${bad.map((k) => `${k}=${r[k].length}`).join(' ')}`);
    if (verbose) for (const k of bad) console.log(`     ${k}: ${r[k].slice(0, 8).join(', ')}${r[k].length > 8 ? ' ...' : ''}`);
  }
}
console.log(`\nFILES ${sources.length}  SCORE ${score}`);
console.log(KEYS.map((k) => `${k}=${totals[k]}`).join('  '));
if (save) writeFileSync(save, JSON.stringify(results, null, 1));
if (compare && existsSync(compare)) {
  const base = JSON.parse(readFileSync(compare, 'utf8'));
  const worse = [], better = [];
  for (const [k, r] of Object.entries(results)) {
    const b = base[k];
    if (!b) continue;
    if (r.score > b.score) worse.push(`${k}: ${b.score} -> ${r.score}`);
    if (r.score < b.score) better.push(`${k}: ${b.score} -> ${r.score}`);
  }
  console.log(`\nBETTER (${better.length})`);
  for (const line of better) console.log(`  ${line}`);
  console.log(`WORSE (${worse.length})`);
  for (const line of worse) console.log(`  ${line}`);
}
if (!keep) rmSync(WORK, { recursive: true, force: true });
else console.log(`\nlaid-out files kept in ${WORK} (render them to look at the result)`);
