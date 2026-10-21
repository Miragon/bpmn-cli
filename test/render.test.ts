/**
 * `bpmn render` (issue #12): the SVG renderer of the core
 * (src/render/index.ts), the PNG rasteriser of the node layer
 * (src/node/render.ts: resvg-wasm with the bundled Arimo font) and the
 * command. Every scenario and fixture renders to SVG and PNG with the same
 * bytes twice; labels are laid out like bpmn-js; a rasteriser failure is
 * E_RENDER, never a process abort. The agent features (crops, halos,
 * numbered problems, tiles, `--render`) are tested in
 * test/render-agent.test.ts. Synthetic models only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIN_LABEL_SCALE, RENDER_MAX_SIZE, renderSvg } from '../src/render/index.js';
import { innerLines, wrapLines } from '../src/diagram/text.js';
import { CliError } from '../src/shared/errors.js';
import { rasterize, renderPng } from '../src/node/render.js';
// @ts-expect-error plain ESM tooling without type declarations
import { bundleCore } from '../tools/iso/bundle.mjs';

const ROOT = join(import.meta.dirname, '..');
const GALLERY = join(ROOT, 'test', 'fixtures', 'render', 'gallery.bpmn');

function bpmnFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...bpmnFiles(full));
    else if (name.endsWith('.bpmn')) out.push(full);
  }
  return out;
}

/** width and height from a PNG's IHDR chunk */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** The `<g data-id="id">` of an element (shape or connection). */
function group(svg: string, id: string): string {
  const m = new RegExp(`<g data-id="${id}">(.*?)</g>\\n`).exec(svg);
  if (!m) throw new Error(`no <g data-id="${id}"> in the SVG`);
  return m[1]!;
}

/** The tspans (x, y, text) of an element's external label. */
function labelOf(svg: string, id: string): Array<{ x: number; y: number; text: string }> {
  const m = new RegExp(`<text data-label="${id}"[^>]*>(.*?)</text>`).exec(svg);
  if (!m) throw new Error(`no label of ${id}`);
  return [...m[1]!.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)">(.*?)<\/tspan>/g)].map((t) => ({ x: Number(t[1]), y: Number(t[2]), text: t[3]! }));
}

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">`;

