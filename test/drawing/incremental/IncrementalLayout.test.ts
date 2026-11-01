import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IncrementalLayout } from '../../../src/drawing/incremental/IncrementalLayout.js';
import { DrawingSnapshot } from '../../../src/drawing/DrawingSnapshot.js';
import { DrawingPair, type RecordedChanges } from '../../support/DrawingPair.js';
import { Box, BpmnError, ChangeSet, Scorer, type BpmnDocument, type BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

const WALKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'corpus', 'walks');
const LONG_TITLE = Array.from({ length: 12 }, () => 'Clarify the order').join(' ');
const noChanges: RecordedChanges = { created: [], changed: [], removed: [], relocated: [], expand: [], collapse: [], renamed: [] };

function boxOf(document: BpmnDocument, id: string): Box {
  const shapes = document.diagram.planes().flatMap((plane) => plane.list('planeElement'));
  const bounds = shapes.find((di) => di.peek<BpmnElement>('bpmnElement')?.peek('id') === id)!.peek<BpmnElement>('bounds')!;
  return new Box(bounds.peek<number>('x')!, bounds.peek<number>('y')!, bounds.peek<number>('width')!, bounds.peek<number>('height')!);
}

function expansion(id: string, expanded: boolean): ChangeSet {
  const changes = new ChangeSet();
  changes.expansions.expand(id, expanded);
  return changes;
}

