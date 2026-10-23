// Renders the README demo docs/assets/demo.gif: real bpmn commands on a small order process, the
// terminal below and the diagram the CLI draws after each command above it, in a macOS window.
// Needs the built CLI (`npm run build`), ffmpeg and gifsicle. Run: node tools/demo/make-demo.mjs
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const cli = join(repo, "bin", "bpmn.js")
const OUTPUT = join(repo, "docs", "assets", "demo.gif")
const GIF_WIDTH = 1280
const TYPING_STEP = 3
const TYPING_FRAME = 0.045

const SETUP = [
  ["new", "order.bpmn", "--name", "Order handling"],
  ["add", "order.bpmn", "start", "Order received"],
  ["add", "order.bpmn", "userTask", "Check invoice", "--after", "Event_OrderReceived"],
  ["add", "order.bpmn", "end", "Invoice paid", "--after", "Activity_CheckInvoice"],
]

const STORY = [
  ["show", "order.bpmn"],
  ["add", "order.bpmn", "userTask", "Approve invoice", "--after", "Activity_CheckInvoice", "--summary"],
  ["add", "order.bpmn", "exclusiveGateway", "Approved?", "--after", "Activity_ApproveInvoice", "--summary"],
  ["add", "order.bpmn", "end", "Invoice rejected", "--after", "Gateway_Approved", "--flow-name", "no", "--summary"],
  ["set", "order.bpmn", "Flow_ApprovedToInvoicePaid", "name=yes", "--summary"],
  ["validate", "order.bpmn"],
]

