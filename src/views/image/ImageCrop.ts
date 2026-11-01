import { PlaneReader, type Plane } from '../../drawing/index.js';
import { BpmnError, DiagramIndex, type BpmnDocument, type BpmnElement } from '../../model/index.js';
import { NeighbourhoodWalk } from '../around/index.js';
import { FlowPath } from './FlowPath.js';

export interface CropOptions {
  ids?: string[] | undefined;
  around?: string | undefined;
  depth?: number | undefined;
  path?: [from: string, to: string] | undefined;
}

export interface CropChoice {
  plane?: string | undefined;
  fit?: string[] | undefined;
  depth?: number | undefined;
}

export class ImageCrop {
  private readonly planes: Plane[];

  constructor(private readonly document: BpmnDocument) {
    this.planes = new PlaneReader(document.tree.definitions).planes();
  }

  private static refuseMixed({ ids, around, depth, path }: CropOptions): void {
    const asked = [...(around !== undefined ? ['--around'] : []), ...(path ? ['--path'] : []), ...(ids?.length ? ['element ids'] : [])];
    if (asked.length > 1) {
      throw BpmnError.usage(`${asked.join(' and ')} crop the image in different ways; use one`, { hint: 'Render one part per call: `bpmn render <file> --around <id>`, `--path <from> <to>` or ids.' });
    }
    if (depth !== undefined && around === undefined) {
      throw BpmnError.usage('--depth goes only with --around <id>', { hint: 'Use `bpmn render <file> --around <id> --depth <n>`.' });
    }
  }

  private static withArtifacts(plane: Plane, ids: readonly string[]): string[] {
    const fit = new Set(ids);
    const isArtifact = (id: string | undefined): id is string => ['data', 'annotation'].includes(plane.shapes.get(id ?? '')?.kind ?? '');
    for (const { kind, sourceId, targetId } of plane.edges.values()) {
      const ends = kind === 'association' || kind === 'dataAssociation' ? [[sourceId, targetId], [targetId, sourceId]] : [];
      for (const [here, there] of ends) {
        if (fit.has(here ?? '') && isArtifact(there)) {
          fit.add(there);
        }
      }
    }
    return [...fit];
  }

  private static inside(plane: Plane, frameId: string): string[] {
    const { bounds } = plane.shapes.get(frameId)!;
    const shapes = [...plane.shapes.values()].filter((shape) => shape.id !== frameId && bounds.contains(shape.bounds.center));
    return [frameId, ...shapes.map(({ id }) => id)];
  }

  of(options: CropOptions): CropChoice {
    ImageCrop.refuseMixed(options);
    const { ids, around, depth, path } = options;
    if (around !== undefined) {
      const { distances, depth: used } = new NeighbourhoodWalk(this.document).window(around, depth);
      return { ...this.withItsArtifacts([...distances.keys()].map(({ id }) => id)), depth: used };
    }
    if (path) {
      return this.withItsArtifacts(new FlowPath(this.document).between(...path).map(({ id }) => id));
    }
    return ids?.length ? this.ofIds([...new Set(ids)]) : {};
  }

  private withItsArtifacts(ids: readonly string[]): CropChoice {
    const plane = ids.flatMap((id) => this.planeWith(id) ?? [])[0];
    return { fit: plane ? ImageCrop.withArtifacts(plane, ids) : [...ids] };
  }

  private ofIds(ids: readonly string[]): CropChoice {
    const elements = ids.map((id) => this.document.tree.require(id));
    const [only] = elements;
    const ownPlane = elements.length === 1 && only ? this.ownPlane(only) : undefined;
    return ownPlane ? { plane: ownPlane } : { fit: elements.flatMap((element) => this.fitOf(element)) };
  }

  private ownPlane(element: BpmnElement): string | undefined {
    const isCollapsed = DiagramIndex.isSubProcess(element) && !this.planeWith(element.id)?.shapes.get(element.id)?.container;
    const isOwnProcess = element.is('bpmn:Process') && !this.document.flows.participantOf(element);
    return (isCollapsed || isOwnProcess) && this.planes.some(({ rootId }) => rootId === element.id) ? element.id : undefined;
  }

  private fitOf(element: BpmnElement): string[] {
    const framed = element.is('bpmn:Process') ? this.document.flows.participantOf(element) ?? element : element;
    const plane = this.planeWith(framed.id);
    return plane?.shapes.get(framed.id)?.container ? ImageCrop.inside(plane, framed.id) : [framed.id];
  }

  private planeWith(id: string): Plane | undefined {
    return this.planes.find(({ shapes, edges }) => shapes.has(id) || edges.has(id));
  }
}
