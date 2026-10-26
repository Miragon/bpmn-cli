/**
 * `bpmn render` for agents (issue #12, stage 2): crops (--around draws
 * exactly the nodes of show --around, --path, --scope, ids), halos,
 * numbered layout problems at their location (ProblemLocator.ts,
 * each badge inside its elements' bounding box, listed in metrics order),
 * tiles cut at the diagram's columns, `--render` on mutating commands and
 * the fuzz walk's render oracle. Synthetic models only.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/domain/document/Doc.js';
import { type LayoutProblem, diffProblems } from '../src/domain/diagram/utils/problems.js';
import type { Plane } from '../src/domain/diagram/di/types.js';
import { ElementSelector } from '../src/domain/views/ElementSelector.js';
import { changeHighlight, CliError, HALO_COLORS, MIN_LABEL_SCALE, mutateDoc, parseOps, renderDocSvg, renderSvg, aroundView, mutationReport } from '../src/index.js';
import { LayoutAnalysis } from '../src/domain/diagram/di/LayoutAnalysis.js';
import { ProblemLocator } from '../src/domain/diagram/di/ProblemLocator.js';
import { DiagramReader } from '../src/domain/diagram/di/DiagramReader.js';
import { is } from '../src/domain/document/utils/moddle.js';
import { renderPng } from '../src/node.js';
// @ts-expect-error plain ESM tooling without type declarations
import { libExecutor } from '../tools/fuzz/lib/exec.mjs';
// @ts-expect-error plain ESM tooling without type declarations
import { runWalk } from '../tools/fuzz/lib/walk.mjs';

const ROOT = join(import.meta.dirname, '..');
const SCENARIOS = join(ROOT, 'tools', 'scenarios');
const O2C = join(SCENARIOS, 'agent__o2c.bpmn');
const GALLERY = join(ROOT, 'test', 'fixtures', 'render', 'gallery.bpmn');
const LONG = join(ROOT, 'test', 'fixtures', 'render', 'long.bpmn');

function bpmnFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...bpmnFiles(full));
    else if (name.endsWith('.bpmn')) out.push(full);
  }
  return out;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The bounding box of a problem's elements on a plane: shapes, waypoints, DI labels. */
