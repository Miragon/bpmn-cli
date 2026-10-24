import type { Plane } from '../diagram/types.js';
import type { Semantics } from '../diagram/Semantics.js';
import type { Doc } from '../model/Doc.js';
import { is } from '../model/utils/moddle.js';
import { AroundWindow } from '../query/AroundWindow.js';
import { ElementSelector } from '../query/ElementSelector.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import type { RenderOptions } from './types.js';
import { planeOfId } from './utils/planes.js';

/** The crop the options ask for and the plane it implies (a scope on a collapsed sub-process / a process without pool: that plane, `scope` names it). */
export interface CropChoice {
  crop?: Crop;
  plane?: string;
  scope?: string;
}

export class Crop {
  constructor(
    /** the elements (shapes and connections), in the crop's order */
    readonly ids: string[],
    /** the flow nodes among them (around: show --around's order) */
    readonly nodes: string[],
    /** draw the data and annotations attached to the elements */
    readonly artifacts: boolean,
    /** scope: the frame whose content is drawn */
    readonly frame?: string,
  ) {}

  static of(doc: Doc, sem: Semantics, planes: Plane[], opts: RenderOptions): CropChoice {
    const asked = (['around', 'path', 'scope', 'ids'] as const).filter((k) => (k === 'ids' ? !!opts.ids?.length : opts[k] !== undefined));
    if (asked.length > 1) {
      throw usageError(`${asked.map((k) => (k === 'ids' ? 'element ids' : `--${k}`)).join(' and ')} crop the image in different ways; use one`, { hint: 'Render one part per call: `bpmn render <file> --around <id>`, `--path <from> <to>`, `--scope <id>` or ids.' });
    }
    if (asked.length && opts.focus?.length) throw usageError('focus does not go with a crop', { hint: 'Use one: a crop (around, path, scope, ids) or focus.' });
    const kind = asked[0];
    if (!kind) return {};
    const first = (ids: string[]): string | undefined => ids.find((id) => planeOfId(planes, id));
    let crop: Crop;
    if (kind === 'around') {
      const view = new AroundWindow(doc, opts.around!.id, { ...(opts.around!.depth !== undefined ? { depth: opts.around!.depth } : {}), inner: !!opts.around!.inner }).view();
      const nodes = view.nodes.map((n) => n.id);
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
      const ids = opts.ids!.filter((id, i) => opts.ids!.indexOf(id) === i);
      for (const id of ids) doc.require(id);
      const isNode = (id: string): boolean => {
        const el = sem.byId.get(id);
        return !!el && is(el, 'bpmn:FlowNode');
      };
      crop = new Crop(ids, ids.filter(isNode), false);
      return { crop, ...Crop.planeHint(planes, first(ids), ids, ids.join(', ')) };
    }
    // scope
    const id = opts.scope!;
    const el = doc.require(id);
    const expandedOn = planes.find((p) => p.shapes.get(id)?.container);
    const frameCrop = (frame: string): { crop: Crop; plane?: string } => ({ crop: new Crop([frame], [], false, frame), ...Crop.planeHint(planes, frame, [frame], `--scope ${id}`) });
    if (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane')) return frameCrop(id);
    if (is(el, 'bpmn:SubProcess')) {
      if (expandedOn) return frameCrop(id);
      if (planes.some((p) => p.rootId === id)) return { plane: id, scope: id };
      throw modelError('E_NO_MATCH', `${id} is not drawn (no shape, no plane of its own)`, { element: id, hint: '`bpmn layout <file>` draws it; `bpmn render <file>` lists the planes.' });
    }
    if (is(el, 'bpmn:Process')) {
      const pool = sem.poolOfProcess.get(id);
      if (pool && planeOfId(planes, pool)) return frameCrop(pool);
      if (planes.some((p) => p.rootId === id)) return { plane: id, scope: id };
    }
    throw modelError('E_WRONG_KIND', `--scope takes a pool, lane, sub-process or process; "${id}" is a ${el.$type.replace(/^bpmn:/, '')}`, {
      element: id,
      hint: 'Use --around <id> for the neighbourhood of a node, or ids to crop to elements.',
    });
  }

  /** The plane of the crop's seed (else of any of its elements); E_NO_MATCH when none of it is drawn. */
  private static planeHint(planes: Plane[], seed: string | undefined, ids: string[], what: string): { plane?: string } {
    const p = seed ? planeOfId(planes, seed) : undefined;
    if (p) return { plane: p.rootId };
    throw modelError('E_NO_MATCH', `Nothing of ${what} is drawn (no shape on any plane)`, {
      ...(ids[0] ? { element: ids[0] } : {}),
      hint: '`bpmn layout <file>` draws the elements without a shape; `bpmn show <file> --layout` lists what is drawn.',
    });
  }

  /** The ids drawn in full on `plane`; elements on other planes go into a note, nothing on the plane is E_NO_MATCH. */
  drawnOn(plane: Plane, planes: Plane[], notes: string[]): Set<string> {
    const drawn = new Set<string>();
    if (this.frame) {
      const f = plane.shapes.get(this.frame);
      if (!f) throw modelError('E_NO_MATCH', `${this.frame} is not drawn on the plane of ${plane.rootId}`, { element: this.frame, hint: 'Drop --plane, or name the plane the scope is drawn on.' });
      drawn.add(f.id);
      const b = f.bounds;
      for (const s of plane.shapes.values()) {
        const x = s.bounds.x + s.bounds.width / 2;
        const y = s.bounds.y + s.bounds.height / 2;
        if (s !== f && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) drawn.add(s.id);
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
      for (const [p, count] of elsewhere) notes.push(`${count} element${count > 1 ? 's' : ''} of the crop ${count > 1 ? 'are' : 'is'} on the plane of ${p} (--plane ${p})`);
      if (this.artifacts) {
        for (const e of plane.edges.values()) {
          if (e.kind !== 'association' && e.kind !== 'dataAssociation') continue;
          for (const [here, there] of [
            [e.sourceId, e.targetId],
            [e.targetId, e.sourceId],
          ]) {
            const s = there ? plane.shapes.get(there) : undefined;
            if (here && drawn.has(here) && s && (s.kind === 'data' || s.kind === 'annotation')) drawn.add(s.id);
          }
        }
      }
    }
    // connections between drawn shapes
    for (const e of plane.edges.values()) if (e.sourceId && e.targetId && drawn.has(e.sourceId) && drawn.has(e.targetId)) drawn.add(e.id);
    return drawn;
  }
}