describe('IncrementalLayout', () => {
  const rows = readdirSync(WALKS).flatMap((walk) => DrawingPair.walkSteps(walk).map((step, index) => ({ row: `${walk}#${index} ${step.name}`, step })));

  it.each(rows)('places a walk step no worse than main: $row', async ({ step }) => {
    const { document, before, changes } = await DrawingPair.of(step.before, step.noLayout.file, step.noLayout);

    await new IncrementalLayout(document, before).place(changes);

    const main = await DrawingPair.parsed(step.after!);
    expect(new Scorer().score(document).score).toBeLessThanOrEqual(new Scorer().score(main).score);
  });

  it('keeps every shape of an unchanged drawing and reports nothing', async () => {
    const xml = Fixtures.text('models/incremental/orders.bpmn');
    const { document, before, changes } = await DrawingPair.of(xml, xml, noChanges);

    const report = await new IncrementalLayout(document, before).place(changes);

    expect(report).toMatchObject({ placed: [], moved: [], rerouted: [], reshaped: [] });
  });

  it('draws what the ChangeSet created next to its neighbours, in the order it was created', async () => {
    const { document, before, changes } = await DrawingPair.read('add-after');

    const report = await new IncrementalLayout(document, before).place(changes);

    expect(report.placed).toEqual(expect.arrayContaining(changes.created.map(({ id }) => id)));
  });

  it('collapses the sub-process the ChangeSet asks to collapse', async () => {
    const { document, before, changes } = await DrawingPair.read('expand-toggle');

    const { notes } = await new IncrementalLayout(document, before).place(changes);

    expect(notes).toContain('Activity_Fzs3 drawn collapsed');
  });

  it('draws a collapsed sub-process at the size of a task, its content on a plane of its own, and closes the strip it left', async () => {
    const { document, before } = await DrawingPair.drawn('models/incremental/sub.bpmn');

    await new IncrementalLayout(document, before).place(expansion('SP', false));

    expect(boxOf(document, 'SP')).toMatchObject({ width: 100, height: 80 });
    expect(boxOf(document, 'T').x).toBeLessThan(700);
    expect(document.diagram.planes().map((plane) => plane.peek<BpmnElement>('bpmnElement')?.peek('id'))).toEqual(['P1', 'SP']);
  });

  it('draws an expanded sub-process around its content and pushes what stands to its right', async () => {
    const { document, before } = await DrawingPair.drawn('models/incremental/sub.bpmn');
    await new IncrementalLayout(document, before).place(expansion('SP', false));

    const { notes } = await new IncrementalLayout(document, DrawingSnapshot.of(document)).place(expansion('SP', true));

    const sub = boxOf(document, 'SP');
    expect(notes).toContain('SP drawn expanded');
    expect(sub.width).toBeGreaterThanOrEqual(350);
    expect(boxOf(document, 'ST').isInside(sub)).toBe(true);
    expect(boxOf(document, 'T').x).toBeGreaterThan(sub.right);
    expect(document.diagram.planes()).toHaveLength(1);
  });

  it('moves the label of a flow off a sub-process title that grew over it', async () => {
    const xml = Fixtures.text('models/incremental/sub.bpmn')
      .replace('<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="SP"/>', '<bpmn:sequenceFlow id="F1" name="Start" sourceRef="S" targetRef="SP"/>')
      .replace('<di:waypoint x="240" y="200"/></bpmndi:BPMNEdge>', '<di:waypoint x="240" y="200"/><bpmndi:BPMNLabel><dc:Bounds x="420" y="125" width="30" height="14"/></bpmndi:BPMNLabel></bpmndi:BPMNEdge>');
    const { document, before, changes } = await DrawingPair.of(xml, xml.replace('name="Sub"', `name="${LONG_TITLE}"`), noChanges);

    const { notes } = await new IncrementalLayout(document, before).place(changes);

    expect(notes).toContain('label of F1 moved off the name of SP');
  });

  it('routes a line again that does not reach its end, and says so', async () => {
    const xml = Fixtures.text('models/incremental/pool.bpmn').replace('<di:waypoint x="420" y="160"/>', '<di:waypoint x="420" y="300"/>');
    const { document, before, changes } = await DrawingPair.of(xml, xml, noChanges);

    const { notes, rerouted } = await new IncrementalLayout(document, before).place(changes);

    expect(rerouted).toContain('F2');
    expect(notes).toContain('F2 routed again: it did not reach C');
  });

  it('removes a flow with a new end from a further view of the same root, which it does not lay out', async () => {
    const xml = Fixtures.text('models/incremental/twoviews.bpmn');
    const { document, before, changes } = await DrawingPair.of(xml, xml.replace('sourceRef="C" targetRef="D"', 'sourceRef="C" targetRef="E"'), noChanges);

    const { notes, rerouted } = await new IncrementalLayout(document, before).place(changes);

    expect(rerouted).toContain('F3');
    expect(notes.join()).toContain('edge(s) of F3 removed from a further diagram');
  });

  it('routes a flow again whose source changed', async () => {
    const xml = Fixtures.text('models/incremental/pool.bpmn');
    const { document, before, changes } = await DrawingPair.of(xml, xml.replace('sourceRef="A" targetRef="C"', 'sourceRef="S" targetRef="C"'), noChanges);

    const { rerouted } = await new IncrementalLayout(document, before).place(changes);

    expect(rerouted).toContain('F2');
  });

  it('passes a vertical plane when nothing is placed, moved or routed on it', async () => {
    const xml = Fixtures.text('models/incremental/vertical.bpmn');
    const { document, before, changes } = await DrawingPair.of(xml, xml, noChanges);

    await expect(new IncrementalLayout(document, before).place(changes)).resolves.toMatchObject({ placed: [] });
  });

  it('refuses to place on a vertical plane and says that a last layout operation turns the lanes', async () => {
    const before = Fixtures.text('models/incremental/vertical.bpmn');
    const added = before.replace('<bpmn:task id="A"', '<bpmn:task id="New" name="New"/><bpmn:task id="A"');
    const { document, before: snapshot, changes } = await DrawingPair.of(before, added, noChanges);

    const failure = await new IncrementalLayout(document, snapshot).place(changes).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BpmnError);
    expect(failure).toMatchObject({ code: 'E_LAYOUT_INCREMENTAL', details: { hint: expect.stringContaining('turns the lanes horizontal') } });
  });
});
