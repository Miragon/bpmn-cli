import type { Plane } from '../../diagram/di/types.js';

export const planeOfId = (planes: Plane[], id: string): Plane | undefined => planes.find((plane) => plane.shapes.has(id) || plane.edges.has(id));
