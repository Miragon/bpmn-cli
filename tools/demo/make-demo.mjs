#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { CLI_ENV } from '../fuzz/lib/setup.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const GIF = join(REPO, 'docs/assets/demo.gif');
const GEIST = 'https://raw.githubusercontent.com/vercel/geist-font/main/fonts';
const GEIST_FILES = ['Geist/ttf/Geist-Regular.ttf', 'Geist/ttf/Geist-Medium.ttf', 'GeistMono/ttf/GeistMono-Regular.ttf', 'GeistMono/ttf/GeistMono-Medium.ttf'];

const MIRAGON = { blue: '#335DE5', blueSoft: '#EEF1FD', green: '#00E676', amber: '#FFB000', grey: '#F9F7F7', black: '#1D1D1D', white: '#FFFFFF', line: '#E7E4E4', mutedOnLight: '#6F6F6F', mutedOnDark: '#BBBBBB', lineOnDark: '#464646' };
const CLI_HALO = { created: '#2f9e44', changed: '#f76707' };

const FPS = 20;
const CANVAS = { width: 1200, height: 700 };
const WINDOW = { x: 40, y: 34, width: 1120, height: 632, radius: 16 };
const HEADER_HEIGHT = 54;
const TERMINAL_HEIGHT = 216;
const DIAGRAM_PANE = { y: WINDOW.y + HEADER_HEIGHT, height: WINDOW.height - HEADER_HEIGHT - TERMINAL_HEIGHT };
const TERMINAL = { y: DIAGRAM_PANE.y + DIAGRAM_PANE.height, textX: WINDOW.x + 32, fontSize: 17, lineHeight: 30 };
const MONO_ADVANCE = 0.6;
const DIAGRAM_SCALE = 1.7;
const TYPED_CHARS_PER_FRAME = 2;
const CROSSFADE_FRAMES = 8;
const ADD_APPROVAL = ['add', 'order.bpmn', 'userTask', 'Approve invoice', '--after', 'Activity_CheckInvoice'];

const work = mkdtempSync(join(tmpdir(), 'bpmn-demo-'));
const bpmn = (...args) => execFileSync(join(REPO, 'bin/bpmn.js'), args, { cwd: work, encoding: 'utf8', env: CLI_ENV });
const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shellQuoted = (arg) => (arg.includes(' ') ? `"${arg}"` : arg);
const seconds = (n) => Math.round(n * FPS);
const repeated = (scene, count) => Array.from({ length: count }, () => scene);

function diagramSize(svg) {
  const [, width, height] = /<svg[^>]* width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  return { width: width * DIAGRAM_SCALE, height: height * DIAGRAM_SCALE };
}

function placedDiagram(file, left) {
  const svg = readFileSync(join(work, file), 'utf8')
    .replaceAll(CLI_HALO.created, MIRAGON.green)
    .replaceAll(CLI_HALO.changed, MIRAGON.amber)
    .replace(/<rect [^>]*fill="#ffffff"\/>/, '');
  const { width, height } = diagramSize(svg);
  const y = DIAGRAM_PANE.y + (DIAGRAM_PANE.height - height) / 2;
  return svg.replace(/ width="[\d.]+" height="[\d.]+"/, ` x="${left}" y="${y}" width="${width}" height="${height}"`);
}

function windowChrome() {
  const { x, y, width, height, radius } = WINDOW;
  const headerBase = y + 33;
  const dots = [0, 1, 2].map((i) => `<circle cx="${x + 28 + i * 20}" cy="${y + HEADER_HEIGHT / 2}" r="6" fill="${MIRAGON.line}"/>`).join('');
  const pill = { width: 108, height: 28, x: x + width - 132, y: y + 13 };
  return `<defs>
<filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="${MIRAGON.black}" flood-opacity="0.12"/></filter>
<clipPath id="window"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/></clipPath>
<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1.1" fill="${MIRAGON.line}"/></pattern>
</defs>
<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="${MIRAGON.grey}"/>
<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${MIRAGON.white}" filter="url(#lift)"/>
<g clip-path="url(#window)">
<rect x="${x}" y="${DIAGRAM_PANE.y}" width="${width}" height="${DIAGRAM_PANE.height}" fill="url(#grid)"/>
<rect x="${x}" y="${TERMINAL.y}" width="${width}" height="${TERMINAL_HEIGHT}" fill="${MIRAGON.black}"/>
<rect x="${x}" y="${DIAGRAM_PANE.y}" width="${width}" height="1" fill="${MIRAGON.line}"/>
</g>
<rect x="${x + 0.5}" y="${y + 0.5}" width="${width - 1}" height="${height - 1}" rx="${radius}" fill="none" stroke="${MIRAGON.line}"/>
${dots}
<text x="${x + 96}" y="${headerBase}" font-family="Geist Mono" font-size="14" fill="${MIRAGON.mutedOnLight}">order-service / processes / <tspan fill="${MIRAGON.black}" font-weight="500">order.bpmn</tspan></text>
<rect x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="${MIRAGON.blueSoft}"/>
<circle cx="${pill.x + 17}" cy="${pill.y + pill.height / 2}" r="4" fill="${MIRAGON.blue}"/>
<text x="${pill.x + 30}" y="${pill.y + 19}" font-family="Geist Mono" font-size="13" font-weight="500" fill="${MIRAGON.blue}">bpmn-cli</text>
<text x="${TERMINAL.textX}" y="${TERMINAL.y + 34}" font-family="Geist Mono" font-size="12" font-weight="500" letter-spacing="1.5" fill="${MIRAGON.mutedOnDark}">TERMINAL</text>
<rect x="${TERMINAL.textX}" y="${TERMINAL.y + 44}" width="78" height="2" fill="${MIRAGON.green}"/>
<rect x="${x}" y="${TERMINAL.y + 46}" width="${width}" height="1" fill="${MIRAGON.lineOnDark}"/>`;
}

