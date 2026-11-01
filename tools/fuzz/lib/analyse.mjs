import { BpmnModdle } from 'bpmn-moddle';

const isA = (el, type) => !!el && typeof el.$instanceOf === 'function' && el.$instanceOf(type);
const fin = (value) => typeof value === 'number' && Number.isFinite(value);
const boxOf = (bounds) => (bounds ? { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height } : undefined);

function emptySemantics() {
  return { byId: new Map(), nodes: [], flows: [], lanes: [], participants: [], processes: [], collab: undefined, scopeOf: new Map(), laneOf: new Map(), needsDi: [], msgFlows: [] };
}

function readSemantics(defs) {
  const sem = emptySemantics();
  const reg = (el, scope) => {
    if (el.id) {
      sem.byId.set(el.id, el);
    }
    if (scope) {
      sem.scopeOf.set(el.id, scope);
    }
  };
  const walkScope = (container, scope) => {
    for (const fe of container.flowElements ?? []) {
      reg(fe, scope);
      if (isA(fe, 'bpmn:SequenceFlow')) {
        sem.flows.push(fe);
        sem.needsDi.push(fe);
      } else if (isA(fe, 'bpmn:FlowNode')) {
        sem.nodes.push(fe);
        sem.needsDi.push(fe);
        for (const da of [...(fe.dataInputAssociations ?? []), ...(fe.dataOutputAssociations ?? [])]) {
          if (!da.id) {
            continue;
          }
          reg(da, scope);
          sem.needsDi.push(da);
        }
        if (isA(fe, 'bpmn:SubProcess')) {
          walkScope(fe, fe);
        }
      } else if (isA(fe, 'bpmn:DataObjectReference') || isA(fe, 'bpmn:DataStoreReference')) {
        sem.needsDi.push(fe);
      }
    }
    for (const artifact of container.artifacts ?? []) {
      reg(artifact, scope);
      if (!isA(artifact, 'bpmn:Group')) {
        sem.needsDi.push(artifact);
      }
    }
  };
  const walkLanes = (laneSets, proc) => {
    for (const ls of laneSets ?? []) {
      for (const lane of ls.lanes ?? []) {
        reg(lane);
        sem.lanes.push({ id: lane.id, processId: proc.id, el: lane, hasChildren: !!lane.childLaneSet?.lanes?.length });
        sem.needsDi.push(lane);
        for (const ref of lane.flowNodeRef ?? []) {
          if (ref?.id) {
            sem.laneOf.set(ref.id, lane.id);
          }
        }
        if (lane.childLaneSet) {
          walkLanes([lane.childLaneSet], proc);
        }
      }
    }
  };
  for (const re of defs.rootElements ?? []) {
    reg(re);
    if (isA(re, 'bpmn:Collaboration')) {
      sem.collab = re;
      for (const participant of re.participants ?? []) {
        reg(participant, re);
        sem.participants.push({ id: participant.id, processId: participant.processRef?.id, el: participant });
        sem.needsDi.push(participant);
      }
      for (const messageFlow of re.messageFlows ?? []) {
        reg(messageFlow, re);
        sem.msgFlows.push(messageFlow);
        sem.needsDi.push(messageFlow);
      }
      for (const artifact of re.artifacts ?? []) {
        reg(artifact, re);
        if (!isA(artifact, 'bpmn:Group')) {
          sem.needsDi.push(artifact);
        }
      }
    } else if (isA(re, 'bpmn:Process')) {
      sem.processes.push(re);
      walkScope(re, re);
      walkLanes(re.laneSets, re);
    }
  }
  return sem;
}

