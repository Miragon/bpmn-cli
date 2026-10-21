/**
 * `bpmn render` after its verification (issue #12): broken or far-flung
 * coordinates are bounded (never an abort, never width="NaN"), --tiles keeps
 * only tiles with something in them and at most MAX_TILES, external labels
 * break like bpmn-js 18 (laid out at max(90, label width), then at their
 * widest line), message flows show their message, `-o` takes .png / .svg
 * only, a file without a diagram lists the problems `metrics` reports, a
 * scope on an empty plane is E_NO_MATCH, and the notes do not contradict
 * themselves. Synthetic models only.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/model/document.js';
import { layoutProblems } from '../src/diagram/metrics.js';
import { MAX_TILES, MIN_LABEL_SCALE, renderSvg, scaleText } from '../src/render/index.js';
import { textWidth } from '../src/diagram/text.js';
import { rasterize } from '../src/node/render.js';

const ROOT = join(import.meta.dirname, '..');
const GALLERY = join(ROOT, 'test', 'fixtures', 'render', 'gallery.bpmn');

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">`;

interface Node {
  id: string;
  kind?: 'startEvent' | 'task' | 'endEvent' | 'exclusiveGateway';
  name?: string;
  x: number | string;
  y: number | string;
  w?: number | string;
  h?: number | string;
  /** DI label bounds: x, y, width, height */
  label?: [number, number, number, number];
}

interface Flow {
  id: string;
  from: string;
  to: string;
  name?: string;
  points: Array<[number | string, number | string]>;
}

