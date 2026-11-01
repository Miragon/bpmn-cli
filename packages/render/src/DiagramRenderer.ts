import { type Badge, SvgComposer } from './compose/index.js';
import { Scene } from './paint/index.js';
import { BpmnNode, DiagramReader, type Plane, PlaneCheck, RenderError, type SanePlane } from './read/index.js';

export type DiagramNoteKind = 'no-diagram' | 'undrawn' | 'broken-coordinates' | 'broken-labels' | 'empty-plane' | 'fit-on-other-plane' | 'fit-not-drawn';

export interface DiagramNote {
  kind: DiagramNoteKind;
  ids: string[];
}

export interface SvgOptions {
  plane?: string;
  fit?: readonly string[];
  badges?: readonly Badge[];
  scale?: number;
  maxSize?: number;
}

export interface SvgImage {
  svg: string;
  width: number;
  height: number;
  scale: number;
  plane: string | undefined;
  drawn: string[];
  notes: DiagramNote[];
  badges: number[];
}

export class DiagramRenderer {
  private readonly read: Plane[];
  private readonly checked: SanePlane[];
  private readonly check: PlaneCheck;

  private constructor(private readonly reader: DiagramReader) {
    this.read = reader.planes();
    this.check = new PlaneCheck(reader.semantics, this.read);
    this.checked = this.read.map((plane) => this.check.sane(plane));
  }

  static async fromXml(xml: string): Promise<DiagramRenderer> {
    return new DiagramRenderer(await DiagramReader.fromXml(xml));
  }

  static fromDefinitions(definitions: object): DiagramRenderer {
    return new DiagramRenderer(new DiagramReader(BpmnNode.of(definitions) as BpmnNode));
  }

  get planes(): string[] {
    return this.read.map((plane) => plane.rootId);
  }

  svg(options: SvgOptions = {}): SvgImage {
    const fit = options.fit?.length ? [...new Set(options.fit)] : undefined;
    const rootId = options.plane ?? this.planeOfFit(fit);
    const index = rootId === undefined ? 0 : this.indexOfPlane(rootId);
    const unchecked = this.read[index];
    const sane = this.checked[index];
    if (!unchecked || !sane) {
      return { ...new SvgComposer([], undefined, options).composition(), plane: undefined, drawn: [], notes: [{ kind: 'no-diagram', ids: [] }] };
    }
    const notes = this.notesOf(unchecked, sane);
    const scene = new Scene(sane.plane, fit && this.fitOn(sane.plane, fit, notes));
    return { ...new SvgComposer(scene.items, sane.plane, options).composition(), plane: sane.plane.rootId, drawn: scene.drawnIds, notes };
  }

  private static onPlane(plane: Plane, id: string): boolean {
    return plane.shapes.has(id) || plane.edges.has(id);
  }

  private planeOfFit(fit: readonly string[] | undefined): string | undefined {
    if (!fit) {
      return undefined;
    }
    const first = fit.flatMap((id) => this.read.find((plane) => DiagramRenderer.onPlane(plane, id)) ?? [])[0];
    if (!first) {
      throw new RenderError('E_NO_MATCH', `Nothing of ${fit.join(', ')} is drawn on any plane`, fit[0]);
    }
    return first.rootId;
  }

  private indexOfPlane(rootId: string): number {
    const index = this.read.findIndex((plane) => plane.rootId === rootId);
    if (index >= 0) {
      return index;
    }
    if (!this.reader.semantics.byId.has(rootId)) {
      throw new RenderError('E_NOT_FOUND', `No element with id "${rootId}"`, rootId);
    }
    throw new RenderError('E_WRONG_KIND', `${rootId} has no diagram plane of its own`, rootId);
  }

  private notesOf(unchecked: Plane, { plane, broken, labels }: SanePlane): DiagramNote[] {
    const notes: DiagramNote[] = [
      { kind: 'undrawn', ids: this.check.undrawn(unchecked) },
      { kind: 'broken-coordinates', ids: broken },
      { kind: 'broken-labels', ids: labels },
    ];
    if (!plane.shapes.size && !plane.edges.size) {
      if (unchecked.shapes.size || unchecked.edges.size) {
        throw new RenderError('E_RENDER', `Nothing on the plane of ${plane.rootId} can be drawn: every shape and connection has broken coordinates`, plane.rootId);
      }
      notes.push({ kind: 'empty-plane', ids: [plane.rootId] });
    }
    return notes.filter((note) => note.ids.length);
  }

  private fitOn(plane: Plane, fit: readonly string[], notes: DiagramNote[]): Set<string> {
    const drawn = new Set(fit.filter((id) => DiagramRenderer.onPlane(plane, id)));
    if (!drawn.size) {
      throw new RenderError('E_NO_MATCH', `Nothing of ${fit.join(', ')} is drawn on the plane of ${plane.rootId}`, plane.rootId);
    }
    const left = fit.filter((id) => !drawn.has(id));
    const elsewhere = left.filter((id) => this.read.some((other) => DiagramRenderer.onPlane(other, id)));
    const nowhere = left.filter((id) => !elsewhere.includes(id));
    notes.push(...(elsewhere.length ? [{ kind: 'fit-on-other-plane' as const, ids: elsewhere }] : []), ...(nowhere.length ? [{ kind: 'fit-not-drawn' as const, ids: nowhere }] : []));
    for (const edge of plane.edges.values()) {
      if (edge.sourceId && edge.targetId && drawn.has(edge.sourceId) && drawn.has(edge.targetId)) {
        drawn.add(edge.id);
      }
    }
    return drawn;
  }
}
