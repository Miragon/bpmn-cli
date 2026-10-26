/**
 * Semantic + DI facts of a BPMN file, shared by the edit generator (gen-edits.mjs) and the scorer (measure.mjs).
 *
 * Contract: `readModel(xml)` parses with plain bpmn-moddle (no vendor descriptors, like bpmn-cli) and returns
 *   { defs, warnings, lossy, nodes: Map<id, Node>, flows: Map<id, Flow>, lanes: Map<id, Lane>, shapes: Map<id, Box>,
 *     edges: Map<id, Point[]>, processes: Process[], pools }
 * where Node = { id, type, name, el, processId, scope (id of process / sub-process), laneId?, incoming: flowId[],
 * outgoing: flowId[], attachedTo? } and Box = { x, y, width, height }. Only the first DI shape per element counts.
 * Nothing here writes files.
 */
import { BpmnModdle } from 'bpmn-moddle';

const LOSSY = [/unparsable content/i, /unrecognized element/i, /unresolved reference/i, /duplicate ID/i];

export const is = (el, type) => !!el && typeof el.$instanceOf === 'function' && el.$instanceOf(type);
const short = (el) => (el.$type || '').replace(/^bpmn:/, '');

export async function readModel(xml) {
  const moddle = new BpmnModdle();
  const { rootElement: defs, warnings } = await moddle.fromXML(xml);
  const nodes = new Map();
  const flows = new Map();
  const lanes = new Map();
  const processes = [];
  const pools = [];
  const laneOf = new Map();

  const walkLanes = (ls, processId) => {
    for (const lane of ls?.lanes || []) {
      lanes.set(lane.id, { id: lane.id, name: lane.name, processId, members: (lane.flowNodeRef || []).map((node) => node.id), leaf: !lane.childLaneSet?.lanes?.length });
      for (const node of lane.flowNodeRef || []) laneOf.set(node.id, lane.id); // nested lanes overwrite: innermost wins
      if (lane.childLaneSet) walkLanes(lane.childLaneSet, processId);
    }
  };
  const walk = (scope, processId) => {
    for (const fe of scope.flowElements || []) {
      if (is(fe, 'bpmn:SequenceFlow')) {
        flows.set(fe.id, { id: fe.id, name: fe.name, sourceId: fe.sourceRef?.id, targetId: fe.targetRef?.id, scope: scope.id, el: fe, conditional: !!fe.conditionExpression });
      } else if (is(fe, 'bpmn:FlowNode')) {
        nodes.set(fe.id, { id: fe.id, type: short(fe), name: fe.name, el: fe, processId, scope: scope.id, incoming: [], outgoing: [], attachedTo: fe.attachedToRef?.id });
        if (is(fe, 'bpmn:SubProcess')) walk(fe, processId);
      }
    }
    for (const ls of scope.laneSets || []) walkLanes(ls, processId);
  };
  for (const root of defs.rootElements || []) {
    if (is(root, 'bpmn:Process')) { processes.push(root); walk(root, root.id); }
    if (is(root, 'bpmn:Collaboration')) {
      for (const participant of root.participants || []) pools.push({ id: participant.id, processId: participant.processRef?.id });
    }
  }
  for (const flow of flows.values()) {
    nodes.get(flow.sourceId)?.outgoing.push(flow.id);
    nodes.get(flow.targetId)?.incoming.push(flow.id);
  }
  for (const node of nodes.values()) node.laneId = laneOf.get(node.id);

  const shapes = new Map();
  const edges = new Map();
  for (const diagram of defs.diagrams || []) {
    for (const pe of diagram.plane?.planeElement || []) {
      const id = pe.bpmnElement?.id;
      if (!id) continue;
      if (is(pe, 'bpmndi:BPMNShape') && pe.bounds && !shapes.has(id)) shapes.set(id, { x: pe.bounds.x, y: pe.bounds.y, width: pe.bounds.width, height: pe.bounds.height, expanded: pe.isExpanded });
      if (is(pe, 'bpmndi:BPMNEdge') && !edges.has(id)) edges.set(id, (pe.waypoint || []).map((waypoint) => ({ x: waypoint.x, y: waypoint.y })));
    }
  }
  const lossy = warnings.filter((warning) => LOSSY.some((pattern) => pattern.test(warning.message))).length;
  return { defs, warnings, lossy, nodes, flows, lanes, shapes, edges, processes, pools };
}

export const centre = (bounds) => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });

/** Flow nodes that need a shape: every flow node (boundary events included). */
export function diCoverage(model) {
  let withDi = 0;
  for (const id of model.nodes.keys()) if (model.shapes.has(id)) withDi++;
  return { flowNodes: model.nodes.size, withDi, missing: model.nodes.size - withDi, ratio: model.nodes.size ? withDi / model.nodes.size : 0 };
}
