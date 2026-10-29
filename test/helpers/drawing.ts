import type { Doc } from '../../src/domain/document/Doc.js';
import type { DEdge, DShape } from '../../src/domain/diagram/di/types.js';
import { DiagramReader } from '../../src/domain/diagram/di/DiagramReader.js';

/** Every shape of every diagram plane, by id (a later plane wins). */
export function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const plane of new DiagramReader(doc.definitions).planes()) {
    for (const shape of plane.shapes.values()) {
      out.set(shape.id, shape);
    }
  }
  return out;
}

/** Every edge of every diagram plane, by id (a later plane wins). */
export function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const plane of new DiagramReader(doc.definitions).planes()) {
    for (const edge of plane.edges.values()) {
      out.set(edge.id, edge);
    }
  }
  return out;
}

/** The namespaces of a BPMN file with a diagram. */
export const DI_NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';

/** The DI shape of `id` in a hand-made drawing; `extra`: more attributes (` isHorizontal="true"`). */
export const shapeDi = (id: string, left: number, top: number, width: number, height: number, extra = ''): string =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}><dc:Bounds x="${left}" y="${top}" width="${width}" height="${height}" /></bpmndi:BPMNShape>`;

/** The DI edge of `id` through `pts`. */
export const edgeDi = (id: string, pts: Array<[number, number]>): string => `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts.map(([left, top]) => `<di:waypoint x="${left}" y="${top}" />`).join('')}</bpmndi:BPMNEdge>`;

export const sequenceFlow = (id: string, source: string, target: string): string => `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;

/** A file with process P holding `process`, drawn by `di`. */
export const drawnProcess = (process: string, di: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions ${DI_NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">\n<bpmn:process id="P">${process}</bpmn:process>\n<bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="P">${di}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</bpmn:definitions>`;