/** start (label bounds) -> gateway (no label bounds) -default "no"-> coloured task; a second task without a shape */
const LABELS = `${HEAD}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Event_Start" name="A rather long start event name that wraps"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?" default="Flow_No"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_No</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="Activity_Do" name="Do it"><bpmn:incoming>Flow_No</bpmn:incoming></bpmn:task>
    <bpmn:task id="Activity_Undrawn" name="Not drawn" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Event_Start" targetRef="Gateway_Ok" />
    <bpmn:sequenceFlow id="Flow_No" name="no" sourceRef="Gateway_Ok" targetRef="Activity_Do" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Event_Start_di" bpmnElement="Event_Start"><dc:Bounds x="100" y="100" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="73" y="143" width="90" height="40" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Ok_di" bpmnElement="Gateway_Ok" isMarkerVisible="true"><dc:Bounds x="200" y="93" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Do_di" bpmnElement="Activity_Do" bioc:stroke="#0d4372" bioc:fill="#bbdefb" color:background-color="#bbdefb" color:border-color="#0d4372"><dc:Bounds x="320" y="78" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="136" y="118" /><di:waypoint x="200" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_No_di" bpmnElement="Flow_No"><di:waypoint x="250" y="118" /><di:waypoint x="320" y="118" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

describe('every scenario and fixture renders', () => {
  const files = [...bpmnFiles(join(ROOT, 'tools', 'scenarios')), ...bpmnFiles(join(ROOT, 'test', 'fixtures'))];

  it('to SVG and PNG within the default size, the same bytes twice', async () => {
    expect(files.length).toBeGreaterThan(140);
    const stats = { files: 0, tokens: [] as number[] };
    for (const [i, file] of files.entries()) {
      const xml = readFileSync(file, 'utf8');
      const name = file.slice(ROOT.length + 1);
      const svg = await renderSvg(xml, { maxSize: RENDER_MAX_SIZE });
      expect(svg.svg, name).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="[^"]+" font-family="[^"]+">\n/);
      expect(Math.max(svg.width, svg.height), name).toBeLessThanOrEqual(RENDER_MAX_SIZE);
      expect((await renderSvg(xml, { maxSize: RENDER_MAX_SIZE })).svg, name).toBe(svg.svg);
      const png = await renderPng(xml);
      const image = png.images[0]!;
      expect(pngSize(image.png), name).toEqual({ width: svg.width, height: svg.height });
      expect({ width: image.width, height: image.height, tokens: image.tokens, scale: png.scale }, name).toEqual({ width: svg.width, height: svg.height, tokens: svg.tokens, scale: svg.scale });
      // the PNG bytes are deterministic too (every 10th file twice: the rasteriser is the slow part)
      if (i % 10 === 0) expect(Buffer.from((await renderPng(xml)).images[0]!.png).equals(Buffer.from(image.png)), name).toBe(true);
      // every other plane renders as well
      for (const plane of svg.planes) expect((await renderSvg(xml, { plane })).plane, `${name} ${plane}`).toBe(plane);
      stats.files++;
      stats.tokens.push(image.tokens);
    }
    expect(stats.files).toBe(files.length);
  }, 120000);
});

describe('the PNG rasteriser', () => {
  it('draws text with the bundled font only (no system font)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="30" font-family="Arial, Arimo, sans-serif"><rect width="200" height="30" fill="#fff"/><text x="10" y="20" font-size="12" fill="#000">Check invoice ÄÖÜ ß €</text></svg>';
    const { pixels, width, height } = await rasterize(svg, { pixels: true });
    expect({ width, height }).toEqual({ width: 200, height: 30 });
    let dark = 0;
    for (let i = 0; i < pixels!.length; i += 4) if (pixels![i]! < 128) dark++;
    expect(dark).toBeGreaterThan(150);
  });

  it('draws the names of a model: the same model without names has fewer dark pixels', async () => {
    const named = await renderSvg(LABELS);
    const unnamed = await renderSvg(LABELS.replace(/ name="[^"]*"/g, ''));
    const count = async (svg: string): Promise<number> => {
      const { pixels } = await rasterize(svg, { pixels: true });
      let dark = 0;
      for (let i = 0; i < pixels!.length; i += 4) if (pixels![i]! < 128) dark++;
      return dark;
    };
    expect(await count(named.svg)).toBeGreaterThan((await count(unnamed.svg)) + 200);
  });

  it('turns any failure into E_RENDER, never a process abort, and keeps working', async () => {
    // a marker-carrying path entirely outside the view makes resvg trap (the native build aborts the process here)
    const trap =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="1616 15 1080 345" width="1080" height="345"><defs><marker id="arrow" viewBox="0 0 20 20" refX="11" refY="10" markerWidth="10" markerHeight="10" orient="auto"><path d="M1 5 L11 10 L1 15 Z" fill="#22242a"/></marker></defs><rect x="1616" y="15" width="1080" height="345" fill="white"/><path d="M4836 120 L4896 120" fill="none" stroke="#22242a" stroke-width="2" marker-end="url(#arrow)"/></svg>';
    for (const svg of [trap, '<svg', 'not xml at all']) {
      const err = await rasterize(svg).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err, svg.slice(0, 20)).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('E_RENDER');
      expect((err as CliError).exitCode).toBe(4);
    }
    const after = await rasterize('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    expect(pngSize(after.png)).toEqual({ width: 10, height: 10 });
  });
});

describe('renderSvg', () => {
  it('lays out external labels like bpmn-js 18: label bounds, max(90, their width) in 11 px then the widest line, 13.2 px lines', async () => {
    const { svg } = await renderSvg(LABELS);
    // the start event: centred on its label bounds (x 73, width 90), top at y 143, first baseline 3/4 line lower
    // (more cases of the two passes: test/render-fixes.test.ts)
    const expected = ['A rather long', 'start event name', 'that wraps'];
    const start = labelOf(svg, 'Event_Start');
    expect(start.map((l) => l.text)).toEqual(expected);
    expect(start.map((l) => l.x)).toEqual(expected.map(() => 118));
    expect(start.map((l) => l.y)).toEqual(expected.map((_, i) => Math.round((143 + 9.9 + 13.2 * i) * 100) / 100));
    expect(svg).toMatch(/<text data-label="Event_Start" font-size="11"/);
    // the gateway has no label bounds: below the shape
    expect(labelOf(svg, 'Gateway_Ok')).toEqual([{ x: 225, y: 152.9, text: 'Ok?' }]);
    // the flow has none either: the middle of its middle segment, 15 px above it
    expect(labelOf(svg, 'Flow_No')).toEqual([{ x: 285, y: 102.9, text: 'no' }]);
    // an embedded label: 12 px, centred in the task
    expect(group(svg, 'Activity_Do')).toMatch(/<text font-size="12" fill="#0d4372" text-anchor="middle"><tspan x="370" y="[\d.]+">Do it<\/tspan><\/text>/);
  });

  it('draws markers and colours, and keeps unsafe colour values out of the SVG', async () => {
    const { svg } = await renderSvg(LABELS);
    expect(group(svg, 'Activity_Do')).toContain('fill="#bbdefb" stroke="#0d4372"');
    // the exclusive gateway's X (isMarkerVisible) and the default flow's slash
    expect(group(svg, 'Gateway_Ok')).toContain('stroke-width="4.5"');
    expect(group(svg, 'Flow_No').match(/<path /g)).toHaveLength(3); // line, arrow head, slash
    expect(group(svg, 'Flow_1').match(/<path /g)).toHaveLength(2);
    const hostile = LABELS.replace('bioc:fill="#bbdefb" color:background-color="#bbdefb"', 'bioc:fill="red&quot; onload=&quot;x" color:background-color="url(javascript:x)"');
    const safe = (await renderSvg(hostile)).svg;
    expect(safe).not.toContain('onload');
    expect(safe).not.toContain('javascript');
    expect(group(safe, 'Activity_Do')).toContain('fill="#ffffff" stroke="#0d4372"');
  });

  it('names the plane, the other planes and the elements without a shape', async () => {
    const r = await renderSvg(LABELS);
    expect(r.plane).toBe('Process_1');
    expect(r.planes).toEqual([]);
    expect(r.notes).toEqual(['1 element has no shape and is not drawn: Activity_Undrawn (`bpmn layout <file>` draws it)']);
    const gallery = readFileSync(GALLERY, 'utf8');
    const main = await renderSvg(gallery);
    expect(main.plane).toBe('Collaboration_RenderGallery');
    expect(main.planes).toEqual(['Activity_CollapsedSubProcess', 'Activity_AdHocSubProcess']);
    const sub = await renderSvg(gallery, { plane: 'Activity_AdHocSubProcess' });
    expect(sub.planes).toEqual(['Collaboration_RenderGallery', 'Activity_CollapsedSubProcess']);
    await expect(renderSvg(gallery, { plane: 'Activity_Nope' })).rejects.toMatchObject({ code: 'E_NOT_FOUND', details: { candidates: ['Collaboration_RenderGallery', 'Activity_CollapsedSubProcess', 'Activity_AdHocSubProcess'] } });
    await expect(renderSvg(gallery, { plane: 'Activity_ExpandedSubProcess' })).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
  });

  it('draws every element of the gallery plane, each kind with its glyph', async () => {
    const xml = readFileSync(GALLERY, 'utf8');
    const { svg } = await renderSvg(xml);
    const shapes = [...xml.matchAll(/<bpmndi:BPMN(?:Shape|Edge) id="[^"]+" bpmnElement="([^"]+)"/g)].map((m) => m[1]!);
    const main = xml.slice(0, xml.indexOf('<bpmndi:BPMNPlane id="BPMNPlane_Activity_CollapsedSubProcess"'));
    for (const id of shapes.filter((s) => main.includes(`bpmnElement="${s}"`))) expect(svg, id).toContain(`<g data-id="${id}">`);
    // a few glyphs: the call activity's thick border, the transaction's double border, the event sub-process's dots, the data store's ellipse
    expect(group(svg, 'Activity_CallActivity')).toContain('stroke-width="5"');
    expect(group(svg, 'Activity_Transaction').match(/<rect /g)).toHaveLength(2);
    expect(group(svg, 'Activity_EventSubProcess')).toContain('stroke-dasharray="1 4"');
    expect(group(svg, 'DataStoreReference_Customers')).toContain('<ellipse ');
    expect(group(svg, 'Event_Escalated')).toContain('stroke-dasharray="5.5 3"'); // non-interrupting
    expect(group(svg, 'Flow_SendTaskToPartner')).toContain('stroke-dasharray="10 6"');
    expect(group(svg, 'Participant_Partner')).not.toContain('<path'); // a black box: no header line
  });

  it('caps the long edge at maxSize and says when labels get too small', async () => {
    const xml = readFileSync(GALLERY, 'utf8');
    const full = await renderSvg(xml);
    expect(full.scale).toBe(1);
    const capped = await renderSvg(xml, { maxSize: 500 });
    expect(Math.max(capped.width, capped.height)).toBe(500);
    expect(capped.scale).toBeLessThan(MIN_LABEL_SCALE);
    expect(capped.tokens).toBe(Math.round((capped.width * capped.height) / 784));
    expect(capped.notes.join('\n')).toMatch(/below 0\.75: hard to read\); render a part instead: --around <id> \[--depth n\], --path <from> <to> or --tiles/);
    const zoomed = await renderSvg(xml, { scale: 0.5 });
    expect(zoomed.width).toBe(Math.round(full.width / 2));
  });

  it('lays out a file without a diagram in memory and says so', async () => {
    const xml = readFileSync(join(ROOT, 'test', 'fixtures', 'views', 'claims.bpmn'), 'utf8');
    expect(xml).not.toContain('BPMNDiagram');
    const r = await renderSvg(xml);
    expect(r.notes[0]).toMatch(/^the file has no diagram: it is drawn by the layout engine in memory/);
    expect(r.svg).toContain('<g data-id="');
  });

  it('wraps lines like innerLines counts them', () => {
    for (const name of ['Check invoice', 'A very long activity name with many words in it', 'Line\nbreak', 'Supercalifragilisticexpialidocious-task']) {
      for (const width of [100, 120, 200]) expect(wrapLines(name, width - 14).length, `${name} ${width}`).toBe(innerLines(name, width));
    }
  });

  it('is not part of an applyToXml-only bundle', async () => {
    const lean = await bundleCore({ stdin: { contents: "export { applyToXml } from './src/index.ts';", sourcefile: 'apply-only.ts' }, minify: false });
    // esbuild lists every module it reached; the output chunk lists only those that contribute code
    expect(lean.chunks.flatMap((c: { inputs: string[] }) => c.inputs).filter((f: string) => /render/.test(f))).toEqual([]);
    // (not vacuous: an entry that imports renderSvg has it)
    const render = await bundleCore({ stdin: { contents: "export { renderSvg } from './src/index.ts';", sourcefile: 'render-only.ts' }, minify: false });
    expect(render.chunks.flatMap((c: { inputs: string[] }) => c.inputs)).toContain('src/render/index.ts');
  }, 60000);
});

describe('bpmn render', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-render-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function cli(args: string[], env: Record<string, string> = {}): { code: number; out: Buffer; err: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { cwd: ROOT, input: '', env: { ...process.env, ...env } });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr.toString('utf8') };
  }

  it('writes a PNG to -o and prints the size, the image tokens and the other planes', () => {
    const out = join(dir, 'gallery.png');
    const r = cli(['render', GALLERY, '-o', out]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const { width, height } = pngSize(readFileSync(out));
    const text = r.out.toString('utf8');
    expect(text).toMatch(new RegExp(`^wrote ${out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}  ${width}x${height} px  ~[\\d,]+ image tokens  scale [\\d.]+  plane Collaboration_RenderGallery\\n`));
    expect(text).toContain('other planes (--plane <id>): Activity_CollapsedSubProcess, Activity_AdHocSubProcess\n');
  });

  it('defaults to bpmn-cli/<name>.png in the temp directory; --json reports it', () => {
    const r = cli(['render', GALLERY, '--json'], { TMPDIR: dir, TMP: dir, TEMP: dir });
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out.toString('utf8'));
    expect(json).toMatchObject({ file: GALLERY, out: join(dir, 'bpmn-cli', 'gallery.png'), format: 'png', plane: 'Collaboration_RenderGallery', planes: ['Activity_CollapsedSubProcess', 'Activity_AdHocSubProcess'] });
    expect(existsSync(json.out)).toBe(true);
    expect(pngSize(readFileSync(json.out))).toEqual({ width: json.width, height: json.height });
    expect(json.tokens).toBe(Math.round((json.width * json.height) / 784));
  });

  it('writes SVG or PNG to stdout with -o - (the report on stderr), and the SVG format from the extension', () => {
    const svg = cli(['render', GALLERY, '-o', '-', '--format', 'svg']);
    expect(svg.code).toBe(0);
    expect(svg.out.toString('utf8')).toMatch(/^<svg /);
    expect(svg.err).toMatch(/^wrote <stdout>  \d+x\d+ px/);
    const png = cli(['render', GALLERY, '-o', '-']);
    expect(png.code).toBe(0);
    expect(pngSize(png.out).width).toBeGreaterThan(100);
    const file = join(dir, 'plane.svg');
    const plane = cli(['render', GALLERY, '-o', file, '--plane', 'Activity_AdHocSubProcess']);
    expect(plane.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toMatch(/^<svg /);
    expect(plane.out.toString('utf8')).toContain('plane Activity_AdHocSubProcess');
  });

  it('notes labels below the minimum scale, naming the crop options', () => {
    const r = cli(['render', GALLERY, '-o', join(dir, 'small.png'), '--max-size', '500']);
    expect(r.code).toBe(0);
    expect(r.out.toString('utf8')).toMatch(/\nnote: the labels are drawn at 0\.\d\d of their size \(below 0\.75: hard to read\); render a part instead: --around <id> \[--depth n\], --path <from> <to> or --tiles\n/);
  });

  it('refuses bad options and unknown planes with the usual codes', () => {
    const mismatch = cli(['render', GALLERY, '-o', join(dir, 'x.svg'), '--format', 'png']);
    expect(mismatch.code).toBe(1);
    expect(mismatch.err).toContain('error E_USAGE: --format png does not match the file name');
    expect(cli(['render', GALLERY, '--scale', '0']).code).toBe(1);
    expect(cli(['render', GALLERY, '--max-size', 'big']).code).toBe(1);
    const plane = cli(['render', GALLERY, '--plane', 'Activity_Nope', '--json']);
    expect(plane.code).toBe(2);
    expect(JSON.parse(plane.err)).toMatchObject({ ok: false, error: { code: 'E_NOT_FOUND', candidates: ['Collaboration_RenderGallery', 'Activity_CollapsedSubProcess', 'Activity_AdHocSubProcess'] } });
    const missing = cli(['render', join(dir, 'missing.bpmn')]);
    expect(missing.code).toBe(4);
    expect(missing.err).toContain('E_FILE_NOT_FOUND');
    writeFileSync(join(dir, 'broken.bpmn'), '<bpmn:definitions');
    expect(cli(['render', join(dir, 'broken.bpmn')]).err).toContain('E_PARSE');
  });
});
