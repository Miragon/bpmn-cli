import { unionAll, type Box, type Point } from '../../drawing/utils/geom.js';

export function meets(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function pointsBox(points: readonly Point[]): Box {
  return unionAll(points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })))!;
}