function terminalRow(row) {
  return TERMINAL.y + 88 + row * TERMINAL.lineHeight;
}

function terminalCells(text, column, row, fill) {
  const charWidth = TERMINAL.fontSize * MONO_ADVANCE;
  const cellStarts = Array.from(text, (_, index) => TERMINAL.textX + (column + index) * charWidth).join(' ');
  return `<text x="${cellStarts}" y="${terminalRow(row)}" fill="${fill}" xml:space="preserve">${escapeXml(text)}</text>`;
}

function terminalText({ typed, output }) {
  const charWidth = TERMINAL.fontSize * MONO_ADVANCE;
  const cursorX = TERMINAL.textX + (2 + typed.length) * charWidth;
  const cursor = output.length ? '' : `<rect x="${cursorX}" y="${terminalRow(0) - 16}" width="${charWidth}" height="21" fill="${MIRAGON.green}"/>`;
  const outputLines = output
    .map(({ keyword, rest }, index) => terminalCells(keyword, 0, index + 1, MIRAGON.green) + terminalCells(rest, keyword.length, index + 1, MIRAGON.mutedOnDark))
    .join('\n');
  return `<g font-family="Geist Mono" font-size="${TERMINAL.fontSize}">
${terminalCells('$', 0, 0, MIRAGON.green)}
${terminalCells(typed, 2, 0, MIRAGON.white)}
${cursor}
${outputLines}
</g>`;
}

function frame(scene, chrome, diagrams) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}">
${chrome}
<g opacity="${1 - scene.progress}">${diagrams.before}</g>
<g opacity="${scene.progress}">${diagrams.after}</g>
${terminalText(scene)}
</svg>`;
}

function keywordAndRest(line) {
  const keyword = line.split(' ')[0];
  return { keyword, rest: line.slice(keyword.length) };
}

async function geistFonts() {
  return Promise.all(GEIST_FILES.map(async (file) => new Uint8Array(await (await fetch(`${GEIST}/${file}`)).arrayBuffer())));
}

bpmn('new', 'order.bpmn', '--name', 'Order handling');
bpmn('add', 'order.bpmn', 'start', 'Order received');
bpmn('add', 'order.bpmn', 'userTask', 'Check invoice', '--after', 'Event_OrderReceived');
bpmn('add', 'order.bpmn', 'end', 'Done', '--after', 'Activity_CheckInvoice');
bpmn('render', 'order.bpmn', '-o', 'before.svg');
const report = bpmn(...ADD_APPROVAL, '--render', 'after.svg').split('\n');
const output = ['created userTask', 'layout:', 'written:'].map((start) => keywordAndRest(report.find((line) => line.startsWith(start))));

const left = WINDOW.x + (WINDOW.width - diagramSize(readFileSync(join(work, 'after.svg'), 'utf8')).width) / 2;
const diagrams = { before: placedDiagram('before.svg', left), after: placedDiagram('after.svg', left) };
const command = `bpmn ${ADD_APPROVAL.map(shellQuoted).join(' ')}`;
const typing = [];
for (let length = TYPED_CHARS_PER_FRAME; length < command.length; length += TYPED_CHARS_PER_FRAME) {
  typing.push({ typed: command.slice(0, length), output: [], progress: 0 });
}
const crossfade = Array.from({ length: CROSSFADE_FRAMES }, (_, index) => ({ typed: command, output, progress: (index + 1) / CROSSFADE_FRAMES }));
const scenes = [
  ...repeated({ typed: '', output: [], progress: 0 }, seconds(1.5)),
  ...typing,
  ...repeated({ typed: command, output: [], progress: 0 }, seconds(0.5)),
  ...crossfade,
  ...repeated({ typed: command, output, progress: 1 }, seconds(4)),
];

const require = createRequire(import.meta.url);
await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const arimo = readFileSync(join(REPO, 'assets/fonts/Arimo-Regular-Latin.ttf'));
const font = { fontBuffers: [arimo, ...(await geistFonts())], loadSystemFonts: false, defaultFontFamily: 'Arimo', sansSerifFamily: 'Arimo' };
const chrome = windowChrome();
const rendered = new Map();
const frames = scenes.map((scene, index) => {
  const svg = frame(scene, chrome, diagrams);
  if (!rendered.has(svg)) rendered.set(svg, new Resvg(svg, { font }).render().asPng());
  const file = join(work, `frame-${String(index).padStart(4, '0')}.png`);
  writeFileSync(file, rendered.get(svg));
  return file;
});

execFileSync('gifski', ['--fps', String(FPS), '--width', String(CANVAS.width), '--quality', '90', '-o', GIF, ...frames], { stdio: 'ignore' });
console.log(`wrote ${GIF} (${frames.length} frames, ${work})`);