function bpmn(args, cwd) {
  try {
    return execFileSync("node", [cli, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (failure) {
    return `${failure.stdout}${failure.stderr}`
  }
}

function asTyped(args) {
  return ["bpmn", ...args.map((arg) => (/[\s?]/.test(arg) ? `"${arg}"` : arg))].join(" ")
}

function renderedDiagram(cwd) {
  bpmn(["render", "order.bpmn", "-o", "diagram.svg"], cwd)
  return readFileSync(join(cwd, "diagram.svg"), "utf8")
}

function runStory() {
  const cwd = mkdtempSync(join(tmpdir(), "bpmn-demo-"))
  for (const args of SETUP) bpmn(args, cwd)
  const steps = [{ diagram: renderedDiagram(cwd) }]
  for (const args of STORY) {
    const output = bpmn(args, cwd).trimEnd()
    steps.push({ command: asTyped(args), output, diagram: renderedDiagram(cwd) })
  }
  rmSync(cwd, { recursive: true })
  return steps
}

function escaped(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function coloured(line) {
  const html = escaped(line)
  if (/^(error|warning |W_)/.test(line)) return `<span class="warn">${html}</span>`
  if (/^valid/.test(line)) return `<span class="ok">${html}</span>`
  return html.replace(/^([a-z][a-z :]*?:)/, '<span class="key">$1</span>')
}

function terminalHtml(history, typing) {
  const lines = history.flatMap(({ command, output }) => [
    `<span class="prompt">$</span> ${escaped(command)}`,
    ...output.split("\n").map(coloured),
    "",
  ])
  lines.push(`<span class="prompt">$</span> ${escaped(typing ?? "")}<span class="cursor"></span>`)
  return lines.join("\n")
}

const ACTIVITY_ICONS = [
  '<path d="M14 3H6v18h12V7z M14 3v4h4"/>',
  '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20"/>',
  '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10 M18 10c0 5-12 3-12 7"/>',
  '<path d="M7 4v16l13-8z"/>',
  '<rect x="3" y="11" width="7" height="7"/><rect x="11" y="11" width="7" height="7"/><rect x="11" y="3" width="7" height="7"/><rect x="15" y="1" width="6" height="6" transform="rotate(45 18 4)"/>',
]

function activityBar() {
  return ACTIVITY_ICONS.map(
    (shape, index) =>
      `<svg class="${index === 0 ? "active" : ""}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke-width="1.5" stroke-linejoin="round">${shape}</svg>`,
  ).join("")
}

function page(diagram, terminal) {
  return `<!doctype html><html><head><style>
    body { margin: 0; font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 13px; }
    .desktop { display: inline-block; padding: 44px; background: linear-gradient(135deg, #e9edf3, #f6f1ee 55%, #e8eef0); }
    .window { width: 1500px; height: 900px; display: grid; grid-template-rows: 36px 1fr 24px; border-radius: 11px;
      overflow: hidden; background: #1f1f1f; color: #ccc;
      box-shadow: 0 0 0 1px rgb(0 0 0 / 20%), 0 0 24px rgb(0 0 0 / 22%), 0 18px 48px rgb(0 0 0 / 32%); }
    .titlebar { position: relative; background: #181818; border-bottom: 1px solid #2b2b2b; color: #9d9d9d;
      display: flex; align-items: center; justify-content: center; font-size: 12.5px; }
    .lights { position: absolute; left: 14px; display: flex; gap: 8px; }
    .lights span { width: 12px; height: 12px; border-radius: 50%; }
    .main { display: grid; grid-template-columns: 48px 230px 1fr; min-height: 0; }
    .activity { background: #181818; border-right: 1px solid #2b2b2b; display: flex; flex-direction: column;
      align-items: center; gap: 22px; padding-top: 16px; }
    .activity svg { stroke: #858585; }
    .activity svg.active { stroke: #e7e7e7; }
    .explorer { background: #181818; border-right: 1px solid #2b2b2b; padding: 10px 0; }
    .explorer h4 { margin: 0 0 8px 20px; font-size: 11px; font-weight: 600; letter-spacing: .04em; color: #9d9d9d; }
    .explorer div { padding: 3px 0 3px 20px; white-space: nowrap; }
    .explorer .open { background: #37373d; color: #fff; }
    .explorer .nested { padding-left: 36px; }
    .work { display: grid; grid-template-rows: 35px 1fr 310px; min-height: 0; }
    .tabs { background: #181818; display: flex; border-bottom: 1px solid #2b2b2b; }
    .tabs div { padding: 0 18px; display: flex; align-items: center; gap: 8px; border-right: 1px solid #2b2b2b; color: #9d9d9d; }
    .tabs .active { background: #1f1f1f; color: #fff; border-top: 1px solid #0078d4; }
    .badge { color: #e8a33e; font-weight: 600; font-size: 11px; }
    .editor { background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden;
      background-image: radial-gradient(#e2e2e2 1px, transparent 1px); background-size: 16px 16px; }
    .editor svg { zoom: 1.75; }
    .panel { border-top: 1px solid #2b2b2b; display: grid; grid-template-rows: 34px 1fr; min-height: 0; }
    .panel-tabs { display: flex; gap: 22px; padding: 0 20px; align-items: center; font-size: 11px; letter-spacing: .04em; color: #8b8b8b; }
    .panel-tabs .active { color: #e7e7e7; border-bottom: 1px solid #e7e7e7; padding: 8px 0 7px; }
    .screen { padding: 0 20px 10px; color: #d4d4d4; font: 13px/1.5 "SF Mono", Menlo, monospace; white-space: pre-wrap;
      overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end;
      mask-image: linear-gradient(transparent, #000 28px); }
    .prompt, .ok { color: #3ddc84; } .key { color: #6cb6ff; } .warn { color: #e5c07b; }
    .cursor { display: inline-block; width: 8px; height: 16px; background: #d4d4d4; vertical-align: text-bottom; }
    .statusbar { background: #181818; border-top: 1px solid #2b2b2b; color: #9d9d9d; font-size: 12px;
      display: flex; align-items: center; gap: 18px; padding: 0 14px; }
  </style></head><body><div class="desktop"><div class="window">
    <div class="titlebar"><div class="lights"><span style="background:#ff5f57"></span><span style="background:#febc2e"></span><span style="background:#28c840"></span></div>order-service</div>
    <div class="main">
      <div class="activity">${activityBar()}</div>
      <div class="explorer"><h4>EXPLORER</h4>
        <div>⌄ order-service</div><div class="nested">› src</div><div class="nested">⌄ processes</div>
        <div class="nested open" style="padding-left:52px">order.bpmn</div><div class="nested">package.json</div><div class="nested">README.md</div>
      </div>
      <div class="work">
        <div class="tabs"><div class="active">order.bpmn</div><div>README.md</div></div>
        <div class="editor">${diagram}</div>
        <div class="panel">
          <div class="panel-tabs"><span>PROBLEMS</span><span>OUTPUT</span><span class="active">TERMINAL</span></div>
          <div class="screen"><div>${terminal}</div></div>
        </div>
      </div>
    </div>
    <div class="statusbar"><span>⎇ main</span><span>BPMN 2.0</span></div>
  </div></div></body></html>`
}

function* scenes(steps) {
  const history = []
  let diagram = steps[0].diagram
  yield { diagram, terminal: terminalHtml(history), seconds: 1.2 }
  for (const step of steps.slice(1)) {
    for (let typed = TYPING_STEP; typed < step.command.length; typed += TYPING_STEP) {
      yield { diagram, terminal: terminalHtml(history, step.command.slice(0, typed)), seconds: TYPING_FRAME }
    }
    yield { diagram, terminal: terminalHtml(history, step.command), seconds: 0.5 }
    history.push(step)
    diagram = step.diagram
    yield { diagram, terminal: terminalHtml(history), seconds: 2.6 }
  }
}

async function writeFrames(steps, directory) {
  const browser = await chromium.launch()
  const view = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  const concatList = []
  let index = 0
  for (const scene of scenes(steps)) {
    const file = join(directory, `${String(index++).padStart(4, "0")}.png`)
    await view.setContent(page(scene.diagram, scene.terminal))
    await view.locator(".desktop").screenshot({ path: file })
    concatList.push(`file '${file}'`, `duration ${scene.seconds}`)
  }
  await browser.close()
  concatList.push(concatList.at(-2))
  writeFileSync(join(directory, "frames.txt"), `${concatList.join("\n")}\n`)
  return index
}

function encodeGif(directory) {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(directory, "frames.txt"),
    "-vf",
    `fps=20,scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    OUTPUT,
  ])
  execFileSync("gifsicle", ["--batch", "-O3", OUTPUT])
}

const directory = mkdtempSync(join(tmpdir(), "bpmn-demo-frames-"))
try {
  const frames = await writeFrames(runStory(), directory)
  encodeGif(directory)
  console.log(`${frames} frames in ${OUTPUT}, ${(statSync(OUTPUT).size / 1e6).toFixed(1)} MB`)
} finally {
  rmSync(directory, { recursive: true, force: true })
}
