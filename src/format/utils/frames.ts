import type { DShape, Plane } from '../../drawing/types.js';
import { problemKey, type LayoutProblem } from '../../drawing/utils/problems.js';

export function unique(ids: readonly string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

/** Drops shapes that move with another listed shape (content of a listed expanded sub-process). */
export function outermost(plane: Plane, shapes: DShape[]): DShape[] {
  const ids = new Set(shapes.map((shape) => shape.id));
  return shapes.filter((shape) => {
    let parentId = shape.parentId;
    for (let depth = 0; parentId && depth < 20; depth++) {
      if (ids.has(parentId)) return false;
      parentId = plane.shapes.get(parentId)?.parentId;
    }
    return true;
  });
}

export function frameWord(frame: DShape): string {
  return frame.kind === 'participant' ? 'pool' : frame.kind === 'lane' ? 'lane' : 'sub-process';
}

export function problemWords(problems: readonly LayoutProblem[]): string {
  const uniq = [...new Map(problems.map((problem) => [problemKey(problem), problem])).values()];
  return uniq.slice(0, 3).map((problem) => `${problem.kind} [${problem.ids.join(', ')}]`).join(', ') + (uniq.length > 3 ? ', ...' : '');
}