function problemBox(plane: Plane, ids: string[]): Box | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (box: Box): void => {
    x0 = Math.min(x0, box.x);
    y0 = Math.min(y0, box.y);
    x1 = Math.max(x1, box.x + box.width);
    y1 = Math.max(y1, box.y + box.height);
  };
  for (const id of ids) {
    const shape = plane.shapes.get(id);
    if (shape) [shape.bounds, shape.label].forEach((bounds) => bounds && add(bounds));
    const edge = plane.edges.get(id);
    if (edge) {
      for (const point of edge.points) add({ x: point.x, y: point.y, width: 0, height: 0 });
      if (edge.label) add(edge.label);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
}

const inBox = (box: Box, point: { x: number; y: number }): boolean => point.x >= box.x - 0.01 && point.x <= box.x + box.width + 0.01 && point.y >= box.y - 0.01 && point.y <= box.y + box.height + 0.01;

/** The ids drawn in full (`<g data-id>`), the faded connections and the context frames of an SVG. */
function drawnIds(svg: string, attr = 'data-id'): string[] {
  return [...svg.matchAll(new RegExp(`<g ${attr}="([^"]+)"`, 'g'))].map((match) => match[1]!);
}

/** The badges of an SVG: number -> centre. */
function badgesOf(svg: string): Map<number, { x: number; y: number }> {
  return new Map([...svg.matchAll(/<g data-problem="(\d+)"><circle cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((match) => [Number(match[1]), { x: Number(match[2]), y: Number(match[3]) }]));
}

const shown = (problem: LayoutProblem): string => `${problem.kind} ${problem.ids.join(',')}${problem.detail ? ` ${problem.detail}` : ''}`;

describe('locateProblems', () => {
  const files = [...bpmnFiles(SCENARIOS), ...bpmnFiles(join(ROOT, 'test', 'fixtures'))];

  it('puts every drawn problem inside the bounding box of its elements, on its plane; layoutProblems stays as it was', async () => {
    let located = 0;
    for (const file of files) {
      const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
      const defs = doc.definitions;
      const problems = LayoutAnalysis.of(defs).problems;
      for (const problem of problems) expect(problem, file).not.toHaveProperty('at');
      const planes = new DiagramReader(defs).planes();
      const out = new ProblemLocator(defs).locate(problems);
      expect(out.map(({ at: _unusedAt, ...problem }) => problem), file).toEqual(problems);
      for (const problem of out) {
        const plane = planes.find((candidate) => candidate.shapes.has(problem.ids[0] ?? '') || candidate.edges.has(problem.ids[0] ?? ''));
        if (problem.kind === 'missing' || problem.kind === 'failed' || !plane) {
          if (problem.kind === 'missing' || problem.kind === 'failed') expect(problem.at, `${file} ${shown(problem)}`).toBeUndefined();
          continue;
        }
        // every problem on a plane has a place (degenerate edges without waypoints aside)
        if (problem.kind !== 'degenerateEdge') expect(problem.at, `${file} ${shown(problem)}`).toBeDefined();
        if (!problem.at) continue;
        located++;
        expect(problem.at.plane, `${file} ${shown(problem)}`).toBe(plane.rootId);
        expect(inBox(problemBox(plane, problem.ids)!, problem.at), `${file} ${shown(problem)} at ${problem.at.x},${problem.at.y}`).toBe(true);
      }
    }
    expect(located).toBeGreaterThan(300);
  }, 60000);

  it('locates each kind on the defect: a crossing at the crossing point, an overlap in the overlap', async () => {
    const doc = await Doc.fromXml(readFileSync(O2C, 'utf8'));
    const out = new ProblemLocator(doc.definitions).locate(LayoutAnalysis.of(doc.definitions).problems);
    const crossing = out.find((problem) => problem.kind === 'crossings')!;
    expect(crossing.ids).toEqual(['Flow_6', 'Flow_21']);
    const plane = new DiagramReader(doc.definitions).planes()[0]!;
    // the crossing point lies on both flows
    const onFlow = (id: string): boolean =>
      plane.edges.get(id)!.points.some((point, index, pts) => {
        const nextPoint = pts[index + 1];
        return !!nextPoint && Math.abs((nextPoint.x - point.x) * (crossing.at!.y - point.y) - (nextPoint.y - point.y) * (crossing.at!.x - point.x)) < 1 && inBox({ x: Math.min(point.x, nextPoint.x), y: Math.min(point.y, nextPoint.y), width: Math.abs(nextPoint.x - point.x), height: Math.abs(nextPoint.y - point.y) }, crossing.at!);
      });
    expect(onFlow('Flow_6') && onFlow('Flow_21')).toBe(true);
  });
});

describe('--problems', () => {
  it('lists every metrics problem once, in metrics order with the same ids, each badge inside its elements', async () => {
    let badges = 0;
    for (const file of [...bpmnFiles(SCENARIOS), GALLERY, LONG]) {
      const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
      if (!new DiagramReader(doc.definitions).planes().length) continue;
      const metrics = LayoutAnalysis.of(doc.definitions).problems;
      const rendered = renderDocSvg(doc, { maxSize: 2000, problems: true });
      expect(rendered.problems.map((problem) => `${problem.n} ${shown(problem)}`), file).toEqual(metrics.map((problem, index) => `${index + 1} ${shown(problem)}`));
      const plane = new DiagramReader(doc.definitions).planes().find((candidatePlane) => candidatePlane.rootId === rendered.plane)!;
      const drawn = badgesOf(rendered.svg);
      expect([...drawn.keys()].sort((left, right) => left - right), file).toEqual(rendered.problems.filter((problem) => problem.drawn).map((problem) => problem.n));
      for (const problem of rendered.problems.filter((candidate) => candidate.drawn)) {
        expect(inBox(problemBox(plane, problem.ids)!, drawn.get(problem.n)!), `${file} ${problem.n} ${shown(problem)}`).toBe(true);
        badges++;
      }
    }
    expect(badges).toBeGreaterThan(200);
  }, 60000);

  it('moves a badge that would cover an earlier one aside, still inside its elements', async () => {
    const rendered = await renderSvg(readFileSync(O2C, 'utf8'), { problems: true });
    const spots = [...badgesOf(rendered.svg).values()];
    for (const [index, spot] of spots.entries()) for (const otherSpot of spots.slice(index + 1)) expect(Math.hypot(spot.x - otherSpot.x, spot.y - otherSpot.y)).toBeGreaterThan(17.9);
  });

  it('a list of problems: exactly those, numbered in its order; a problem on another plane is listed, not drawn', async () => {
    const xml = readFileSync(O2C, 'utf8');
    const doc = await Doc.fromXml(xml);
    const all = LayoutAnalysis.of(doc.definitions).problems;
    const asked = [all[3]!, all[0]!];
    const rendered = await renderSvg(xml, { problems: asked });
    expect(rendered.problems.map((problem) => [problem.n, problem.kind, problem.ids])).toEqual([
      [1, asked[0]!.kind, asked[0]!.ids],
      [2, asked[1]!.kind, asked[1]!.ids],
    ]);
    expect([...badgesOf(rendered.svg).keys()]).toEqual([1, 2]);
    const gallery = readFileSync(GALLERY, 'utf8');
    const missing: LayoutProblem = { kind: 'missing', ids: ['Activity_Nowhere'] };
    expect((await renderSvg(gallery, { problems: [missing] })).problems).toEqual([{ n: 1, kind: 'missing', ids: ['Activity_Nowhere'], drawn: false }]);
  });
});

describe('crops', () => {
  it('--around draws exactly the nodes of show --around (every node of every scenario); the median crop at depth 2 stays within 1,000 image tokens', async () => {
    const tokens: number[] = [];
    for (const file of bpmnFiles(SCENARIOS)) {
      const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
      const planes = new DiagramReader(doc.definitions).planes();
      if (!planes.length) continue;
      const nodes = [...doc.byId().values()].filter((el) => is(el, 'bpmn:FlowNode') && planes.some((candidatePlane) => candidatePlane.shapes.has(el.get<string>('id'))));
      for (const [index, node] of nodes.entries()) {
        const id = node.get<string>('id');
        const rendered = renderDocSvg(doc, { maxSize: 2000, around: { id, depth: 2 } });
        tokens.push(rendered.tokens);
        if (index % 4) continue; // the node set of every 4th node (the renders above cover every node)
        const plane = planes.find((candidatePlane) => candidatePlane.rootId === rendered.plane)!;
        const window = aroundView(doc, id, { depth: 2 }).nodes.map((windowNode) => windowNode.id).filter((nodeId) => plane.shapes.has(nodeId));
        const flowNodes = drawnIds(rendered.svg).filter((drawnId) => plane.shapes.has(drawnId) && is(plane.shapes.get(drawnId)!.el, 'bpmn:FlowNode'));
        expect(new Set(flowNodes), `${file} --around ${id}`).toEqual(new Set(window));
        expect(rendered.nodes, `${file} --around ${id}`).toEqual(window);
      }
    }
    tokens.sort((left, right) => left - right);
    const median = tokens[Math.floor(tokens.length / 2)]!;
    expect(tokens.length).toBeGreaterThan(1500);
    expect(median).toBeLessThanOrEqual(1000);
  }, 60000);

  it('--around: the connections between the nodes in full, the rest faded, frames as context; --depth and --inner as in show', async () => {
    const xml = readFileSync(O2C, 'utf8');
    const rendered = await renderSvg(xml, { around: { id: 'Gateway_OrderValid', depth: 1 } });
    expect(rendered.nodes).toEqual(['Activity_ValidateOrder', 'Gateway_OrderValid', 'Activity_CheckCredit', 'Event_OrderRejected']);
    expect(drawnIds(rendered.svg).sort()).toEqual(['Activity_CheckCredit', 'Activity_ValidateOrder', 'Event_OrderRejected', 'Flow_2', 'Flow_3', 'Flow_4', 'Gateway_OrderValid'].sort());
    expect(drawnIds(rendered.svg, 'data-faded')).toEqual(expect.arrayContaining(['Flow_1', 'Flow_5']));
    expect(drawnIds(rendered.svg, 'data-context')).toEqual(expect.arrayContaining(['Lane_Sales', 'Lane_Finance']));
    // the image fits the nodes, not the whole drawing
    const whole = await renderSvg(xml);
    expect(rendered.width).toBeLessThan(whole.width / 2);
    const deeper = await renderSvg(xml, { around: { id: 'Gateway_OrderValid', depth: 3 } });
    expect(deeper.nodes!.length).toBeGreaterThan(rendered.nodes!.length);
  });

  it('--path draws the nodes and flows of the path; --scope a pool, lane or sub-process with what lies inside; ids exactly these', async () => {
    const xml = readFileSync(O2C, 'utf8');
    const doc = await Doc.fromXml(xml);
    const path = await renderSvg(xml, { path: { from: 'Event_OrderReceived', to: 'Event_OrderCompleted' } });
    const expected = new ElementSelector(doc).path('Event_OrderReceived', 'Event_OrderCompleted').map((el) => el.get<string>('id'));
    expect(path.nodes).toEqual(expected.filter((id) => is(doc.require(id), 'bpmn:FlowNode')));
    for (const id of expected) expect(drawnIds(path.svg)).toContain(id);
    const lane = await renderSvg(xml, { scope: 'Lane_Warehouse' });
    expect(lane.nodes!.sort()).toEqual(['Activity_PickAndPack', 'Activity_ShipGoods']);
    expect(drawnIds(lane.svg)).toContain('Lane_Warehouse');
    const ids = await renderSvg(xml, { ids: ['Activity_CheckCredit', 'Gateway_CreditOk'] });
    expect(drawnIds(ids.svg).sort()).toEqual(['Activity_CheckCredit', 'Flow_5', 'Gateway_CreditOk']);
    // a sub-process scope, and a collapsed one (its own plane)
    const gallery = readFileSync(GALLERY, 'utf8');
    const sub = await renderSvg(gallery, { scope: 'Activity_ExpandedSubProcess' });
    expect(sub.nodes).toEqual(expect.arrayContaining(['Event_InnerStart', 'Activity_InnerTask', 'Event_InnerEnd']));
    const collapsed = await renderSvg(readFileSync(join(SCENARIOS, 'subproc__s03-collapsed.bpmn'), 'utf8'), { scope: 'Activity_Ship' });
    expect(collapsed.plane).toBe('Activity_Ship');
    expect(collapsed.nodes).toContain('Activity_Pack');
    // the gallery's collapsed sub-process has an empty plane: nothing of the scope is drawn
    await expect(renderSvg(gallery, { scope: 'Activity_CollapsedSubProcess' })).rejects.toMatchObject({ code: 'E_NO_MATCH' });
  });

  it('picks the plane of the crop and names crop elements on other planes', async () => {
    const xml = readFileSync(join(SCENARIOS, 'subproc__s03-collapsed.bpmn'), 'utf8');
    expect((await renderSvg(xml, { ids: ['Activity_Pack'] })).plane).toBe('Activity_Ship');
    const mixed = await renderSvg(xml, { ids: ['Activity_Prepare', 'Activity_Pack'] });
    expect(mixed.plane).toBe('Process_Main');
    expect(mixed.notes).toContain('1 element of the crop is on the plane of Activity_Ship (--plane Activity_Ship)');
    // --inner enters the collapsed sub-process: its first and last nodes are on its own plane
    const inner = await renderSvg(xml, { around: { id: 'Activity_Ship', depth: 1, inner: true } });
    expect(inner.plane).toBe('Process_Main');
    expect(inner.notes).toContain('2 elements of the crop are on the plane of Activity_Ship (--plane Activity_Ship)');
    expect((await renderSvg(xml, { around: { id: 'Activity_Ship', depth: 1, inner: true }, plane: 'Activity_Ship' })).nodes).toEqual(['Event_ShipStart', 'Event_Shipped']);
  });

  it('refuses two crops, unknown ids, a scope of the wrong kind and a crop with nothing drawn', async () => {
    const xml = readFileSync(O2C, 'utf8');
    await expect(renderSvg(xml, { around: { id: 'Gateway_OrderValid' }, scope: 'Lane_Sales' })).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(renderSvg(xml, { ids: ['Activity_Nope'] })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    await expect(renderSvg(xml, { around: { id: 'Activity_Nope' } })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    await expect(renderSvg(xml, { scope: 'Activity_CheckCredit' })).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
    await expect(renderSvg(xml, { path: { from: 'Event_OrderCompleted', to: 'Event_OrderReceived' } })).rejects.toMatchObject({ code: 'E_NO_MATCH' });
    const undrawn = xml.replace(/<bpmndi:BPMNShape id="[^"]*" bpmnElement="Activity_ShipGoods"[\s\S]*?<\/bpmndi:BPMNShape>/, '');
    expect(undrawn).not.toBe(xml);
    await expect(renderSvg(undrawn, { ids: ['Activity_ShipGoods'] })).rejects.toMatchObject({ code: 'E_NO_MATCH' });
  });
});

describe('halos', () => {
  it('draws a halo under each highlighted element, coloured by category; a list is orange and its unknown ids are E_NOT_FOUND', async () => {
    const xml = readFileSync(O2C, 'utf8');
    const rendered = await renderSvg(xml, { highlight: { created: ['Activity_CheckCredit'], changed: ['Activity_CheckCredit', 'Flow_5'], moved: ['Gateway_CreditOk', 'Lane_Finance'] } });
    const svg = rendered.svg;
    const haloOf = (color: string): number => svg.split(`stroke="${color}"`).length - 1;
    expect(haloOf(HALO_COLORS.created)).toBe(1); // created wins over changed
    expect(haloOf(HALO_COLORS.changed)).toBe(1); // the flow
    expect(haloOf(HALO_COLORS.moved)).toBe(1); // the gateway; a lane that only moved gets none
    // under the element: the halo comes first
    expect(svg.indexOf(`stroke="${HALO_COLORS.created}"`)).toBeLessThan(svg.indexOf('<g data-id="Activity_CheckCredit">'));
    const list = await renderSvg(xml, { highlight: ['Lane_Finance'] });
    expect(list.svg).toContain(`stroke="${HALO_COLORS.changed}"`);
    await expect(renderSvg(xml, { highlight: ['Activity_Nope'] })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    // in a crop: a context lane keeps its halo, an element outside the crop is named
    const crop = await renderSvg(xml, { around: { id: 'Gateway_OrderValid', depth: 1 }, highlight: ['Lane_Finance', 'Activity_ShipGoods'] });
    expect(crop.svg).toContain(`stroke="${HALO_COLORS.changed}"`);
    expect(crop.notes).toEqual(['highlighted but not in the image (outside the crop or not drawn on this plane): Activity_ShipGoods']);
  });

  it('changeHighlight: created, changed (model, colour) and moved (layout, format) ids, each in its first category', async () => {
    const doc = await Doc.fromXml(readFileSync(O2C, 'utf8'));
    const result = await mutateDoc(doc, parseOps([{ op: 'add', kind: 'userTask', name: 'Approve credit', after: 'Activity_CheckCredit' }, { op: 'color', ids: ['Activity_ShipGoods'], color: 'green' }]), { dryRun: true });
    const highlight = changeHighlight(mutationReport(result));
    expect(highlight.created).toEqual(expect.arrayContaining(['Activity_ApproveCredit', 'Flow_ApproveCreditToCreditOk']));
    expect(highlight.changed).toEqual(expect.arrayContaining(['Flow_5', 'Activity_ShipGoods']));
    expect(highlight.changed).not.toContain('Activity_ApproveCredit');
    expect(highlight.moved).toContain('Gateway_CreditOk');
    for (const id of highlight.moved) expect([...highlight.created, ...highlight.changed]).not.toContain(id);
  });
});

describe('tiles', () => {
  it('splits an unreadable image at the diagram columns into readable tiles within --max-size, every column once', async () => {
    const xml = readFileSync(LONG, 'utf8');
    const whole = await renderSvg(xml, { maxSize: 2000 });
    expect(whole.scale).toBeLessThan(MIN_LABEL_SCALE);
    const rendered = await renderSvg(xml, { maxSize: 2000, tiles: true, problems: true });
    expect(rendered.tiles!.length).toBeGreaterThanOrEqual(2);
    expect(rendered.scale).toBe(1);
    let next = 0;
    for (const tile of rendered.tiles!) {
      expect(Math.max(tile.width, tile.height)).toBeLessThanOrEqual(2000);
      expect(tile.tokens).toBe(Math.round((tile.width * tile.height) / 784));
      expect(tile.columns![0]).toBe(next);
      next = tile.columns![1] + 1;
    }
    const doc = await Doc.fromXml(xml);
    const columns = (await import('../src/index.js')).layoutView(doc.definitions).diagrams[0]!.columns;
    expect(next).toBe(columns);
    expect(rendered.svg).toBe(rendered.tiles![0]!.svg);
    expect(rendered.notes.join('\n')).toMatch(new RegExp(`split into ${rendered.tiles!.length} tiles at the diagram's columns`));
    expect(rendered.notes.join('\n')).not.toMatch(/hard to read/);
    // every node lies in exactly one tile (the tiles cut between columns)
    for (const id of [...doc.byId().keys()].filter((elementId) => elementId.startsWith('Activity_'))) {
      expect(rendered.tiles!.filter((tile) => tile.svg.includes(`<g data-id="${id}">`)).length, id).toBe(1);
    }
    const png = await renderPng(xml, { tiles: true });
    expect(png.images.map((image) => [image.width, image.height, image.columns])).toEqual(rendered.tiles!.map((tile) => [tile.width, tile.height, tile.columns]));
  });

  it('splits a tall drawing into bands too; a readable image stays one, with a note', async () => {
    const gallery = readFileSync(GALLERY, 'utf8');
    const rendered = await renderSvg(gallery, { maxSize: 600, tiles: true, problems: true });
    expect(rendered.tiles!.some((tile) => (tile.band ?? 1) > 1)).toBe(true);
    for (const tile of rendered.tiles!) expect(Math.max(tile.width, tile.height)).toBeLessThanOrEqual(600);
    for (const problem of rendered.problems.filter((candidate) => candidate.drawn)) expect(rendered.tiles![problem.tile! - 1]!.svg).toContain(`<g data-problem="${problem.n}">`);
    const small = await renderSvg(readFileSync(O2C, 'utf8'), { tiles: true });
    expect(small.tiles).toBeUndefined();
    expect(small.notes).toContain('--tiles: the image is readable as one (scale 1.00); no tiles');
  });
});

describe('focus', () => {
  it('draws the whole plane when it is readable, else the region around the focus elements and their neighbours', async () => {
    const xml = readFileSync(LONG, 'utf8');
    const rendered = await renderSvg(xml, { maxSize: 2000, focus: ['Activity_PackItems'] });
    expect(rendered.scale).toBe(1);
    expect(rendered.notes.join('\n')).toMatch(/the image shows the region around the 1 element in focus/);
    for (const id of ['Activity_PickItems', 'Activity_PackItems', 'Activity_WeighParcel']) expect(drawnIds(rendered.svg)).toContain(id);
    expect(drawnIds(rendered.svg)).not.toContain('Activity_ReceiveOrder');
    const o2c = await renderSvg(readFileSync(O2C, 'utf8'), { maxSize: 2000, focus: ['Activity_CheckCredit'] });
    expect(o2c.notes).toEqual([]);
    expect(drawnIds(o2c.svg)).toContain('Event_OrderReceived');
  });
});

describe('the commands', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-render-agent-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function cli(args: string[]): { code: number; out: string; err: string } {
    const child = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { cwd: ROOT, input: '', encoding: 'utf8' });
    return { code: child.status ?? -1, out: child.stdout, err: child.stderr };
  }

  it('render --around --problems --highlight: the crop line, the halo legend and the numbered problems', () => {
    const out = join(dir, 'around.png');
    const run = cli(['render', O2C, '--around', 'Gateway_OrderValid', '--depth', '2', '--problems', '--highlight', 'Gateway_OrderValid', '-o', out]);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(run.out).toMatch(/^wrote \S+around\.png  \d+x\d+ px  ~\d+ image tokens  scale 1\.00  plane Process_OrderToCash\n/);
    expect(run.out).toContain('\ncrop: around Gateway_OrderValid (depth 2): 7 nodes\n');
    expect(run.out).toContain('\nhalos: orange --highlight\n');
    expect(run.out).toContain('\nproblems (numbered in the image):\n  1 crossings [Flow_6, Flow_21]\n');
    const json = JSON.parse(cli(['render', O2C, '--path', 'Event_OrderReceived', 'Gateway_OrderValid', '--json', '-o', join(dir, 'path.svg')]).out);
    expect(json).toMatchObject({ format: 'svg', nodes: ['Event_OrderReceived', 'Activity_ValidateOrder', 'Gateway_OrderValid'], problems: [] });
    const ids = cli(['render', O2C, 'Activity_CheckCredit', 'Gateway_CreditOk', '--json', '-o', join(dir, 'ids.png')]);
    expect(JSON.parse(ids.out).nodes).toEqual(['Activity_CheckCredit', 'Gateway_CreditOk']);
  });

  it('render --tiles writes <name>-1.png, <name>-2.png, ... and a line per tile', () => {
    const run = cli(['render', LONG, '--tiles', '-o', join(dir, 'long.png')]);
    expect(run.code).toBe(0);
    const lines = run.out.split('\n').filter((line) => line.startsWith('wrote '));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    lines.forEach((line, index) => expect(line).toMatch(new RegExp(`^wrote \\S+long-${index + 1}\\.png  \\d+x\\d+ px  ~[\\d,]+ image tokens  scale 1\\.00  plane Process_LongOrder  tile ${index + 1}/${lines.length} c\\d+-c\\d+$`)));
    for (const index of lines.keys()) expect(existsSync(join(dir, `long-${index + 1}.png`))).toBe(true);
    expect(run.out).toMatch(new RegExp(`\\n${lines.length} tiles, ~[\\d,]+ image tokens in all\\n`));
  });

  it('render refuses flags that do not go together', () => {
    expect(cli(['render', O2C, '--depth', '2']).err).toContain('error E_USAGE: --depth goes only with --around <id>');
    expect(cli(['render', O2C, '--via', 'Flow_1']).err).toContain('error E_USAGE: --via needs --path');
    expect(cli(['render', O2C, '--path', 'Event_OrderReceived']).err).toContain('error E_USAGE: --path takes exactly two ids');
    expect(cli(['render', O2C, '--tiles', '-o', '-']).err).toContain('error E_USAGE: --tiles writes several images');
    const two = cli(['render', O2C, '--around', 'Gateway_OrderValid', '--scope', 'Lane_Sales']);
    expect(two.code).toBe(1);
    expect(two.err).toContain('crop the image in different ways; use one');
    expect(cli(['render', O2C, '--scope', 'Activity_CheckCredit']).code).toBe(2);
  });

  it('--render on a mutating command draws the result with halos and the problems the change added; the report has it', () => {
    const file = join(dir, 'o2c.bpmn');
    copyFileSync(O2C, file);
    const png = join(dir, 'change.png');
    const run = cli(['add', file, 'userTask', 'Approve credit', '--after', 'Activity_CheckCredit', '--render', png]);
    expect(run.code).toBe(0);
    expect(existsSync(png)).toBe(true);
    expect(run.out).toMatch(/\nrender: wrote \S+change\.png  \d+x\d+ px  ~[\d,]+ image tokens  scale [\d.]+  plane Process_OrderToCash\n  halos: green created, orange changed, blue moved\n  layout problems the change added: none\n?/);
    // --json: the render block next to the report
    copyFileSync(O2C, file);
    const json = JSON.parse(cli(['add', file, 'task', 'Check limit', '--after', 'Activity_CheckCredit', '--render', join(dir, 'change.svg'), '--json', '--summary']).out);
    expect(json.render).toMatchObject({ format: 'svg', plane: 'Process_OrderToCash', problems: [] });
    expect(readFileSync(join(dir, 'change.svg'), 'utf8')).toContain(`stroke="${HALO_COLORS.created}"`);
    // a large drawing: the region of the change
    const long = join(dir, 'long.bpmn');
    copyFileSync(LONG, long);
    const region = cli(['add', long, 'task', 'Check fragile goods', '--after', 'Activity_PackItems', '--render', join(dir, 'region.png')]);
    expect(region.out).toMatch(/\n  note: the whole plane would be drawn at 0\.\d\d of its size: the image shows the region around the \d elements in focus/);
  });

  it('--render: a failed render is reported, the change stands; a bad file name is refused before anything runs', () => {
    const file = join(dir, 'o2c-fail.bpmn');
    copyFileSync(O2C, file);
    const blocker = join(dir, 'a-file');
    writeFileSync(blocker, 'x');
    const run = cli(['add', file, 'task', 'Check limit', '--after', 'Activity_CheckCredit', '--render', join(blocker, 'x.png')]);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/\nrender: failed E_IO: Cannot write /);
    expect(readFileSync(file, 'utf8')).toContain('Activity_CheckLimit');
    const bad = cli(['add', file, 'task', 'Other', '--after', 'Activity_CheckLimit', '--render', join(dir, 'x.jpg')]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('expected a file name ending in .png or .svg');
    expect(readFileSync(file, 'utf8')).not.toContain('Activity_Other');
  });
});

describe('the fuzz walk renders every result', () => {
  it('reports a render violation when the result does not render, and none when it does', async () => {
    const exec = libExecutor({ Doc, parseOps, mutateDoc, CliError });
    const metrics = { measure: (xml: string) => LayoutAnalysis.ofXml(xml), diff: diffProblems, hard: [] as string[] };
    const xml = readFileSync(O2C, 'utf8');
    const base = { xml, model: 'o2c', seed: 5, mode: 'auto', steps: 2, exec, metrics, detEvery: 0 };
    const failing = { draw: async (): Promise<never> => Promise.reject(new CliError('E_RENDER', 'The PNG rasteriser failed: unreachable', 'io')), maxSize: 2000 };
    const bad = await runWalk({ ...base, render: failing });
    expect(bad.ok).toBeGreaterThan(0);
    expect(bad.violations.filter((violation: { kind: string }) => violation.kind === 'render').map((violation: { severity: string; detail: string }) => [violation.severity, violation.detail])[0]).toEqual(['error', 'E_RENDER: The PNG rasteriser failed: unreachable']);
    const good = await runWalk({ ...base, render: { draw: (source: string) => renderPng(source, { problems: true, tiles: true }), maxSize: 2000 } });
    expect(good.violations.filter((violation: { kind: string }) => violation.kind === 'render')).toEqual([]);
  }, 60000);
});

