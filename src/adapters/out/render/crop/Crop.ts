import { cx, cy } from '../../../../domain/diagram/utils/geom.js';
import type { Plane } from '../../../../domain/diagram/di/types.js';
import type { Semantics } from '../../../../domain/diagram/di/Semantics.js';
import type { Doc } from '../../../../domain/document/Doc.js';
import { is } from '../../../../domain/document/utils/moddle.js';
import { AroundWindow } from '../../../../domain/views/AroundWindow.js';
import { ElementSelector } from '../../../../domain/diagram/commands/ElementSelector.js';
import { modelError, usageError } from '../../../../domain/document/utils/errors.js';
import type { RenderOptions } from '../../../../application/port/in/RenderSvgUseCase.js';
import { planeOfId } from './planes.js';

/** The crop the options ask for and the plane it implies. */
export interface CropChoice {
  crop?: Crop;
  plane?: string;
  scope?: string;
}

export class Crop {
  constructor(
    readonly ids: string[],
    readonly nodes: string[],
    readonly artifacts: boolean,
    readonly frame?: string,
  ) {}

  static of(doc: Doc, sem: Semantics, planes: Plane[], opts: RenderOptions): CropChoice {
    const asked = (['around', 'path', 'scope', 'ids'] as const).filter((cropKind) => (cropKind === 'ids' ? !!opts.ids?.length : opts[cropKind] !== undefined));
    if (asked.length > 1) {
      throw usageError(`${asked.map((cropKind) => (cropKind === 'ids' ? 'element ids' : `--${cropKind}`)).join(' and ')} crop the image in different ways; use one`, { hint: 'Render one part per call: `bpmn render <file> --around <id>`, `--path <from> <to>`, `--scope <id>` or ids.' });
    }
    if (asked.length && opts.focus?.length) throw usageError('focus does not go with a crop', { hint: 'Use one: a crop (around, path, scope, ids) or focus.' });
    const kind = asked[0];
    if (!kind) return {};
    const first = (ids: string[]): string | undefined => ids.find((id) => planeOfId(planes, id));
    let crop: Crop;
    if (kind === 'around') {
      const view = new AroundWindow(doc, opts.around!.id, { ...(opts.around!.depth !== undefined ? { depth: opts.around!.depth } : {}), inner: !!opts.around!.inner }).view();
      const nodes = view.nodes.map((node) => node.id);
      crop = new Crop(nodes, nodes, true);
      const seed = planeOfId(planes, opts.around!.id) ? opts.around!.id : first(nodes);
      return { crop, ...Crop.planeHint(planes, seed, nodes, `--around ${opts.around!.id}`) };
    }
    if (kind === 'path') {
      const els = new ElementSelector(doc).path(opts.path!.from, opts.path!.to, opts.path!.via ?? []);
      const ids = els.map((el) => el.get<string>('id'));
      crop = new Crop(ids, els.filter((el) => is(el, 'bpmn:FlowNode')).map((el) => el.get<string>('id')), true);
      return { crop, ...Crop.planeHint(planes, first(ids), ids, `--path ${opts.path!.from} ${opts.path!.to}`) };
    }
    if (kind === 'ids') {
      const ids = opts.ids!.filter((id, index) => opts.ids!.indexOf(id) === index);
      for (const id of ids) doc.require(id);
      const isNode = (id: string): boolean => {
        const el = sem.byId.get(id);
        return !!el && is(el, 'bpmn:FlowNode');
      };
      crop = new Crop(ids, ids.filter(isNode), false);
      return { crop, ...Crop.planeHint(planes, first(ids), ids, ids.join(', ')) };
    }
    const id = opts.scope!;
    const el = doc.require(id);
    const expandedOn = planes.find((candidate) => candidate.shapes.get(id)?.container);
    const frameCrop = (frame: string): { crop: Crop; plane?: string } => ({ crop: new Crop([frame], [], false, frame), ...Crop.planeHint(planes, frame, [frame], `--scope ${id}`) });
    if (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane')) return frameCrop(id);
    if (is(el, 'bpmn:SubProcess')) {
      if (expandedOn) return frameCrop(id);
      if (planes.some((candidate) => candidate.rootId === id)) return { plane: id, scope: id };
      throw modelError('E_NO_MATCH', `${id} is not drawn (no shape, no plane of its own)`, { element: id, hint: '`bpmn layout <file>` draws it; `bpmn render <file>` lists the planes.' });
    }
    if (is(el, 'bpmn:Process')) {
      const pool = sem.poolOfProcess.get(id);
      if (pool && planeOfId(planes, pool)) return frameCrop(pool);
      if (planes.some((candidate) => candidate.rootId === id)) return { plane: id, scope: id };
    }
    throw modelError('E_WRONG_KIND', `--scope takes a pool, lane, sub-process or process; "${id}" is a ${el.$type.replace(/^bpmn:/, '')}`, {
      element: id,
      hint: 'Use --around <id> for the neighbourhood of a node, or ids to crop to elements.',
    });
  }

  private static planeHint(planes: Plane[], seed: string | undefined, ids: string[], what: string): { plane?: string } {
    const seedPlane = seed ? planeOfId(planes, seed) : undefined;
    if (seedPlane) return { plane: seedPlane.rootId };
    throw modelError('E_NO_MATCH', `Nothing of ${what} is drawn (no shape on any plane)`, {
      ...(ids[0] ? { element: ids[0] } : {}),
      hint: '`bpmn layout <file>` draws the elements without a shape; `bpmn show <file> --layout` lists what is drawn.',
    });
  }

  /** Elements on other planes go into a note; nothing on the plane is E_NO_MATCH. */
  drawnOn(plane: Plane, planes: Plane[], notes: string[]): Set<string> {
    const drawn = new Set<string>();
    if (this.frame) {
      const frameShape = plane.shapes.get(this.frame);
      if (!frameShape) throw modelError('E_NO_MATCH', `${this.frame} is not drawn on the plane of ${plane.rootId}`, { element: this.frame, hint: 'Drop --plane, or name the plane the scope is drawn on.' });
      drawn.add(frameShape.id);
      const frameBounds = frameShape.bounds;
      for (const shape of plane.shapes.values()) {
        const centerX = cx(shape.bounds);
        const centerY = cy(shape.bounds);
        if (shape !== frameShape && centerX >= frameBounds.x && centerX <= frameBounds.x + frameBounds.width && centerY >= frameBounds.y && centerY <= frameBounds.y + frameBounds.height) drawn.add(shape.id);
      }
    } else {
      const elsewhere = new Map<string, number>();
      for (const id of this.ids) {
        if (plane.shapes.has(id) || plane.edges.has(id)) drawn.add(id);
        else {
          const other = planeOfId(planes, id);
          if (other) elsewhere.set(other.rootId, (elsewhere.get(other.rootId) ?? 0) + 1);
        }
      }
      if (!drawn.size) {
        throw modelError('E_NO_MATCH', `Nothing of the crop is drawn on the plane of ${plane.rootId}`, {
          hint: `${[...elsewhere.keys()].length ? `It is on the plane of ${[...elsewhere.keys()].join(', ')} (--plane <id>).` : 'It has no shape: `bpmn layout <file>` draws it.'}`,
        });
      }
      for (const [planeId, count] of elsewhere) notes.push(`${count} element${count > 1 ? 's' : ''} of the crop ${count > 1 ? 'are' : 'is'} on the plane of ${planeId} (--plane ${planeId})`);
      if (this.artifacts) {
        for (const edge of plane.edges.values()) {
          if (edge.kind !== 'association' && edge.kind !== 'dataAssociation') continue;
          for (const [here, there] of [
            [edge.sourceId, edge.targetId],
            [edge.targetId, edge.sourceId],
          ]) {
            const artifact = there ? plane.shapes.get(there) : undefined;
            if (here && drawn.has(here) && artifact && (artifact.kind === 'data' || artifact.kind === 'annotation')) drawn.add(artifact.id);
          }
        }
      }
    }
    for (const edge of plane.edges.values()) if (edge.sourceId && edge.targetId && drawn.has(edge.sourceId) && drawn.has(edge.targetId)) drawn.add(edge.id);
    return drawn;
  }
}
