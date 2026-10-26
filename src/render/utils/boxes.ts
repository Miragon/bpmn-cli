import { unionAll, type Box, type Point } from '../../drawing/utils/geom.js';

export function meets(first: Box, second: Box): boolean {
  return first.x <= second.x + second.width && second.x <= first.x + first.width && first.y <= second.y + second.height && second.y <= first.y + first.height;
}

export function pointsBox(points: readonly Point[]): Box {
  return unionAll(points.map((point) => ({ x: point.x, y: point.y, width: 0, height: 0 })))!;
}