function readPlane(plane) {
  const planeDi = { id: plane.id, rootId: plane.bpmnElement?.id, shapes: new Map(), edges: new Map(), dupes: [], dangling: [] };
  for (const pe of plane.planeElement ?? []) {
    const eid = pe.bpmnElement?.id;
    if (!eid) {
      planeDi.dangling.push(pe.id);
      continue;
    }
    if (planeDi.shapes.has(eid) || planeDi.edges.has(eid)) {
      planeDi.dupes.push(eid);
    }
    const label = boxOf(pe.label?.bounds);
    if (isA(pe, 'bpmndi:BPMNShape')) {
      const bounds = pe.bounds;
      planeDi.shapes.set(eid, { id: eid, x: bounds?.x, y: bounds?.y, w: bounds?.width, h: bounds?.height, expanded: pe.isExpanded, label });
    } else if (isA(pe, 'bpmndi:BPMNEdge')) {
      planeDi.edges.set(eid, { id: eid, pts: (pe.waypoint ?? []).map((waypoint) => ({ x: waypoint.x, y: waypoint.y })), label });
    }
  }
  return planeDi;
}

export async function analyse(xml) {
  let defs, warnings;
  try {
    const parsed = await new BpmnModdle().fromXML(xml);
    defs = parsed.rootElement;
    warnings = parsed.warnings.map((warning) => String(warning.message));
  } catch (error) {
    return { parseError: String(error).slice(0, 500) };
  }
  const planes = (defs.diagrams ?? []).map((diagram) => diagram.plane).filter(Boolean).map(readPlane);
  return { defs, warnings, sem: readSemantics(defs), planes };
}

function homePlane(analysis, el) {
  const { sem, planes } = analysis;
  const collabPlane = () => (sem.collab ? planes.find((plane) => plane.rootId === sem.collab.id) : undefined);
  const pooled = new Set(sem.participants.map((participant) => participant.processId).filter(Boolean));
  if (isA(el, 'bpmn:Participant') || isA(el, 'bpmn:MessageFlow')) {
    return collabPlane();
  }
  if (isA(el, 'bpmn:Lane')) {
    const pid = sem.lanes.find((lane) => lane.id === el.id)?.processId;
    return planes.find((plane) => plane.rootId === pid) ?? (pid && pooled.has(pid) ? collabPlane() : undefined);
  }
  const anchorId = isA(el, 'bpmn:DataAssociation') ? el.$parent?.id : el.id;
  const scope = anchorId ? sem.scopeOf.get(anchorId) : undefined;
  if (!scope) {
    return undefined;
  }
  if (isA(scope, 'bpmn:Collaboration')) {
    return collabPlane();
  }
  if (isA(scope, 'bpmn:SubProcess')) {
    return planes.find((plane) => plane.shapes.get(scope.id)?.expanded) ?? planes.find((plane) => plane.rootId === scope.id);
  }
  return planes.find((plane) => plane.rootId === scope.id) ?? (pooled.has(scope.id) ? collabPlane() : undefined);
}

function geometryProblems(plane) {
  const out = [];
  for (const dupeId of plane.dupes) {
    out.push(`dupDi|${plane.rootId}|${dupeId}`);
  }
  for (const danglingId of plane.dangling) {
    out.push(`danglingDi|${plane.rootId}|${danglingId}`);
  }
  for (const shape of plane.shapes.values()) {
    if (![shape.x, shape.y, shape.w, shape.h].every(fin)) {
      out.push(`nanBounds|${shape.id}`);
    } else if (shape.w <= 0 || shape.h <= 0) {
      out.push(`nonPositiveSize|${shape.id}`);
    }
    if (shape.label && ![shape.label.x, shape.label.y, shape.label.w, shape.label.h].every(fin)) {
      out.push(`nanLabel|${shape.id}`);
    }
    if (shape.label && (shape.label.w < 0 || shape.label.h < 0)) {
      out.push(`negLabel|${shape.id}`);
    }
  }
  for (const edge of plane.edges.values()) {
    if (edge.pts.length < 2) {
      out.push(`fewWaypoints|${edge.id}`);
    }
    if (!edge.pts.every((point) => fin(point.x) && fin(point.y))) {
      out.push(`nanWaypoint|${edge.id}`);
    }
    if (edge.label && ![edge.label.x, edge.label.y, edge.label.w, edge.label.h].every(fin)) {
      out.push(`nanLabel|${edge.id}`);
    }
  }
  return out;
}