/** A process with these nodes and flows, drawn as given (any value goes into the DI as written). */
function model(nodes: Node[], flows: Flow[] = []): string {
  const size = (n: Node): [number | string, number | string] => [n.w ?? (n.kind === 'task' ? 100 : 36), n.h ?? (n.kind === 'task' ? 80 : 36)];
  const sem = nodes.map((n) => `    <bpmn:${n.kind ?? 'task'} id="${n.id}"${n.name ? ` name="${n.name}"` : ''} />`).join('\n');
  const sf = flows.map((f) => `    <bpmn:sequenceFlow id="${f.id}"${f.name ? ` name="${f.name}"` : ''} sourceRef="${f.from}" targetRef="${f.to}" />`).join('\n');
  const shapes = nodes
    .map((n) => {
      const [w, h] = size(n);
      const label = n.label ? `<bpmndi:BPMNLabel><dc:Bounds x="${n.label[0]}" y="${n.label[1]}" width="${n.label[2]}" height="${n.label[3]}" /></bpmndi:BPMNLabel>` : '';
      return `      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"><dc:Bounds x="${n.x}" y="${n.y}" width="${w}" height="${h}" />${label}</bpmndi:BPMNShape>`;
    })
    .join('\n');
  const edges = flows.map((f) => `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">${f.points.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('')}</bpmndi:BPMNEdge>`).join('\n');
  return `${HEAD}
  <bpmn:process id="Process_1" isExecutable="true">
${sem}
${sf}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
${shapes}
${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

const START: Node = { id: 'Event_Start', kind: 'startEvent', name: 'Start', x: 100, y: 100 };
const drawnIds = (svg: string): string[] => [...svg.matchAll(/<g data-id="([^"]+)"/g)].map((m) => m[1]!);

/** The tspans of a text element with this data attribute. */
function textOf(svg: string, attr: string, id: string): Array<{ x: number; y: number; text: string }> {
  const m = new RegExp(`<text ${attr}="${id}"[^>]*>(.*?)</text>`).exec(svg);
  if (!m) throw new Error(`no <text ${attr}="${id}">`);
  return [...m[1]!.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)">(.*?)<\/tspan>/g)].map((t) => ({ x: Number(t[1]), y: Number(t[2]), text: t[3]! }));
}

describe('broken and far-flung coordinates', () => {
  it('leaves out shapes and connections whose coordinates are not finite numbers within ±1,000,000 px, with a note', async () => {
    const nan = model([START, { id: 'Activity_Do', name: 'Do', x: 200, y: 78 }], [{ id: 'Flow_1', from: 'Event_Start', to: 'Activity_Do', points: [['NaN', 118], [200, 118]] }]);
    const r = await renderSvg(nan, { maxSize: 2000 });
    expect(r.svg).not.toContain('NaN');
    expect(Number.isFinite(r.width) && Number.isFinite(r.height) && Number.isFinite(r.tokens)).toBe(true);
    expect(drawnIds(r.svg).sort()).toEqual(['Activity_Do', 'Event_Start']);
    expect(r.notes).toContain('1 element has broken coordinates (not a number, beyond ±1,000,000 px, or a negative size) and is not drawn: Flow_1 (`bpmn layout <file>` draws it again)');
    // the PNG shows the start event and the task (not a blank image)
    const { pixels } = await rasterize(r.svg, { pixels: true });
    let dark = 0;
    for (let i = 0; i < pixels!.length; i += 4) if (pixels![i]! < 128) dark++;
    expect(dark).toBeGreaterThan(200);
    // overflowing (1e308), infinite and far (1e9) coordinates, a negative size, far label bounds
    for (const [task, points] of [
      [{ x: '1e308', w: '1e308' }, [[136, 118], [200, 118]]],
      [{ x: 'Infinity' }, [[136, 118], [200, 118]]],
      [{ x: 1e9, y: 1e9 }, [[136, 118], [1e9, 118], [1e9, 1e9]]],
      [{ w: -100, h: -80 }, [[136, 118], [200, 118]]],
    ] as Array<[Partial<Node>, Flow['points']]>) {
      const xml = model([START, { id: 'Activity_Do', name: 'Do', x: 200, y: 78, ...task }], [{ id: 'Flow_1', from: 'Event_Start', to: 'Activity_Do', points }]);
      const out = await renderSvg(xml, { maxSize: 2000, tiles: true });
      expect(out.svg, JSON.stringify(task)).not.toMatch(/NaN|Infinity|e\+/);
      expect(out.width * out.height, JSON.stringify(task)).toBeLessThan(400 * 400);
      expect(drawnIds(out.svg), JSON.stringify(task)).toContain('Event_Start');
      // (non-finite shape bounds were already "no shape"; the rest is broken geometry now)
      expect(out.notes.join('\n'), JSON.stringify(task)).toMatch(task.x === 'Infinity' ? /no shape and is not drawn: Activity_Do/ : /broken coordinates .* not drawn: Activity_Do/);
    }
    const far = await renderSvg(model([{ ...START, label: [5e6, 5e6, 90, 20] }, { id: 'Activity_Do', x: 200, y: 78 }]), { tiles: true, maxSize: 2000 });
    expect(far.notes).toContain('1 label has broken bounds and is not drawn: Event_Start (`bpmn label <file> <id> --side below` places it again)');
    expect(far.tiles).toBeUndefined();
  });

  it('is E_RENDER when nothing on the plane can be drawn', async () => {
    const xml = model([{ id: 'Activity_Do', x: 'NaN', y: 0 }, { id: 'Activity_Far', x: 2e6, y: 0 }]);
    await expect(renderSvg(xml)).rejects.toMatchObject({ code: 'E_RENDER', exitCode: 4 });
  });
});

describe('--tiles', () => {
  it('keeps only tiles with a shape or label in them, not those a long connection passes through', async () => {
    // a start event and a task 50,000 px apart, one flow between them (it was 676 tiles, 625 blank)
    const xml = model([START, { id: 'Activity_Far', name: 'Far away', x: 50000, y: 50000 }], [{ id: 'Flow_1', from: 'Event_Start', to: 'Activity_Far', points: [[136, 118], [50050, 118], [50050, 50000]] }]);
    const t0 = Date.now();
    const r = await renderSvg(xml, { maxSize: 2000, tiles: true });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.tiles!.length).toBe(2);
    expect(r.tiles!.map((t) => drawnIds(t.svg).filter((id) => id !== 'Flow_1'))).toEqual([['Event_Start'], ['Activity_Far']]);
    expect(r.tiles!.map((t) => t.band)).toEqual([1, 2]);
    expect(r.notes.join('\n')).toMatch(/split into 2 tiles \(2 bands\) at the diagram's columns .*; parts with no shape or label \(empty, or only connections passing through\) are left out/);
  });

  it(`makes at most ${MAX_TILES} tiles: a drawing that needs more stays one image, with a note`, async () => {
    // 60 tasks 2,500 px apart: each would be a tile of its own
    const nodes: Node[] = Array.from({ length: 60 }, (_, i) => ({ id: `Activity_${i + 1}`, name: `Task ${i + 1}`, x: i * 2500, y: 0 }));
    const r = await renderSvg(model(nodes), { maxSize: 2000, tiles: true });
    expect(r.tiles).toBeUndefined();
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2000);
    expect(r.notes).toContain(`--tiles: the drawing needs more than ${MAX_TILES} tiles at scale 1.00: it is drawn as one image instead`);
    expect(r.notes.join('\n')).toMatch(/hard to read\); render a part instead: --around <id> \[--depth n\], --path <from> <to> or --scope <id>$/m);
    // bounded work: shapes spread over the whole coordinate range, the smallest --max-size
    const spread: Node[] = Array.from({ length: 400 }, (_, i) => ({ id: `Activity_${i + 1}`, x: -999000 + i * 4990, y: -999000 + ((i * 7919) % 400) * 4990 }));
    const t0 = Date.now();
    const s = await renderSvg(model(spread), { maxSize: 50, scale: 10, tiles: true });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(s.tiles).toBeUndefined();
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(50);
  });

  it('numbers the bands among the tiles kept, and says how many there are', async () => {
    // two tasks 20,000 px apart vertically, nothing between them
    const r = await renderSvg(model([{ id: 'Activity_Top', name: 'Top', x: 100, y: 100 }, { id: 'Activity_Bottom', name: 'Bottom', x: 100, y: 20000 }]), { maxSize: 2000, tiles: true });
    expect(r.tiles!.map((t) => t.band)).toEqual([1, 2]);
    expect(r.notes.join('\n')).toMatch(/split into 2 tiles \(2 bands\)/);
  });
});

describe('notes', () => {
  it('print a scale rounded down, so a scale below 0.75 never reads 0.75', async () => {
    expect([0.7458, 0.75, 1, 0.29, 0.5104, 0.004].map(scaleText)).toEqual(['0.74', '0.75', '1.00', '0.29', '0.51', '0.004']);
    const xml = readFileSync(GALLERY, 'utf8');
    const whole = await renderSvg(xml);
    // a long edge of 0.7458 of the drawing's: drawn at a scale just below 0.75
    const r = await renderSvg(xml, { maxSize: Math.floor(Math.max(whole.width, whole.height) * 0.7458) });
    expect(r.scale).toBeLessThan(MIN_LABEL_SCALE);
    expect(r.scale).toBeGreaterThanOrEqual(0.745);
    expect(r.notes.join('\n')).toMatch(/the labels are drawn at 0\.74 of their size \(below 0\.75/);
  });
});

describe('labels like bpmn-js 18', () => {
  it('lay external labels out at max(90, label width), then again at their widest line', async () => {
    const xml = model([
      // label bounds 96 wide: one line (wrapped at 90 it would be two)
      { id: 'Event_Comp', kind: 'endEvent', name: 'Compensation end', x: 100, y: 100, label: [70, 143, 96, 14] },
      // two lines at 90, then the widest of them is too narrow for the first: three
      { id: 'Event_Rollback', kind: 'endEvent', name: 'Roll back bookings', x: 300, y: 100, label: [290, 143, 56, 27] },
      // no label bounds: below the shape, 90 px
      { id: 'Gateway_Kulanz', kind: 'exclusiveGateway', name: 'Kulanzentscheidung?', x: 500, y: 93, w: 50, h: 50, label: [470, 150, 110, 14] },
    ]);
    const { svg } = await renderSvg(xml);
    expect(textOf(svg, 'data-label', 'Event_Comp').map((l) => l.text)).toEqual(['Compensation end']);
    expect(textOf(svg, 'data-label', 'Event_Rollback').map((l) => l.text)).toEqual(['Roll', 'back', 'bookings']);
    expect(textOf(svg, 'data-label', 'Gateway_Kulanz').map((l) => l.text)).toEqual(['Kulanzentscheidung?']);
    // the lines stay centred on the label bounds, 13.2 px apart, the first baseline 9.9 px below their top
    expect(textOf(svg, 'data-label', 'Event_Rollback')).toEqual([
      { x: 318, y: 152.9, text: 'Roll' },
      { x: 318, y: 166.1, text: 'back' },
      { x: 318, y: 179.3, text: 'bookings' },
    ]);
  });
});

describe('message flows', () => {
  const collab = (visible = ''): string => `${HEAD}
  <bpmn:message id="Message_Order" name="Order details" />
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_Shop" name="Shop" processRef="Process_1" />
    <bpmn:participant id="Participant_Customer" name="Customer" />
    <bpmn:messageFlow id="Flow_Order" sourceRef="Participant_Customer" targetRef="Activity_Take" messageRef="Message_Order" />
    <bpmn:messageFlow id="Flow_Plain" sourceRef="Activity_Take" targetRef="Participant_Customer" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1"><bpmn:task id="Activity_Take" name="Take order" /></bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">
      <bpmndi:BPMNShape id="Participant_Shop_di" bpmnElement="Participant_Shop" isHorizontal="true"><dc:Bounds x="100" y="300" width="400" height="160" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Take_di" bpmnElement="Activity_Take"><dc:Bounds x="200" y="340" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Participant_Customer_di" bpmnElement="Participant_Customer" isHorizontal="true"><dc:Bounds x="100" y="60" width="400" height="60" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Order_di" bpmnElement="Flow_Order"${visible}><di:waypoint x="230" y="120" /><di:waypoint x="230" y="340" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Plain_di" bpmnElement="Flow_Plain"><di:waypoint x="270" y="340" /><di:waypoint x="270" y="120" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

  it('draw the envelope of their message halfway along them and its name below it', async () => {
    const { svg } = await renderSvg(collab());
    // halfway: (230, 230); the 21 x 14 envelope centred there, outlined (messageVisibleKind: the DI default "initiating")
    const flow = /<g data-id="Flow_Order">(.*?)<\/g>\n/.exec(svg)![1]!;
    expect(flow).toContain('<path data-message="Flow_Order" d="M219.5 223v14h21v-14ZL230 229L240.5 223" fill="#ffffff" stroke="#22242a"');
    // the name: 12 px in the flow's colour, where bpmn-js 18 puts it on import: its left edge at the middle, its top 10 px below
    const width = textWidth('Order details');
    expect(textOf(svg, 'data-message', 'Flow_Order')).toEqual([{ x: Math.round((230 + width / 2) * 100) / 100, y: 250.8, text: 'Order details' }]);
    expect(svg).toMatch(/<text data-message="Flow_Order" font-size="12" fill="#22242a"/);
    // a message flow without a message has neither
    expect(/<g data-id="Flow_Plain">(.*?)<\/g>\n/.exec(svg)![1]).not.toContain('data-message');
    // messageVisibleKind="non_initiating": filled
    const other = (await renderSvg(collab(' messageVisibleKind="non_initiating"'))).svg;
    expect(other).toContain('<path data-message="Flow_Order" d="M219.5 223v14h21v-14ZL230 229L240.5 223" fill="#22242a" stroke="#ffffff"');
  });
});

