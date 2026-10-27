import type { Doc } from '../../src/domain/document/Doc.js';
import type { DEdge, DShape } from '../../src/domain/diagram/di/types.js';
import { DiagramReader } from '../../src/domain/diagram/di/DiagramReader.js';

/** Every shape of every diagram plane, by id (a later plane wins). */
export function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const plane of new DiagramReader(doc.definitions).planes()) for (const shape of plane.shapes.values()) out.set(shape.id, shape);
  return out;
}

/** Every edge of every diagram plane, by id (a later plane wins). */
export function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const plane of new DiagramReader(doc.definitions).planes()) for (const edge of plane.edges.values()) out.set(edge.id, edge);
  return out;
}
