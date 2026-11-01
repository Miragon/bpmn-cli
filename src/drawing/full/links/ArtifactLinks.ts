import { Box, type BpmnElement } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import { GNode, type GArtifact, type GArtifactKind, type GEdge, type LinkEnd, type ScopeLayout } from '../scopes/GNode.js';

type End = GNode | GArtifact | LinkEnd;

export class ArtifactLinks {
  private readonly artifacts: GArtifact[] = [];
  private readonly byId = new Map<string, GArtifact>();
  private readonly flowEnds = new Map<GEdge, LinkEnd>();
  private readonly flowsById: Map<string, GEdge>;
  private nodes: ReadonlyMap<string, GNode> = new Map();

  constructor(private readonly layout: ScopeLayout) {
    this.flowsById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  }

  private static isArtifact(end: End | undefined): end is GArtifact {
    return !!end && 'links' in end;
  }

  private static anchorTo(artifact: GArtifact, end: End): void {
    if (!artifact.anchor) {
      artifact.anchor = end;
      if (end instanceof GNode) {
        artifact.anchorNode = end;
      }
    }
  }

  private static ownerOf(from: End | undefined, to: End | undefined): GArtifact | undefined {
    const ends = [from, to].filter(ArtifactLinks.isArtifact);
    return ends.find((artifact) => artifact.kind === 'annotation') ?? ends[0];
  }

  build(scope: BpmnElement, nodes: ReadonlyMap<string, GNode>): void {
    this.nodes = nodes;
    this.addArtifacts(scope);
    for (const element of scope.list('artifacts')) {
      if (element.is('bpmn:Association')) {
        this.linkAssociation(element);
      }
    }
    for (const node of nodes.values()) {
      for (const association of node.el.list('dataInputAssociations')) {
        this.linkData(association, association.list('sourceRef')[0], node, true);
      }
      for (const association of node.el.list('dataOutputAssociations')) {
        this.linkData(association, association.peek<BpmnElement>('targetRef'), node, false);
      }
    }
    this.layout.artifacts = this.artifacts;
  }

  private add(element: BpmnElement, kind: GArtifactKind): void {
    const size = ShapeSizes.of(element);
    const artifact: GArtifact = { el: element, id: element.id, kind, ...size, box: new Box(0, 0, size.width, size.height), links: [] };
    this.artifacts.push(artifact);
    this.byId.set(artifact.id, artifact);
  }

  private addArtifacts(scope: BpmnElement): void {
    for (const element of scope.list('flowElements')) {
      if (element.is('bpmn:DataObjectReference')) {
        this.add(element, 'dataObject');
      } else if (element.is('bpmn:DataStoreReference')) {
        this.add(element, 'dataStore');
      }
    }
    for (const element of scope.list('artifacts')) {
      if (element.is('bpmn:TextAnnotation')) {
        this.add(element, 'annotation');
      }
    }
  }

  private resolve(element: BpmnElement | undefined): End | undefined {
    if (!element) {
      return undefined;
    }
    const { id } = element;
    const found = this.nodes.get(id) ?? this.byId.get(id);
    const flow = found ? undefined : this.flowsById.get(id);
    if (!flow) {
      return found;
    }
    const end = this.flowEnds.get(flow) ?? { box: new Box(0, 0, 0, 0), flow };
    this.flowEnds.set(flow, end);
    return end;
  }

  private linkAssociation(element: BpmnElement): void {
    const source = element.peek<BpmnElement>('sourceRef');
    const target = element.peek<BpmnElement>('targetRef');
    const from = this.resolve(source);
    const to = this.resolve(target);
    const artifact = ArtifactLinks.ownerOf(from, to);
    if (from && to && artifact) {
      artifact.links.push({ el: element, id: element.id, from, to, points: [] });
      ArtifactLinks.anchorTo(artifact, artifact === from ? to : from);
    } else if (source && target && !this.layout.compensations.some((compensation) => compensation.el === element)) {
      this.layout.crossLinks.push({ el: element, id: element.id, sourceId: source.id, targetId: target.id });
    }
  }

  private linkData(association: BpmnElement, data: BpmnElement | undefined, node: GNode, input: boolean): void {
    const artifact = data && this.byId.get(data.id);
    if (artifact) {
      artifact.links.push({ el: association, id: association.id, from: input ? artifact : node, to: input ? node : artifact, points: [] });
      ArtifactLinks.anchorTo(artifact, node);
    } else if (data) {
      this.layout.crossLinks.push({ el: association, id: association.id, sourceId: input ? data.id : node.id, targetId: input ? node.id : data.id });
    }
  }
}