function placementProblems(analysis) {
  const out = [];
  for (const el of analysis.sem.needsDi) {
    const home = homePlane(analysis, el);
    const on = analysis.planes.filter((plane) => plane.shapes.has(el.id) || plane.edges.has(el.id));
    if (!on.length) {
      out.push(`noDi|${el.id}`);
    } else if (home && !on.includes(home)) {
      out.push(`wrongPlane|${el.id}|on ${on.map((plane) => plane.rootId).join(',')} expected ${home.rootId}`);
    }
  }
  return out;
}

function scopeChain(analysis, id) {
  const out = new Set();
  let scope = analysis.sem.scopeOf.get(id);
  for (let depth = 0; scope && depth < 30; depth++) {
    out.add(scope.id);
    scope = analysis.sem.scopeOf.get(scope.id);
  }
  return out;
}

const overlapsInner = (first, second) => first.x < second.x + second.w - 2 && second.x < first.x + first.w - 2 && first.y < second.y + second.h - 2 && second.y < first.y + first.h - 2;
const isLeaf = (el) => isA(el, 'bpmn:FlowNode') || isA(el, 'bpmn:DataObjectReference') || isA(el, 'bpmn:DataStoreReference') || isA(el, 'bpmn:TextAnnotation');

function framesAndLeaves(analysis, plane) {
  const frames = [], leaves = [];
  for (const shape of plane.shapes.values()) {
    const el = analysis.sem.byId.get(shape.id);
    if (!el || ![shape.x, shape.y, shape.w, shape.h].every(fin)) {
      continue;
    }
    if (isA(el, 'bpmn:SubProcess') && shape.expanded) {
      frames.push({ s: shape, el, kind: 'sub' });
    } else if (isA(el, 'bpmn:Participant')) {
      frames.push({ s: shape, el, kind: 'pool' });
    }
    if (isLeaf(el)) {
      leaves.push({ s: shape, el });
    }
  }
  return { frames, leaves };
}

function intrudes(analysis, frame, leaf) {
  if (leaf.el === frame.el || !overlapsInner(frame.s, leaf.s)) {
    return false;
  }
  if (scopeChain(analysis, frame.el.id).has(leaf.el.id)) {
    return false;
  }
  if (frame.kind === 'sub') {
    if (isA(leaf.el, 'bpmn:TextAnnotation')) {
      return false;
    }
    const host = leaf.el.attachedToRef?.id;
    if (host === frame.el.id) {
      return false;
    }
    return !scopeChain(analysis, host ?? leaf.el.id).has(frame.el.id);
  }
  const proc = frame.el.processRef?.id;
  if (proc && scopeChain(analysis, leaf.el.id).has(proc)) {
    return false;
  }
  return !(isA(leaf.el, 'bpmn:TextAnnotation') && isA(analysis.sem.scopeOf.get(leaf.el.id), 'bpmn:Collaboration'));
}

function frameProblems(analysis) {
  const out = [];
  for (const plane of analysis.planes) {
    const { frames, leaves } = framesAndLeaves(analysis, plane);
    for (const frame of frames) {
      for (const leaf of leaves) {
        if (intrudes(analysis, frame, leaf)) {
          out.push(`${frame.kind === 'sub' ? 'frameIntrusion' : 'poolIntrusion'}|${frame.el.id}|${leaf.el.id}`);
        }
      }
    }
    for (let index = 0; index < frames.length; index++) {
      for (let otherIndex = index + 1; otherIndex < frames.length; otherIndex++) {
        const [frame, otherFrame] = [frames[index], frames[otherIndex]];
        if (frame.kind !== otherFrame.kind || !overlapsInner(frame.s, otherFrame.s)) {
          continue;
        }
        if (frame.kind === 'sub' && (scopeChain(analysis, frame.el.id).has(otherFrame.el.id) || scopeChain(analysis, otherFrame.el.id).has(frame.el.id))) {
          continue;
        }
        out.push(`frameOverlap|${frame.el.id}|${otherFrame.el.id}`);
      }
    }
  }
  return out;
}

