import type { Plane } from '../../diagram/types.js';

/** The plane a shape or connection is drawn on. */
export const planeOfId = (planes: Plane[], id: string): Plane | undefined => planes.find((p) => p.shapes.has(id) || p.edges.has(id));
