/**
 * `bpmn render` for agents (issue #12, stage 2): crops (--around draws
 * exactly the nodes of show --around, --path, --scope, ids), halos,
 * numbered layout problems at their location (metrics.ts locateProblems,
 * each badge inside its elements' bounding box, listed in metrics order),
 * tiles cut at the diagram's columns, `--render` on mutating commands and
 * the fuzz walk's render oracle. Synthetic models only.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aroundView } from '../src/query/context.js';
import { Doc } from '../src/model/Doc.js';
import { layoutProblems, locateProblems, type LayoutProblem } from '../src/diagram/metrics.js';
import { readPlanes, type Plane } from '../src/diagram/plane.js';
import { changeHighlight, HALO_COLORS, MIN_LABEL_SCALE, renderDocSvg, renderSvg } from '../src/render/index.js';
import { pathOf } from '../src/query/select.js';
import { CliError, parseOps, mutateDoc } from '../src/index.js';
import { is } from '../src/model/utils/moddle.js';
import { renderPng } from '../src/node/render.js';
import { mutationReport } from '../src/report/command-report.js';
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
  const add = (b: Box): void => {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  };
  for (const id of ids) {
    const s = plane.shapes.get(id);
    if (s) [s.bounds, s.label].forEach((b) => b && add(b));
    const e = plane.edges.get(id);
    if (e) {
      for (const p of e.points) add({ x: p.x, y: p.y, width: 0, height: 0 });
      if (e.label) add(e.label);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
}

const inBox = (b: Box, p: { x: number; y: number }): boolean => p.x >= b.x - 0.01 && p.x <= b.x + b.width + 0.01 && p.y >= b.y - 0.01 && p.y <= b.y + b.height + 0.01;

/** The ids drawn in full (`<g data-id>`), the faded connections and the context frames of an SVG. */
function drawnIds(svg: string, attr = 'data-id'): string[] {
  return [...svg.matchAll(new RegExp(`<g ${attr}="([^"]+)"`, 'g'))].map((m) => m[1]!);
}

