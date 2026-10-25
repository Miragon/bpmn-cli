import type { Plane } from '../../diagram/types.js';

export const planeOfId = (planes: Plane[], id: string): Plane | undefined => planes.find((p) => p.shapes.has(id) || p.edges.has(id));