function staleProblems(analysis) {
  const out = [];
  const roots = new Set((analysis.defs.rootElements ?? []).map((root) => root.id));
  for (const plane of analysis.planes) {
    for (const id of [...plane.shapes.keys(), ...plane.edges.keys()]) {
      if (!analysis.sem.byId.has(id) && !roots.has(id)) {
        out.push(`staleDi|${plane.rootId}|${id}`);
      }
    }
  }
  return out;
}

export function diInvariants(analysis) {
  if (analysis.parseError) {
    return [`parse|${analysis.parseError}`];
  }
  const out = analysis.warnings.filter((warning) => !/unknown attribute/i.test(warning)).map((warning) => `reimport|${warning.split('\n')[0].slice(0, 160)}`);
  for (const plane of analysis.planes) {
    out.push(...geometryProblems(plane));
  }
  out.push(...placementProblems(analysis), ...frameProblems(analysis), ...staleProblems(analysis));
  return out;
}

export function bbox(analysis) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const plane of analysis.planes ?? []) {
    for (const shape of plane.shapes.values()) {
      if (![shape.x, shape.y, shape.w, shape.h].every(fin)) {
        continue;
      }
      x1 = Math.min(x1, shape.x);
      y1 = Math.min(y1, shape.y);
      x2 = Math.max(x2, shape.x + shape.w);
      y2 = Math.max(y2, shape.y + shape.h);
    }
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

export function geometry(analysis) {
  const shapes = new Map(), edges = new Map();
  for (const plane of analysis.planes ?? []) {
    for (const shape of plane.shapes.values()) {
      shapes.set(`${plane.rootId}|${shape.id}`, shape);
    }
    for (const edge of plane.edges.values()) {
      edges.set(`${plane.rootId}|${edge.id}`, edge);
    }
  }
  return { shapes, edges };
}

const sameBox = (first, second) => Object.is(first.x, second.x) && Object.is(first.y, second.y) && Object.is(first.w, second.w) && Object.is(first.h, second.h);
const samePts = (firstPoints, secondPoints) => firstPoints.length === secondPoints.length && firstPoints.every((point, index) => point.x === secondPoints[index].x && point.y === secondPoints[index].y);

function shiftedUniformly(beforePoints, afterPoints) {
  if (beforePoints.length !== afterPoints.length || !beforePoints.length) {
    return false;
  }
  const dxs = new Set(), dys = new Set();
  for (let index = 0; index < beforePoints.length; index++) {
    const dx = afterPoints[index].x - beforePoints[index].x, dy = afterPoints[index].y - beforePoints[index].y;
    if (dx) {
      dxs.add(dx);
    }
    if (dy) {
      dys.add(dy);
    }
  }
  return dxs.size <= 1 && dys.size <= 1;
}

export function stability(before, after, reported) {
  const unreportedShapes = [], unreportedEdges = [];
  let moved = 0, kept = 0;
  for (const [key, shape] of before.shapes) {
    const afterShape = after.shapes.get(key);
    if (!afterShape) {
      continue;
    }
    if (sameBox(shape, afterShape)) {
      kept++;
      continue;
    }
    moved++;
    if (!reported.has(shape.id)) {
      unreportedShapes.push({ id: shape.id, from: [shape.x, shape.y, shape.w, shape.h], to: [afterShape.x, afterShape.y, afterShape.w, afterShape.h] });
    }
  }
  for (const [key, edge] of before.edges) {
    const afterEdge = after.edges.get(key);
    if (!afterEdge || samePts(edge.pts, afterEdge.pts) || reported.has(edge.id) || shiftedUniformly(edge.pts, afterEdge.pts)) {
      continue;
    }
    unreportedEdges.push({ id: edge.id, from: edge.pts.map((point) => `${point.x},${point.y}`).join(' '), to: afterEdge.pts.map((point) => `${point.x},${point.y}`).join(' ') });
  }
  return { unreportedShapes, unreportedEdges, moved, kept };
}

export function reportedIds(format) {
  const reported = new Set();
  for (const formatEntry of format) {
    for (const key of ['moved', 'rerouted', 'reshaped', 'colored', 'labels']) {
      for (const id of formatEntry[key] ?? []) {
        reported.add(id);
      }
    }
  }
  return reported;
}
