import type { DShape, Plane } from '../../drawing/types.js';
import { problemKey, type LayoutProblem } from '../../drawing/utils/problems.js';

export function unique(ids: readonly string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

/** Drops shapes that move with another listed shape (content of a listed expanded sub-process). */
export function outermost(plane: Plane, shapes: DShape[]): DShape[] {
  const ids = new Set(shapes.map((s) => s.id));
  return shapes.filter((s) => {
    let p = s.parentId;
    for (let i = 0; p && i < 20; i++) {
      if (ids.has(p)) return false;
      p = plane.shapes.get(p)?.parentId;
    }
    return true;
  });
}

export function frameWord(f: DShape): string {
  return f.kind === 'participant' ? 'pool' : f.kind === 'lane' ? 'lane' : 'sub-process';
}

export function problemWords(ps: readonly LayoutProblem[]): string {
  const uniq = [...new Map(ps.map((p) => [problemKey(p), p])).values()];
  return uniq.slice(0, 3).map((p) => `${p.kind} [${p.ids.join(', ')}]`).join(', ') + (uniq.length > 3 ? ', ...' : '');
}
