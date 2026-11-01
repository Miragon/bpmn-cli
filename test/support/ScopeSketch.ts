import { GNode, type GArtifact, type GArtifactKind, type GEdge, type GNodeKind, type ScopeLayout } from '../../src/drawing/full/scopes/GNode.js';
import { ShapeSizes } from '../../src/drawing/plane/ShapeSizes.js';
import { Box, BpmnElement, ModdleParser, Point } from '../../src/model/index.js';

interface NodeOptions {
  name?: string;
  width?: number;
  height?: number;
  layer?: number;
}

interface FlowOptions {
  name?: string;
  back?: boolean;
  bandY?: number;
}

export class ScopeSketch {
  private static readonly SIZES: Record<GNodeKind, { width: number; height: number; type: string }> = {
    start: { ...ShapeSizes.EVENT, type: 'bpmn:StartEvent' },
    end: { ...ShapeSizes.EVENT, type: 'bpmn:EndEvent' },
    event: { ...ShapeSizes.EVENT, type: 'bpmn:IntermediateCatchEvent' },
    gateway: { ...ShapeSizes.GATEWAY, type: 'bpmn:ExclusiveGateway' },
    task: { ...ShapeSizes.TASK, type: 'bpmn:Task' },
    subProcess: { ...ShapeSizes.TASK, type: 'bpmn:SubProcess' },
    eventSubProcess: { ...ShapeSizes.TASK, type: 'bpmn:SubProcess' },
  };

  private readonly moddle = ModdleParser.moddle();
  private readonly nodes = new Map<string, GNode>();
  private readonly edges: GEdge[] = [];

  static element(type: string, id: string, name?: string): BpmnElement {
    return BpmnElement.of(ModdleParser.moddle().create(type, { id, ...(name ? { name } : {}) }));
  }

  static emptyLayout(el: BpmnElement, nodes: GNode[], edges: GEdge[], width = 0, height = 0): ScopeLayout {
    return { el, nodes, edges, artifacts: [], eventSubs: [], compensations: [], width, height, lanes: [], crossLinks: [] };
  }

  static artifact(type: string, id: string, kind: GArtifactKind, size: { width: number; height: number }, name?: string): GArtifact {
    return { el: ScopeSketch.element(type, id, name), id, kind, ...size, box: new Box(0, 0, size.width, size.height), links: [] };
  }

  private created(type: string, id: string, name: string | undefined): BpmnElement {
    return BpmnElement.of(this.moddle.create(type, { id, ...(name ? { name } : {}) }));
  }

  node(kind: GNodeKind, id: string, x: number, y: number, options: NodeOptions = {}): this {
    const { width, height, type } = ScopeSketch.SIZES[kind];
    const size = { width: options.width ?? width, height: options.height ?? height };
    const node = new GNode(this.created(type, id, options.name), id, size, kind);
    node.box = new Box(x, y, size.width, size.height);
    node.layer = options.layer ?? 0;
    this.nodes.set(id, node);
    return this;
  }

  boundary(id: string, hostId: string, x: number, options: { onTop?: boolean; name?: string } = {}): this {
    const host = this.at(hostId);
    const node = new GNode(this.created('bpmn:BoundaryEvent', id, options.name), id, ShapeSizes.EVENT, 'event');
    node.box = new Box(x, (options.onTop ? host.box.y : host.box.bottom) - 18, 36, 36);
    node.host = host;
    node.onTop = options.onTop;
    host.boundary.push(node);
    this.nodes.set(id, node);
    return this;
  }

  flow(sourceId: string, targetId: string, options: FlowOptions = {}): this {
    const [source, target] = [this.at(sourceId), this.at(targetId)];
    const id = `${sourceId}_${targetId}`;
    const edge: GEdge = { el: this.created('bpmn:SequenceFlow', id, options.name), id, source, target, back: !!options.back, bandY: options.bandY, points: [] };
    source.out.push(edge);
    target.in.push(edge);
    this.edges.push(edge);
    return this;
  }

  at(id: string): GNode {
    return this.nodes.get(id)!;
  }

  edge(sourceId: string, targetId: string): GEdge {
    return this.edges.find(({ source, target }) => source.id === sourceId && target.id === targetId)!;
  }

  layout(): ScopeLayout {
    const hosts = [...this.nodes.values()].filter((node) => !node.host);
    return ScopeSketch.emptyLayout(this.created('bpmn:Process', 'sketched_process', undefined), hosts, this.edges, Math.max(...hosts.map((node) => node.box.right)), Math.max(...hosts.map((node) => node.box.bottom)));
  }

  points(sourceId: string, targetId: string): Array<[number, number]> {
    return this.edge(sourceId, targetId).points.map((point: Point) => [point.x, point.y]);
  }
}
