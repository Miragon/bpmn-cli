import { describe, expect, it } from 'vitest';
import { DiWriter, type EngineWarning } from '../../../../src/drawing/full/pools/DiWriter.js';
import { ScopePlacer } from '../../../../src/drawing/full/scopes/ScopePlacer.js';
import { Box, Point, type BpmnElement } from '../../../support/ModelValues.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('DiWriter', () => {
  it('writes whole pixels and keeps each shape box by its element', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const writer = new DiWriter(document.tree);
    const [element] = document.tree.all().values();

    writer.shape(element!, new Box(10.4, 20.6, 100, 80));

    const bounds = writer.di[0]!.peek<BpmnElement>('bounds')!;
    expect([bounds.get('x'), bounds.get('y')]).toEqual([10, 21]);
    expect(writer.absBoxes.get(element!.id)?.x).toBe(10.4);
  });

  it('emits a scope in absolute coordinates and adds a plane per write', async () => {
    const document = await Fixtures.read('layout/gallery__01-xor-join.bpmn');
    const { tree } = document;
    const process = tree.processes()[0]!;
    const scope = new ScopePlacer({ expanded: new Set(), collapsedScopes: new Map() }).layOut(process);
    const writer = new DiWriter(tree);

    writer.emitScope(scope, new Point(80, 80));
    tree.definitions.set('diagrams', []);
    writer.writePlane(tree.definitions, process, process.id, []);

    expect(tree.definitions.list('diagrams')).toHaveLength(1);
    expect(Math.min(...[...writer.absBoxes.values()].map((box) => box.x))).toBe(80);
  });

  it('warns about a link whose ends lie on different diagrams', async () => {
    const document = await Fixtures.read('layout/gallery__01-xor-join.bpmn');
    const { tree } = document;
    const process = tree.processes()[0]!;
    const writer = new DiWriter(tree);
    const scope = new ScopePlacer({ expanded: new Set(), collapsedScopes: new Map() }).layOut(process);
    const association = tree.build('bpmn:Association', { id: 'Line' });
    scope.crossLinks.push({ el: association, id: 'Line', sourceId: 'Nowhere', targetId: 'Nothing' });
    const warnings: EngineWarning[] = [];

    writer.emitScope(scope, new Point(0, 0));
    writer.writePlane(tree.definitions, process, process.id, warnings);

    expect(warnings.map(({ code, elementId }) => [code, elementId])).toEqual([['DI_NOT_CREATED', 'Line']]);
  });
});
