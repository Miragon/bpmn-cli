import { describe, expect, it } from 'vitest';
import { FullLayout } from '../../../../src/drawing/full/FullLayout.js';
import { BlockAdopter } from '../../../../src/drawing/incremental/steps/BlockAdopter.js';
import { Plane } from '../../../../src/drawing/plane/Plane.js';
import { Box } from '../../../support/ModelValues.js';
import { PlacementScene } from '../../../support/PlacementScene.js';

describe('BlockAdopter', () => {
  async function blockScene() {
    const scene = await PlacementScene.of('add-subprocess');
    const engine = await FullLayout.engineDrawing(scene.parts.document, scene.parts.changes.expansions);
    return { scene, engine, block: engine.block('Activity_Fzs3', false)! };
  }

  it('copies the engine\'s content onto the plane, shifted and bound to the document', async () => {
    const { scene, block } = await blockScene();
    const [first] = block.shapes;
    scene.place.placeAt(scene.plane, 'Activity_Fzs3', 700, 120, { width: 400, height: 200 });

    new BlockAdopter(scene.run).adopt(scene.plane, block, 10, 20);

    const copy = scene.shape(first!.id);
    expect(copy.bounds).toMatchObject({ x: first!.bounds.x + 10, y: first!.bounds.y + 20 });
    expect(copy.el).toBe(scene.place.semantics.byId.get(first!.id));
    expect(copy.parentId).toBe('Activity_Fzs3');
    expect(scene.run.fromEngine.has(first!.id)).toBe(true);
    expect(block.edges.every((edge) => scene.run.newEdges.has(edge.id))).toBe(true);
  });

  it('moves labels along and keeps a nested sub-process as the engine drew it', async () => {
    const { scene, block, engine } = await blockScene();
    const sub = engine.planes.flatMap((plane) => [...plane.shapes.values()]).find(({ id }) => id === 'Activity_Fzs3')!;
    const [shape] = block.shapes;
    const [edge] = block.edges;
    shape!.label = new Box(10, 10, 30, 14);
    edge!.label = new Box(20, 20, 30, 14);

    new BlockAdopter(scene.run).adopt(scene.plane, { ...block, shapes: [sub, shape!] }, 5, 5);

    expect(scene.shape('Activity_Fzs3')).toMatchObject({ expanded: true, container: true });
    expect(scene.shape(shape!.id).label).toMatchObject({ x: 15, y: 15 });
    expect(scene.edge(edge!.id).label).toMatchObject({ x: 25, y: 25 });
  });

  it('skips what the document lacks or the plane already holds', async () => {
    const { scene, block } = await blockScene();
    const [first] = block.shapes;
    const drawn = scene.place.newShape(scene.plane, first!.id, first!.bounds.copy());
    scene.plane.shapes.set(first!.id, drawn);

    new BlockAdopter(scene.run).adopt(scene.plane, block, 10, 20);

    expect(scene.shape(first!.id)).toBe(drawn);
  });

  it('takes the plane of a collapsed sub-process along', async () => {
    const { scene, block } = await blockScene();
    const sub = scene.place.semantics.byId.get('Activity_Fzs3')!;
    const plane = new Plane('Inner', 'Activity_Fzs3', sub);
    block.shapes.forEach((shape) => plane.shapes.set(shape.id, shape));
    block.edges.forEach((edge) => plane.edges.set(edge.id, edge));
    const before = scene.run.planes.length;

    new BlockAdopter(scene.run).adopt(scene.plane, { box: block.box, shapes: [], edges: [], planes: [plane] }, 0, 0);

    const adopted = scene.run.planes.find(({ rootId }) => rootId === 'Activity_Fzs3');
    expect(scene.run.planes.length).toBe(before + 1);
    expect(adopted?.shapes.size).toBe(block.shapes.length);
    expect(adopted?.edges.size).toBe(block.edges.length);
  });
});
