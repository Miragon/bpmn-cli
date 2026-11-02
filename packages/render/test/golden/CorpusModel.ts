import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DiagramReader, type Plane, type PlaneEdge, type PlaneShape } from '../../src/read/DiagramReader.js';

export class CorpusModel {
  private static readonly CORPUS = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));
  private static readonly FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

  static xml(path: string): string {
    return readFileSync(`${CorpusModel.CORPUS}${path}`, 'utf8');
  }

  static fixture(name: string): string {
    return readFileSync(`${CorpusModel.FIXTURES}${name}`, 'utf8');
  }

  static paths(folder: string): string[] {
    return readdirSync(`${CorpusModel.CORPUS}${folder}`, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.bpmn') && statSync(`${CorpusModel.CORPUS}${folder}/${name}`).isFile())
      .map((name) => `${folder}/${name}`)
      .sort();
  }

  static reader(path: string): Promise<DiagramReader> {
    return DiagramReader.fromXml(CorpusModel.xml(path));
  }

  static async plane(path: string, index = 0): Promise<Plane> {
    return (await CorpusModel.reader(path)).planes()[index] as Plane;
  }

  static async shape(path: string, id: string): Promise<PlaneShape> {
    const planes = (await CorpusModel.reader(path)).planes();
    return planes.flatMap((plane) => plane.shapes.get(id) ?? [])[0] as PlaneShape;
  }

  static async edge(path: string, id: string): Promise<PlaneEdge> {
    const planes = (await CorpusModel.reader(path)).planes();
    return planes.flatMap((plane) => plane.edges.get(id) ?? [])[0] as PlaneEdge;
  }
}