/** The badges of an SVG: number -> centre. */
function badgesOf(svg: string): Map<number, { x: number; y: number }> {
  return new Map([...svg.matchAll(/<g data-problem="(\d+)"><circle cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => [Number(m[1]), { x: Number(m[2]), y: Number(m[3]) }]));
}

const shown = (p: LayoutProblem): string => `${p.kind} ${p.ids.join(',')}${p.detail ? ` ${p.detail}` : ''}`;

describe('locateProblems', () => {
  const files = [...bpmnFiles(SCENARIOS), ...bpmnFiles(join(ROOT, 'test', 'fixtures'))];

  it('puts every drawn problem inside the bounding box of its elements, on its plane; layoutProblems stays as it was', async () => {
    let located = 0;
    for (const file of files) {
      const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
      const defs = doc.definitions;
      const problems = layoutProblems(defs).problems;
      for (const p of problems) expect(p, file).not.toHaveProperty('at');
      const planes = readPlanes(defs);
      const out = locateProblems(defs, problems);
      expect(out.map(({ at: _, ...p }) => p), file).toEqual(problems);
      for (const p of out) {
        const plane = planes.find((x) => x.shapes.has(p.ids[0] ?? '') || x.edges.has(p.ids[0] ?? ''));
        if (p.kind === 'missing' || p.kind === 'failed' || !plane) {
          if (p.kind === 'missing' || p.kind === 'failed') expect(p.at, `${file} ${shown(p)}`).toBeUndefined();
          continue;
        }
        // every problem on a plane has a place (degenerate edges without waypoints aside)
        if (p.kind !== 'degenerateEdge') expect(p.at, `${file} ${shown(p)}`).toBeDefined();
        if (!p.at) continue;
        located++;
        expect(p.at.plane, `${file} ${shown(p)}`).toBe(plane.rootId);
        expect(inBox(problemBox(plane, p.ids)!, p.at), `${file} ${shown(p)} at ${p.at.x},${p.at.y}`).toBe(true);
      }
    }
    expect(located).toBeGreaterThan(300);
  }, 60000);

  it('locates each kind on the defect: a crossing at the crossing point, an overlap in the overlap', async () => {
    const doc = await Doc.fromXml(readFileSync(O2C, 'utf8'));
    const out = locateProblems(doc.definitions, layoutProblems(doc.definitions).problems);
    const crossing = out.find((p) => p.kind === 'crossings')!;
    expect(crossing.ids).toEqual(['Flow_6', 'Flow_21']);
    const plane = readPlanes(doc.definitions)[0]!;
    // the crossing point lies on both flows
    const onFlow = (id: string): boolean =>
      plane.edges.get(id)!.points.some((a, i, pts) => {
        const b = pts[i + 1];
        return !!b && Math.abs((b.x - a.x) * (crossing.at!.y - a.y) - (b.y - a.y) * (crossing.at!.x - a.x)) < 1 && inBox({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }, crossing.at!);
      });
    expect(onFlow('Flow_6') && onFlow('Flow_21')).toBe(true);
  });
});

describe('--problems', () => {
  it('lists every metrics problem once, in metrics order with the same ids, each badge inside its elements', async () => {
    let badges = 0;
    for (const file of [...bpmnFiles(SCENARIOS), GALLERY, LONG]) {
      const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
      if (!readPlanes(doc.definitions).length) continue;
      const metrics = layoutProblems(doc.definitions).problems;
      const r = renderDocSvg(doc, { maxSize: 2000, problems: true });
      expect(r.problems.map((p) => `${p.n} ${shown(p)}`), file).toEqual(metrics.map((p, i) => `${i + 1} ${shown(p)}`));
      const plane = readPlanes(doc.definitions).find((p) => p.rootId === r.plane)!;
      const drawn = badgesOf(r.svg);
      expect([...drawn.keys()].sort((a, b) => a - b), file).toEqual(r.problems.filter((p) => p.drawn).map((p) => p.n));
      for (const p of r.problems.filter((x) => x.drawn)) {
        expect(inBox(problemBox(plane, p.ids)!, drawn.get(p.n)!), `${file} ${p.n} ${shown(p)}`).toBe(true);
        badges++;
      }
    }
    expect(badges).toBeGreaterThan(200);
  }, 60000);

  it('moves a badge that would cover an earlier one aside, still inside its elements', async () => {
    const r = await renderSvg(readFileSync(O2C, 'utf8'), { problems: true });
    const spots = [...badgesOf(r.svg).values()];
    for (const [i, a] of spots.entries()) for (const b of spots.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(17.9);
  });

  it('a list of problems: exactly those, numbered in its order; a problem on another plane is listed, not drawn', async () => {
    const xml = readFileSync(O2C, 'utf8');
    const doc = await Doc.fromXml(xml);
    const all = layoutProblems(doc.definitions).problems;
    const asked = [all[3]!, all[0]!];
    const r = await renderSvg(xml, { problems: asked });
    expect(r.problems.map((p) => [p.n, p.kind, p.ids])).toEqual([
      [1, asked[0]!.kind, asked[0]!.ids],
      [2, asked[1]!.kind, asked[1]!.ids],
    ]);
    expect([...badgesOf(r.svg).keys()]).toEqual([1, 2]);
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
      const planes = readPlanes(doc.definitions);
      if (!planes.length) continue;
      const nodes = [...doc.byId().values()].filter((el) => is(el, 'bpmn:FlowNode') && planes.some((p) => p.shapes.has(el.get<string>('id'))));
      for (const [i, node] of nodes.entries()) {
        const id = node.get<string>('id');
        const r = renderDocSvg(doc, { maxSize: 2000, around: { id, depth: 2 } });
        tokens.push(r.tokens);
        if (i % 4) continue; // the node set of every 4th node (the renders above cover every node)
        const plane = planes.find((p) => p.rootId === r.plane)!;
        const window = aroundView(doc, id, { depth: 2 }).nodes.map((n) => n.id).filter((n) => plane.shapes.has(n));
        const flowNodes = drawnIds(r.svg).filter((x) => plane.shapes.has(x) && is(plane.shapes.get(x)!.el, 'bpmn:FlowNode'));
        expect(new Set(flowNodes), `${file} --around ${id}`).toEqual(new Set(window));
        expect(r.nodes, `${file} --around ${id}`).toEqual(window);
      }
    }
    tokens.sort((a, b) => a - b);
    const median = tokens[Math.floor(tokens.length / 2)]!;
    expect(tokens.length).toBeGreaterThan(1500);
    expect(median).toBeLessThanOrEqual(1000);
  }, 60000);

  it('--around: the connections between the nodes in full, the rest faded, frames as context; --depth and --inner as in show', async () => {
    const xml = readFileSync(O2C, 'utf8');
    const r = await renderSvg(xml, { around: { id: 'Gateway_OrderValid', depth: 1 } });
    expect(r.nodes).toEqual(['Activity_ValidateOrder', 'Gateway_OrderValid', 'Activity_CheckCredit', 'Event_OrderRejected']);
    expect(drawnIds(r.svg).sort()).toEqual(['Activity_CheckCredit', 'Activity_ValidateOrder', 'Event_OrderRejected', 'Flow_2', 'Flow_3', 'Flow_4', 'Gateway_OrderValid'].sort());
    expect(drawnIds(r.svg, 'data-faded')).toEqual(expect.arrayContaining(['Flow_1', 'Flow_5']));
    expect(drawnIds(r.svg, 'data-context')).toEqual(expect.arrayContaining(['Lane_Sales', 'Lane_Finance']));
    // the image fits the nodes, not the whole drawing
    const whole = await renderSvg(xml);
    expect(r.width).toBeLessThan(whole.width / 2);
    const deeper = await renderSvg(xml, { around: { id: 'Gateway_OrderValid', depth: 3 } });
    expect(deeper.nodes!.length).toBeGreaterThan(r.nodes!.length);
  });

  it('--path draws the nodes and flows of the path; --scope a pool, lane or sub-process with what lies inside; ids exactly these', async () => {
    const xml = readFileSync(O2C, 'utf8');
    const doc = await Doc.fromXml(xml);
    const path = await renderSvg(xml, { path: { from: 'Event_OrderReceived', to: 'Event_OrderCompleted' } });
    const expected = pathOf(doc, 'Event_OrderReceived', 'Event_OrderCompleted').map((el) => el.get<string>('id'));
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
    const r = await renderSvg(xml, { highlight: { created: ['Activity_CheckCredit'], changed: ['Activity_CheckCredit', 'Flow_5'], moved: ['Gateway_CreditOk', 'Lane_Finance'] } });
    const svg = r.svg;
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
    const h = changeHighlight(mutationReport(result));
    expect(h.created).toEqual(expect.arrayContaining(['Activity_ApproveCredit', 'Flow_ApproveCreditToCreditOk']));
    expect(h.changed).toEqual(expect.arrayContaining(['Flow_5', 'Activity_ShipGoods']));
    expect(h.changed).not.toContain('Activity_ApproveCredit');
    expect(h.moved).toContain('Gateway_CreditOk');
    for (const id of h.moved) expect([...h.created, ...h.changed]).not.toContain(id);
  });
});

describe('tiles', () => {
  it('splits an unreadable image at the diagram columns into readable tiles within --max-size, every column once', async () => {
    const xml = readFileSync(LONG, 'utf8');
    const whole = await renderSvg(xml, { maxSize: 2000 });
    expect(whole.scale).toBeLessThan(MIN_LABEL_SCALE);
    const r = await renderSvg(xml, { maxSize: 2000, tiles: true, problems: true });
    expect(r.tiles!.length).toBeGreaterThanOrEqual(2);
    expect(r.scale).toBe(1);
    let next = 0;
    for (const t of r.tiles!) {
      expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(2000);
      expect(t.tokens).toBe(Math.round((t.width * t.height) / 784));
      expect(t.columns![0]).toBe(next);
      next = t.columns![1] + 1;
    }
    const doc = await Doc.fromXml(xml);
    const columns = (await import('../src/query/layout-view.js')).layoutView(doc.definitions).diagrams[0]!.columns;
    expect(next).toBe(columns);
    expect(r.svg).toBe(r.tiles![0]!.svg);
    expect(r.notes.join('\n')).toMatch(new RegExp(`split into ${r.tiles!.length} tiles at the diagram's columns`));
    expect(r.notes.join('\n')).not.toMatch(/hard to read/);
    // every node lies in exactly one tile (the tiles cut between columns)
    for (const id of [...doc.byId().keys()].filter((k) => k.startsWith('Activity_'))) {
      expect(r.tiles!.filter((t) => t.svg.includes(`<g data-id="${id}">`)).length, id).toBe(1);
    }
    const png = await renderPng(xml, { tiles: true });
    expect(png.images.map((i) => [i.width, i.height, i.columns])).toEqual(r.tiles!.map((t) => [t.width, t.height, t.columns]));
  });

  it('splits a tall drawing into bands too; a readable image stays one, with a note', async () => {
    const gallery = readFileSync(GALLERY, 'utf8');
    const r = await renderSvg(gallery, { maxSize: 600, tiles: true, problems: true });
    expect(r.tiles!.some((t) => (t.band ?? 1) > 1)).toBe(true);
    for (const t of r.tiles!) expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(600);
    for (const p of r.problems.filter((x) => x.drawn)) expect(r.tiles![p.tile! - 1]!.svg).toContain(`<g data-problem="${p.n}">`);
    const small = await renderSvg(readFileSync(O2C, 'utf8'), { tiles: true });
    expect(small.tiles).toBeUndefined();
    expect(small.notes).toContain('--tiles: the image is readable as one (scale 1.00); no tiles');
  });
});

describe('focus', () => {
  it('draws the whole plane when it is readable, else the region around the focus elements and their neighbours', async () => {
    const xml = readFileSync(LONG, 'utf8');
    const r = await renderSvg(xml, { maxSize: 2000, focus: ['Activity_PackItems'] });
    expect(r.scale).toBe(1);
    expect(r.notes.join('\n')).toMatch(/the image shows the region around the 1 element in focus/);
    for (const id of ['Activity_PickItems', 'Activity_PackItems', 'Activity_WeighParcel']) expect(drawnIds(r.svg)).toContain(id);
    expect(drawnIds(r.svg)).not.toContain('Activity_ReceiveOrder');
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
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { cwd: ROOT, input: '', encoding: 'utf8' });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  }

  it('render --around --problems --highlight: the crop line, the halo legend and the numbered problems', () => {
    const out = join(dir, 'around.png');
    const r = cli(['render', O2C, '--around', 'Gateway_OrderValid', '--depth', '2', '--problems', '--highlight', 'Gateway_OrderValid', '-o', out]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(r.out).toMatch(/^wrote \S+around\.png  \d+x\d+ px  ~\d+ image tokens  scale 1\.00  plane Process_OrderToCash\n/);
    expect(r.out).toContain('\ncrop: around Gateway_OrderValid (depth 2): 7 nodes\n');
    expect(r.out).toContain('\nhalos: orange --highlight\n');
    expect(r.out).toContain('\nproblems (numbered in the image):\n  1 crossings [Flow_6, Flow_21]\n');
    const json = JSON.parse(cli(['render', O2C, '--path', 'Event_OrderReceived', 'Gateway_OrderValid', '--json', '-o', join(dir, 'path.svg')]).out);
    expect(json).toMatchObject({ format: 'svg', nodes: ['Event_OrderReceived', 'Activity_ValidateOrder', 'Gateway_OrderValid'], problems: [] });
    const ids = cli(['render', O2C, 'Activity_CheckCredit', 'Gateway_CreditOk', '--json', '-o', join(dir, 'ids.png')]);
    expect(JSON.parse(ids.out).nodes).toEqual(['Activity_CheckCredit', 'Gateway_CreditOk']);
  });

  it('render --tiles writes <name>-1.png, <name>-2.png, ... and a line per tile', () => {
    const r = cli(['render', LONG, '--tiles', '-o', join(dir, 'long.png')]);
    expect(r.code).toBe(0);
    const lines = r.out.split('\n').filter((l) => l.startsWith('wrote '));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    lines.forEach((l, i) => expect(l).toMatch(new RegExp(`^wrote \\S+long-${i + 1}\\.png  \\d+x\\d+ px  ~[\\d,]+ image tokens  scale 1\\.00  plane Process_LongOrder  tile ${i + 1}/${lines.length} c\\d+-c\\d+$`)));
    for (const i of lines.keys()) expect(existsSync(join(dir, `long-${i + 1}.png`))).toBe(true);
    expect(r.out).toMatch(new RegExp(`\\n${lines.length} tiles, ~[\\d,]+ image tokens in all\\n`));
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
    const r = cli(['add', file, 'userTask', 'Approve credit', '--after', 'Activity_CheckCredit', '--render', png]);
    expect(r.code).toBe(0);
    expect(existsSync(png)).toBe(true);
    expect(r.out).toMatch(/\nrender: wrote \S+change\.png  \d+x\d+ px  ~[\d,]+ image tokens  scale [\d.]+  plane Process_OrderToCash\n  halos: green created, orange changed, blue moved\n  layout problems the change added: none\n?/);
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
    const r = cli(['add', file, 'task', 'Check limit', '--after', 'Activity_CheckCredit', '--render', join(blocker, 'x.png')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\nrender: failed E_IO: Cannot write /);
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
    const metrics = { measure: (await import('../src/diagram/metrics.js')).layoutProblemsOfXml, diff: (await import('../src/diagram/metrics.js')).diffProblems, hard: [] as string[] };
    const xml = readFileSync(O2C, 'utf8');
    const base = { xml, model: 'o2c', seed: 5, mode: 'auto', steps: 2, exec, metrics, detEvery: 0 };
    const failing = { draw: async (): Promise<never> => Promise.reject(new CliError('E_RENDER', 'The PNG rasteriser failed: unreachable', 'io')), maxSize: 2000 };
    const bad = await runWalk({ ...base, render: failing });
    expect(bad.ok).toBeGreaterThan(0);
    expect(bad.violations.filter((v: { kind: string }) => v.kind === 'render').map((v: { severity: string; detail: string }) => [v.severity, v.detail])[0]).toEqual(['error', 'E_RENDER: The PNG rasteriser failed: unreachable']);
    const good = await runWalk({ ...base, render: { draw: (x: string) => renderPng(x, { problems: true, tiles: true }), maxSize: 2000 } });
    expect(good.violations.filter((v: { kind: string }) => v.kind === 'render')).toEqual([]);
  }, 60000);
});