describe('a file without a diagram', () => {
  it('lists the problems `bpmn metrics` reports for the file, none in the image, and says so', async () => {
    const xml = readFileSync(join(ROOT, 'test', 'fixtures', 'views', 'claims.bpmn'), 'utf8');
    const metrics = layoutProblems((await Doc.fromXml(xml)).definitions).problems;
    expect(metrics.length).toBeGreaterThan(10);
    const r = await renderSvg(xml, { problems: true });
    expect(r.problems.map((p) => [p.kind, p.ids, p.detail])).toEqual(metrics.map((p) => [p.kind, p.ids, p.detail]));
    expect(r.problems.every((p) => !p.drawn)).toBe(true);
    expect(r.svg).not.toContain('data-problem');
    expect(r.notes).toContain("the problems are the file's (`bpmn metrics <file>`), not the in-memory drawing's: none is in the image");
  });
});

describe('bpmn render', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-render-fixes-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function cli(args: string[]): { code: number; out: string; err: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { cwd: ROOT, input: '', encoding: 'utf8' });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  }

  it('refuses an -o name that is not .png or .svg unless --format says what to write', () => {
    const jpg = cli(['render', GALLERY, '-o', join(dir, 'a.jpg')]);
    expect(jpg.code).toBe(1);
    expect(jpg.err).toContain('error E_USAGE: -o ');
    expect(jpg.err).toContain('expected a file name ending in .png or .svg');
    const forced = cli(['render', GALLERY, '-o', join(dir, 'a.jpg'), '--format', 'png']);
    expect(forced.code).toBe(0);
    expect(readFileSync(join(dir, 'a.jpg')).subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  it('a --scope on an empty plane is E_NO_MATCH; a --scope that is a plane lists its nodes', () => {
    const empty = cli(['render', GALLERY, '--scope', 'Activity_CollapsedSubProcess', '-o', join(dir, 'e.png')]);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain('error E_NO_MATCH: Nothing of --scope Activity_CollapsedSubProcess is drawn: the plane of Activity_CollapsedSubProcess is empty');
    const plane = cli(['render', join(ROOT, 'tools', 'scenarios', 'subproc__s03-collapsed.bpmn'), '--scope', 'Activity_Ship', '-o', join(dir, 's.png')]);
    expect(plane.code).toBe(0);
    expect(plane.out).toMatch(/\ncrop: scope Activity_Ship: [1-9]\d* nodes?\n/);
  });
});
