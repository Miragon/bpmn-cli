/**
 * The Claude Code plugin (plugins/bpmn-cli) and its marketplace (.claude-plugin/marketplace.json):
 *
 *  - the metadata agrees with package.json (name, version) and release-please keeps it so;
 *  - the skill stays within Claude Code's limits and every link in it resolves;
 *  - every command the skill teaches is right for this CLI: the bash blocks of the recipes run in
 *    order, the blocks of the other reference files and the look step of SKILL.md (`bpmn render`)
 *    run on the models the recipes leave, and every `bpmn <command> --option` mentioned anywhere in
 *    the skill exists;
 *  - the eval suite is well-formed, and its graders are satisfiable: each scaffold writes a valid
 *    model, a reference solution made with the CLI passes every file grader, the untouched fixture
 *    fails the graders that check the change, the transcript graders match what the CLI prints, and
 *    the layout graders of tidy-after-edit say what `bpmn metrics --json` says.
 *
 * The CLI is bundled from src/ with esbuild into a temporary directory (not dist/, which
 * cli.test.ts rebuilds concurrently), and `bpmn` on PATH runs that bundle.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const PLUGIN = join(ROOT, 'plugins', 'bpmn-cli');
const SKILL = join(PLUGIN, 'skills', 'bpmn');
const EVALS = join(PLUGIN, 'evals');
const REFERENCES = ['ops.md', 'formatting.md', 'camunda7.md', 'camunda8.md'];
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
/** Tests that run many CLI commands (each a node process) get more than the default 20 s. */
const SLOW = 120_000;

let tmp: string;
let shimDir: string;
let cliFile: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'bpmn-plugin-'));
  // relative to its own file the bundle reads ../package.json (src/cli.ts), the font from
  // ../../../../assets (src/adapters/out/files/PngRenderer.ts) and @resvg/resvg-wasm from node_modules above it
  mkdirSync(join(tmp, 'pkg', 'dist', 'out', 'cli'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(tmp, 'pkg', 'dist', 'out', 'package.json'));
  symlinkSync(join(ROOT, 'assets'), join(tmp, 'assets'));
  symlinkSync(join(ROOT, 'node_modules'), join(tmp, 'node_modules'));
  cliFile = join(tmp, 'pkg', 'dist', 'out', 'cli', 'cli.mjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'cli.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: cliFile,
    logLevel: 'error',
    banner: { js: "import { createRequire as __bpmnCreateRequire } from 'node:module'; const require = __bpmnCreateRequire(import.meta.url);" },
  });
  shimDir = join(tmp, 'bin');
  mkdirSync(shimDir);
  writeFileSync(join(shimDir, 'bpmn'), `#!/bin/sh\nexec "${process.execPath}" "${cliFile}" "$@"\n`);
  chmodSync(join(shimDir, 'bpmn'), 0o755);
}, 60000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

interface Run {
  code: number;
  out: string;
  err: string;
}

function sh(script: string, cwd: string): Run {
  const spawned = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ''}` },
  });
  return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
}

function bpmn(args: string[], cwd: string, input?: string): Run {
  const spawned = spawnSync(process.execPath, [cliFile, ...args], { cwd, encoding: 'utf8', input: input ?? '' });
  return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
}

function workDir(name: string): string {
  const workPath = join(tmp, name);
  rmSync(workPath, { recursive: true, force: true });
  mkdirSync(workPath, { recursive: true });
  return workPath;
}

/** The ```bash blocks of a markdown file, in order (indentation of list items removed). */
function bashBlocks(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)].map((match) => match[2]!.replace(new RegExp(`^${match[1]}`, 'gm'), ''));
}

function runBlocks(file: string, cwd: string): void {
  bashBlocks(file).forEach((block, blockIndex) => {
    const result = sh(block, cwd);
    if (result.code !== 0) throw new Error(`${file.slice(ROOT.length + 1)} bash block ${blockIndex + 1} failed (${result.code}):\n${block}\n--- stdout\n${result.out}\n--- stderr\n${result.err}`);
  });
}

/** A minimal reader for the frontmatter the plugin uses: key: value, 'quoted', [a, b], { k: v }. */
function frontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text };
  const data: Record<string, unknown> = {};
  const lines = match[1]!.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv as unknown as [string, string, string];
    if (raw === '') {
      // a YAML list on the following lines
      const items: string[] = [];
      while (lineIndex + 1 < lines.length && /^\s+-\s/.test(lines[lineIndex + 1]!)) items.push(lines[++lineIndex]!.replace(/^\s+-\s+/, '').replace(/\s+#.*$/, ''));
      data[key] = items;
    } else data[key] = scalar(raw);
  }
  return { data, body: match[2]! };
}

function scalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'")) return trimmed.slice(1, trimmed.lastIndexOf("'")).replace(/''/g, "'");
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith('[')) return trimmed.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean);
  if (trimmed.startsWith('{')) return Object.fromEntries(trimmed.slice(1, -1).split(',').map((pair) => pair.split(':').map((part) => part.trim()) as [string, string]));
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

const md = (file: string) => readFileSync(file, 'utf8');
const skillFiles = () => [join(SKILL, 'SKILL.md'), ...readdirSync(join(SKILL, 'reference')).map((fileName) => join(SKILL, 'reference', fileName))];

describe('plugin metadata', () => {
  const manifest = JSON.parse(md(join(PLUGIN, '.claude-plugin', 'plugin.json'))) as Record<string, any>;
  const market = JSON.parse(md(join(ROOT, '.claude-plugin', 'marketplace.json'))) as Record<string, any>;

  it('the manifest follows package.json', () => {
    expect(manifest.name).toBe('bpmn-cli');
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository).toBe('https://github.com/Miragon/bpmn-cli');
  });

  it('the marketplace lists the plugin under its own name, from its directory', () => {
    expect(market.name).toBe('miragon-bpmn');
    expect(market.owner.name).toBe('Miragon GmbH');
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0].name).toBe(manifest.name);
    expect(market.plugins[0].source).toBe('./plugins/bpmn-cli');
    // the version lives in plugin.json only (two versions make `claude plugin validate` warn)
    expect(market.plugins[0].version).toBeUndefined();
  });

  it('release-please bumps the plugin version and the pinned npx version with the package', () => {
    const config = JSON.parse(md(join(ROOT, 'release-please-config.json'))) as Record<string, any>;
    const extra = config.packages['.']['extra-files'] as Array<Record<string, string>>;
    expect(extra).toContainEqual({ type: 'json', path: 'plugins/bpmn-cli/.claude-plugin/plugin.json', jsonpath: '$.version' });
    expect(extra).toContainEqual({ type: 'generic', path: 'plugins/bpmn-cli/skills/bpmn/SKILL.md' });
    const skill = md(join(SKILL, 'SKILL.md'));
    const pins = [...skill.matchAll(/@miragon\/bpmn-cli@(\d+\.\d+\.\d+)/g)];
    expect(pins.length).toBeGreaterThan(0);
    for (const line of skill.split('\n').filter((skillLine) => /@miragon\/bpmn-cli@\d/.test(skillLine))) {
      // the generic updater replaces the version only on lines that carry the marker
      expect(line).toContain('x-release-please-version');
      expect(line).toContain(`@miragon/bpmn-cli@${pkg.version}`);
    }
  });
});

describe('the skill', () => {
  const skill = md(join(SKILL, 'SKILL.md'));
  const { data, body } = frontmatter(skill);

  it('has the frontmatter Claude Code reads, within its limits', () => {
    expect(data.name).toBe('bpmn');
    const listing = `${data.description as string}${data.when_to_use as string}`;
    expect(listing.length).toBeLessThanOrEqual(1536);
    expect(data.description as string).toMatch(/instead of editing BPMN XML by hand/);
    expect(data['allowed-tools']).toEqual(['Bash(bpmn *)', `Bash(npx -y @miragon/bpmn-cli@${pkg.version} *)`]);
    expect(skill.split('\n').length).toBeLessThan(500);
    expect(body).toMatch(/by id only/);
  });

  it('every relative link in the skill resolves', () => {
    for (const file of skillFiles()) {
      for (const [, target] of md(file).matchAll(/\]\(([^)#]+)\)/g)) {
        if (/^https?:/.test(target!)) continue;
        expect(existsSync(join(dirname(file), target!)), `${file}: ${target}`).toBe(true);
      }
    }
  });

  it('every `bpmn <command> --option` in the skill exists in this CLI', () => {
    const helpOf = new Map<string, string>();
    const help = (cmd: string[]): string => {
      const key = cmd.join(' ');
      if (!helpOf.has(key)) {
        const result = bpmn([...cmd, '--help'], tmp);
        helpOf.set(key, result.code === 0 ? result.out : '');
      }
      return helpOf.get(key)!;
    };
    const top = help([]);
    const commands = new Set([...top.matchAll(/^ {2}([a-z]+)(?:\|[a-z]+)?\s/gm)].map((match) => match[1]!));
    const problems: string[] = [];
    let checked = 0;
    for (const file of skillFiles()) {
      const text = md(file);
      // command lines in code blocks and inline code spans that start with `bpmn `
      const uses = [...text.matchAll(/(?:^|`|\| )\s*(?:\$ )?bpmn ([a-z]+)((?: [^`\n]*)?)/gm)];
      checked += uses.length;
      for (const [, cmd, rest] of uses) {
        if (!commands.has(cmd!)) {
          problems.push(`${file}: unknown command bpmn ${cmd}`);
          continue;
        }
        const sub = cmd === 'ext' ? (/^\s+(add|remove|list)\b/.exec(rest!)?.[1] ?? '') : '';
        const options = help(sub ? [cmd!, sub] : [cmd!]);
        for (const [, opt] of rest!.replace(/'[^']*'|"[^"]*"/g, '').matchAll(/\s(--[a-z][a-z-]*)/g)) {
          if (!options.includes(`${opt} `) && !options.includes(`${opt},`) && !options.includes(`${opt}\n`)) problems.push(`${file}: bpmn ${cmd}${sub ? ` ${sub}` : ''} has no option ${opt}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(60);
  }, SLOW);

  it('the recipes run in order against this CLI', () => {
    const dir = workDir('recipes');
    runBlocks(join(SKILL, 'reference', 'recipes.md'), dir);
    for (const fixture of ['order-to-cash.bpmn', 'payment.bpmn', 'shipping.bpmn']) {
      const result = bpmn(['validate', fixture, '--strict'], dir);
      expect(result.code, `${fixture}: ${result.out}${result.err}`).toBe(0);
    }
  }, SLOW);

  for (const ref of REFERENCES) {
    it(`the examples of reference/${ref} run on the models the recipes build`, () => {
      const base = join(tmp, 'recipes');
      if (!existsSync(join(base, 'order-to-cash.bpmn'))) runBlocks(join(SKILL, 'reference', 'recipes.md'), workDir('recipes'));
      const dir = workDir(`ref-${ref}`);
      cpSync(base, dir, { recursive: true });
      runBlocks(join(SKILL, 'reference', ref), dir);
    }, SLOW);
  }

  it('the look step of SKILL.md runs: its render example draws the recipes\' model into .bpmn-render/', () => {
    const base = join(tmp, 'recipes');
    if (!existsSync(join(base, 'order-to-cash.bpmn'))) runBlocks(join(SKILL, 'reference', 'recipes.md'), workDir('recipes'));
    const dir = workDir('skill-look');
    cpSync(base, dir, { recursive: true });
    const blocks = bashBlocks(join(SKILL, 'SKILL.md')).filter((block) => /\bbpmn render\b/.test(block));
    expect(blocks).toHaveLength(1);
    const result = sh(blocks[0]!, dir);
    expect(result.code, `${result.out}${result.err}`).toBe(0);
    const wrote = /^wrote (\S+) {2}(\d+)x(\d+) px {2}~[\d,]+ image tokens {2}scale [\d.]+ {2}plane \S+$/m.exec(result.out);
    expect(wrote, result.out).not.toBeNull();
    expect(wrote![1]).toMatch(/^\.bpmn-render\/[\w-]+\.png$/);
    expect(result.out).toMatch(/^problems: none$|^problems \(numbered in the image\):$/m);
    // a real PNG of the size the line names, within the default --max-size
    const png = readFileSync(join(dir, wrote![1]!));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([Number(wrote![2]), Number(wrote![3])]);
    expect(Math.max(png.readUInt32BE(16), png.readUInt32BE(20))).toBeLessThanOrEqual(2000);
  }, SLOW);

  it('every render the skill shows writes into .bpmn-render/ of the working directory, never the temp default', () => {
    let renders = 0;
    for (const file of skillFiles()) {
      for (const line of md(file).split('\n')) {
        // command lines only (code blocks and the pipe of a batch), not prose such as `--render <file.png>`
        if (!/^\s*(?:\]' \| )?bpmn [a-z]/.test(line)) continue;
        if (/^\s*bpmn render\b/.test(line)) {
          renders++;
          expect(line, file).toMatch(/ -o \.bpmn-render\/[\w-]+\.png\b/);
        }
        for (const [, out] of line.matchAll(/--render (\S+)/g)) {
          renders++;
          expect(out, `${file}: ${line}`).toMatch(/^\.bpmn-render\/[\w-]+\.png$/);
        }
      }
    }
    expect(renders).toBeGreaterThan(5);
  });

  it('every ops JSON block in the skill is a valid batch (checked before anything runs)', () => {
    const dir = workDir('ops-shape');
    expect(bpmn(['new', 'empty.bpmn'], dir).code).toBe(0);
    let found = 0;
    for (const file of skillFiles()) {
      for (const [, json] of md(file).matchAll(/printf '%s' '(\[[\s\S]*?\])' \| bpmn apply/g)) {
        if (!json!.includes('"op"')) continue; // a placeholder such as '[...]' in prose
        const batch = json!.replace(/^ {3}/gm, '');
        found++;
        expect(() => JSON.parse(batch), `${file}:\n${batch}`).not.toThrow();
        const result = bpmn(['apply', 'empty.bpmn', '-', '--dry-run', '--json'], dir, batch);
        // ids may not exist in an empty model; the shape must be right
        expect(result.err, `${file}:\n${batch}`).not.toMatch(/E_USAGE|E_UNKNOWN_ALIAS|E_DUPLICATE_ALIAS/);
      }
    }
    expect(found).toBeGreaterThan(8);
  }, SLOW);

  it('batches are piped in with printf, never through a heredoc (Claude Code asks before running JSON in a heredoc)', () => {
    for (const file of skillFiles()) expect(md(file), file).not.toMatch(/<<\s*'?EOF/);
  });
});

/* ---------------------------------------------------------------- evals */

interface Grader {
  name: string;
  type: string;
  data: Record<string, unknown>;
  body: string;
}

function graders(caseDir: string): Grader[] {
  const dir = join(caseDir, 'graders');
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => {
      const { data, body } = frontmatter(md(join(dir, fileName)));
      return { name: fileName.replace(/\.md$/, ''), type: data.type as string, data, body };
    });
}

function regexPasses(grader: Grader, text: string): boolean {
  const flags = (grader.data.flags as string | undefined) ?? '';
  const match = (grader.data.match as string | undefined) ?? 'contains';
  const re = new RegExp(grader.data.pattern as string, flags);
  if (match === 'not_contains') return !re.test(text);
  const count = /^count:(\d+)$/.exec(match);
  if (count) return [...text.matchAll(new RegExp(grader.data.pattern as string, flags.includes('g') ? flags : `${flags}g`))].length === Number(count[1]);
  return re.test(text);
}

function fileGraders(caseDir: string, file: string): Grader[] {
  return graders(caseDir).filter((grader) => grader.type === 'regex' && typeof grader.data.target === 'object' && (grader.data.target as Record<string, string>).path === file);
}

/** A reference solution per case, made with the CLI: [file, commands run in the workspace]. */
const SOLUTIONS: Record<string, { file: string; script: string; changeGraders: string[] }> = {
  'build-order-to-cash': {
    file: 'order-to-cash.bpmn',
    changeGraders: ['lanes', 'pools-and-message-flows', 'diagram'],
    script: `bpmn new order-to-cash.bpmn --name "Order to cash" --id Process_OrderToCash
bpmn apply order-to-cash.bpmn - <<'EOF'
[
  { "op": "add", "kind": "participant", "name": "Order to cash", "id": "Participant_OrderToCash" },
  { "op": "add", "kind": "participant", "name": "Customer", "id": "Participant_Customer", "blackBox": true },
  { "op": "add", "kind": "lane", "name": "Vertrieb", "id": "Lane_Vertrieb", "in": "Participant_OrderToCash" },
  { "op": "add", "kind": "lane", "name": "Lager", "id": "Lane_Lager", "in": "Participant_OrderToCash" },
  { "op": "add", "kind": "lane", "name": "Buchhaltung", "id": "Lane_Buchhaltung", "in": "Participant_OrderToCash" },
  { "op": "add", "kind": "startEvent:message", "name": "Order received", "id": "Event_OrderReceived", "message": "Order", "in": "Participant_OrderToCash", "lane": "Lane_Vertrieb" },
  { "op": "add", "kind": "userTask", "name": "Check order", "id": "Activity_CheckOrder", "after": "Event_OrderReceived", "lane": "Lane_Vertrieb" },
  { "op": "add", "kind": "exclusiveGateway", "name": "Order accepted?", "id": "Gateway_OrderAccepted", "after": "Activity_CheckOrder", "lane": "Lane_Vertrieb" },
  { "op": "add", "kind": "userTask", "name": "Pick and pack goods", "id": "Activity_PickAndPackGoods", "after": "Gateway_OrderAccepted", "flowName": "yes", "condition": "\${accepted}", "lane": "Lane_Lager" },
  { "op": "add", "kind": "userTask", "name": "Ship goods", "id": "Activity_ShipGoods", "after": "Activity_PickAndPackGoods", "lane": "Lane_Lager" },
  { "op": "add", "kind": "sendTask", "name": "Send invoice", "id": "Activity_SendInvoice", "after": "Activity_ShipGoods", "lane": "Lane_Buchhaltung" },
  { "op": "add", "kind": "receiveTask", "name": "Receive payment", "id": "Activity_ReceivePayment", "message": "Payment", "after": "Activity_SendInvoice", "lane": "Lane_Buchhaltung" },
  { "op": "add", "kind": "endEvent", "name": "Order completed", "id": "Event_OrderCompleted", "after": "Activity_ReceivePayment", "lane": "Lane_Buchhaltung" },
  { "op": "add", "kind": "sendTask", "name": "Send rejection", "id": "Activity_SendRejection", "after": "Gateway_OrderAccepted", "flowName": "no", "default": true, "lane": "Lane_Vertrieb" },
  { "op": "add", "kind": "endEvent", "name": "Order rejected", "id": "Event_OrderRejected", "after": "Activity_SendRejection", "lane": "Lane_Vertrieb" },
  { "op": "connect", "source": "Participant_Customer", "target": "Event_OrderReceived", "name": "Order" },
  { "op": "connect", "source": "Activity_SendRejection", "target": "Participant_Customer", "name": "Rejection" },
  { "op": "connect", "source": "Activity_SendInvoice", "target": "Participant_Customer", "name": "Invoice" },
  { "op": "connect", "source": "Participant_Customer", "target": "Activity_ReceivePayment", "name": "Payment" }
]
EOF`,
  },
  'edit-hand-drawn-model': {
    file: 'purchase-request.bpmn',
    changeGraders: ['approval-inserted', 'timer-reminder', 'reminder-path'],
    script: `bpmn apply purchase-request.bpmn - --layout incremental <<'EOF'
[
  { "op": "add", "kind": "userTask", "name": "Approve purchase", "id": "Activity_ApprovePurchase", "flow": "Flow_0yq6cfd" },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "3 days", "id": "Event_ApprovalOverdue", "on": "Activity_ApprovePurchase", "timer": "P3D", "nonInterrupting": true },
  { "op": "add", "kind": "sendTask", "name": "Remind manager", "id": "Activity_RemindManager", "after": "Event_ApprovalOverdue" },
  { "op": "add", "kind": "endEvent", "name": "Manager reminded", "id": "Event_ManagerReminded", "after": "Activity_RemindManager" }
]
EOF`,
  },
  'camunda7-external-task': {
    file: 'payment.bpmn',
    changeGraders: ['external-task', 'input-mapping', 'error-mapping', 'error-boundary-path'],
    script: `bpmn apply payment.bpmn - <<'EOF'
[
  { "op": "set", "id": "Activity_ChargeCreditCard", "values": { "camunda:type": "external", "camunda:topic": "charge-credit-card" } },
  { "op": "ext", "id": "Activity_ChargeCreditCard", "action": "add", "type": "camunda:inputParameter", "attrs": { "name": "amount" }, "body": "\${order.total}" },
  { "op": "add", "kind": "boundaryEvent:error", "name": "Card declined", "id": "Event_CardDeclined", "on": "Activity_ChargeCreditCard", "error": "Card declined", "errorCode": "CARD_DECLINED" },
  { "op": "add", "kind": "userTask", "name": "Inform customer", "id": "Activity_InformCustomer", "after": "Event_CardDeclined" },
  { "op": "add", "kind": "endEvent", "name": "Payment failed", "id": "Event_PaymentFailed", "after": "Activity_InformCustomer" },
  { "op": "ext", "id": "Activity_ChargeCreditCard", "action": "add", "type": "camunda:errorEventDefinition", "attrs": { "id": "ErrorMapping_CardDeclined", "errorRef": "error_cardDeclined", "expression": "\${declined}" } }
]
EOF`,
  },
  'format-happy-path': {
    file: 'claim-handling.bpmn',
    changeGraders: ['happy-path-green', 'rejection-below'],
    script: `bpmn apply claim-handling.bpmn - <<'EOF'
[
  { "op": "color", "path": ["Event_ClaimReceived", "Event_ClaimPaid"], "color": "green" },
  { "op": "place", "branch": "Flow_ClaimCoveredNo", "below": "Activity_PayOutClaim" }
]
EOF`,
  },
  'tidy-after-edit': {
    file: 'invoice-approval.bpmn',
    changeGraders: ['inform-requester', 'gateway-label-clear', 'no-crossing'],
    script: `bpmn add invoice-approval.bpmn sendTask "Inform requester" --id Activity_InformRequester --flow Flow_ReturnInvoiceToInvoiceReturned --render .bpmn-render/invoice-approval.png
bpmn apply invoice-approval.bpmn - --render .bpmn-render/invoice-approval.png <<'EOF'
[
  { "op": "label", "id": "Gateway_InvoiceCorrect", "side": "above" },
  { "op": "place", "branch": "Flow_InvoiceCorrectNo", "below": "Activity_RemindApprover" }
]
EOF
bpmn render invoice-approval.bpmn --problems -o .bpmn-render/invoice-approval.png`,
  },
  'camunda8-retoure-german': {
    file: 'retoure.bpmn',
    changeGraders: ['camunda8-file', 'job-workers', 'user-task-group', 'feel-gateway'],
    script: `bpmn new retoure.bpmn --name "Retoure" --id Process_Retoure --target camunda8
bpmn apply retoure.bpmn - <<'EOF'
[
  { "op": "add", "kind": "startEvent", "name": "Retoure angemeldet", "id": "Event_RetoureAngemeldet", "in": "Process_Retoure" },
  { "op": "add", "kind": "userTask", "name": "Ware prüfen", "id": "Activity_WarePruefen", "after": "Event_RetoureAngemeldet" },
  { "op": "ext", "id": "Activity_WarePruefen", "action": "add", "type": "zeebe:assignmentDefinition", "attrs": { "candidateGroups": "lager" } },
  { "op": "add", "kind": "exclusiveGateway", "name": "Ware in Ordnung?", "id": "Gateway_WareInOrdnung", "after": "Activity_WarePruefen" },
  { "op": "add", "kind": "serviceTask", "name": "Gutschrift erstellen", "id": "Activity_GutschriftErstellen", "after": "Gateway_WareInOrdnung", "flowName": "ja", "condition": "= wareInOrdnung" },
  { "op": "ext", "id": "Activity_GutschriftErstellen", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "create-credit-note" } },
  { "op": "add", "kind": "endEvent", "name": "Retoure abgeschlossen", "id": "Event_RetoureAbgeschlossen", "after": "Activity_GutschriftErstellen" },
  { "op": "add", "kind": "serviceTask", "name": "Ablehnungsmail senden", "id": "Activity_AblehnungsmailSenden", "after": "Gateway_WareInOrdnung", "flowName": "nein", "condition": "= not(wareInOrdnung)" },
  { "op": "ext", "id": "Activity_AblehnungsmailSenden", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "send-rejection-mail" } },
  { "op": "add", "kind": "endEvent", "name": "Retoure abgelehnt", "id": "Event_RetoureAbgelehnt", "after": "Activity_AblehnungsmailSenden" }
]
EOF
bpmn validate retoure.bpmn --strict`,
  },
};

const PROMPT_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'model', 'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt', 'env']);
const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline']);

describe('the eval suite', () => {
  const cases = readdirSync(EVALS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(EVALS, entry.name, 'prompt.md')))
    .map((entry) => entry.name);

  it('has the cases the plugin is measured on, each with a prompt and graders', () => {
    expect(cases.sort()).toEqual(['build-order-to-cash', 'camunda7-external-task', 'camunda8-retoure-german', 'edit-hand-drawn-model', 'format-happy-path', 'ignores-python-question', 'tidy-after-edit']);
    for (const caseName of cases) {
      const { data, body } = frontmatter(md(join(EVALS, caseName, 'prompt.md')));
      for (const key of Object.keys(data)) expect(PROMPT_KEYS.has(key), `${caseName}: prompt.md key ${key}`).toBe(true);
      expect(body.trim().length).toBeGreaterThan(50);
      // realistic prompts: the user does not name the skill
      expect(body).not.toMatch(/\bskill\b|bpmn-cli|@miragon/i);
      expect(graders(join(EVALS, caseName)).length).toBeGreaterThan(0);
      if (existsSync(join(EVALS, caseName, 'case.yaml'))) {
        const yaml = md(join(EVALS, caseName, 'case.yaml'));
        expect(yaml).toMatch(/^schema_version: "1\.1"$/m);
        expect(yaml).toMatch(new RegExp(`^name: ${caseName}$`, 'm'));
        const script = /scaffold_script: (\S+)/.exec(yaml)?.[1];
        if (script) expect(existsSync(join(EVALS, caseName, script)), `${caseName}: ${script}`).toBe(true);
      }
    }
  });

  it('every grader has a known type and its patterns compile', () => {
    for (const caseName of cases) {
      for (const caseGrader of graders(join(EVALS, caseName))) {
        expect(GRADER_TYPES.has(caseGrader.type), `${caseName}/${caseGrader.name}: type ${caseGrader.type}`).toBe(true);
        if (caseGrader.type === 'regex') expect(() => new RegExp(caseGrader.data.pattern as string, (caseGrader.data.flags as string) ?? ''), `${caseName}/${caseGrader.name}`).not.toThrow();
        if (caseGrader.type === 'tool_used' && caseGrader.data.input_match) expect(() => new RegExp(caseGrader.data.input_match as string), `${caseName}/${caseGrader.name}`).not.toThrow();
        if (caseGrader.type === 'llm') expect(caseGrader.body.trim(), `${caseName}/${caseGrader.name}`).toMatch(/PASS[\s\S]*FAIL/);
      }
    }
  });

  it('the tool graders tell CLI use from hand-written XML', () => {
    const graderOf = (caseName: string, name: string) => graders(join(EVALS, caseName)).find((warning) => warning.name === name)!;
    const matches = (gr: Grader, input: unknown) => new RegExp(gr.data.input_match as string).test(JSON.stringify(input));
    const skill = graderOf('build-order-to-cash', 'skill-used');
    expect(matches(skill, { skill: 'bpmn-cli:bpmn' })).toBe(true);
    expect(matches(skill, { skill: 'bpmn' })).toBe(true);
    expect(matches(skill, { skill: 'pdf' })).toBe(false);
    const xml = graderOf('build-order-to-cash', 'no-xml-in-shell');
    const cli = `bpmn apply order-to-cash.bpmn - <<'EOF'\n[{ "op": "add", "kind": "userTask", "name": "Check order", "id": "Activity_CheckOrder", "after": "Event_OrderReceived" }]\nEOF`;
    expect(matches(xml, { command: cli })).toBe(false);
    expect(matches(xml, { command: `bpmn ext add f.bpmn Activity_X zeebe:ioMapping --xml '<zeebe:ioMapping><zeebe:input source="=a" target="b"/></zeebe:ioMapping>'` })).toBe(false);
    expect(matches(xml, { command: `cat > order-to-cash.bpmn <<'EOF'\n<?xml version="1.0"?>\n<bpmn:definitions>` })).toBe(true);
    expect(matches(xml, { command: `sed -i '' 's/Task_1/Task_2/' order-to-cash.bpmn` })).toBe(true);
    expect(matches(xml, { command: `python3 -c "import xml.etree.ElementTree as ET"` })).toBe(true);
    const write = graderOf('build-order-to-cash', 'no-bpmn-write');
    expect(matches(write, { file_path: '/w/order-to-cash.bpmn', content: '<?xml' })).toBe(true);
    expect(matches(write, { file_path: '/w/ops.json', content: '[]' })).toBe(false);
    const built = graderOf('build-order-to-cash', 'built-with-the-cli');
    expect(matches(built, { command: `printf '%s' '[]' | bpmn apply order-to-cash.bpmn - --summary` })).toBe(true);
    expect(matches(built, { command: 'bpmn new order-to-cash.bpmn --name "Order to cash"' })).toBe(true);
    expect(matches(built, { command: 'npx -y @miragon/bpmn-cli@1.2.3 add order-to-cash.bpmn userTask "Check order" --after Event_OrderReceived' })).toBe(true);
    expect(matches(built, { command: 'bpmn show order-to-cash.bpmn' })).toBe(false);
    expect(matches(built, { command: `cat > order-to-cash.bpmn <<'EOF'\n<bpmn:definitions>` })).toBe(false);
    const validated = graderOf('build-order-to-cash', 'validated');
    expect(matches(validated, { command: 'bpmn validate order-to-cash.bpmn --strict' })).toBe(true);
    expect(matches(validated, { command: 'npx -y @miragon/bpmn-cli@1.2.3 validate order-to-cash.bpmn' })).toBe(true);
    expect(matches(validated, { command: 'bpmn show order-to-cash.bpmn' })).toBe(false);
    const look = graderOf('tidy-after-edit', 'render-read');
    expect(look.data.arm).toBe('with-only');
    expect(matches(look, { file_path: '/w/.bpmn-render/invoice-approval.png' })).toBe(true);
    expect(matches(look, { file_path: '/w/invoice-approval.bpmn' })).toBe(false);
    const strict = graderOf('camunda7-external-task', 'strict-validate-ran');
    expect(matches(strict, { command: 'bpmn validate payment.bpmn --strict' })).toBe(true);
    expect(matches(strict, { command: 'bpmn validate payment.bpmn' })).toBe(false);
  });

  for (const [caseName, solution] of Object.entries(SOLUTIONS)) {
    it(`${caseName}: a CLI solution passes every file grader; the starting point fails the change graders`, () => {
      const dir = workDir(`eval-${caseName}`);
      const caseDir = join(EVALS, caseName);
      if (existsSync(join(caseDir, 'scaffold.sh'))) {
        const scaffold = spawnSync('bash', [join(caseDir, 'scaffold.sh')], { cwd: dir, encoding: 'utf8' });
        expect(scaffold.status, scaffold.stderr).toBe(0);
        const validation = bpmn(['validate', solution.file], dir);
        expect(validation.code, `${caseName}: the fixture is valid\n${validation.out}${validation.err}`).toBe(0);
        expect(validation.out).not.toMatch(/^import:/m);
        const before = readFileSync(join(dir, solution.file), 'utf8');
        for (const caseGrader of fileGraders(caseDir, solution.file).filter((warning) => solution.changeGraders.includes(warning.name))) {
          expect(regexPasses(caseGrader, before), `${caseName}/${caseGrader.name} must fail on the untouched fixture`).toBe(false);
        }
      }
      const result = sh(solution.script, dir);
      expect(result.code, `${result.out}${result.err}`).toBe(0);
      const after = readFileSync(join(dir, solution.file), 'utf8');
      const fg = fileGraders(caseDir, solution.file);
      expect(fg.map((caseGrader) => caseGrader.name)).toEqual(expect.arrayContaining(solution.changeGraders));
      for (const caseGrader of fg) expect(regexPasses(caseGrader, after), `${caseName}/${caseGrader.name} on the CLI solution`).toBe(true);
      // the transcript graders match what the CLI prints for the solution
      for (const caseGrader of graders(caseDir).filter((warning) => warning.type === 'regex' && warning.data.target === 'trace')) {
        const validation = bpmn(['validate', solution.file, '--strict'], dir);
        expect(regexPasses(caseGrader, validation.out), `${caseName}/${caseGrader.name} on: ${validation.out}`).toBe(true);
      }
    }, SLOW);
  }

  it('the graders check structure and colour, not the CLI\'s id style or palette', () => {
    const grader = (caseName: string, name: string) => graders(join(EVALS, caseName)).find((warning) => warning.name === name)!;
    // edit-hand-drawn-model: Modeler-style hash ids fail speaking-new-ids only, not the structure graders
    const edit = SOLUTIONS['edit-hand-drawn-model']!;
    const dir = workDir('eval-hash-ids');
    expect(spawnSync('bash', [join(EVALS, 'edit-hand-drawn-model', 'scaffold.sh')], { cwd: dir, encoding: 'utf8' }).status).toBe(0);
    const hashed = edit.script.replaceAll('Activity_ApprovePurchase', 'Activity_1a7mq4e').replaceAll('Event_ApprovalOverdue', 'Event_1x6rt2w');
    const result = sh(hashed, dir);
    expect(result.code, `${result.out}${result.err}`).toBe(0);
    const model = readFileSync(join(dir, edit.file), 'utf8');
    for (const name of ['approval-inserted', 'timer-reminder', 'reminder-path']) expect(regexPasses(grader('edit-hand-drawn-model', name), model), name).toBe(true);
    expect(regexPasses(grader('edit-hand-drawn-model', 'speaking-new-ids'), model)).toBe(false);
    // format-happy-path: any green counts, also one that is not the bpmn-js palette
    const fmt = SOLUTIONS['format-happy-path']!;
    const fdir = workDir('eval-other-green');
    expect(spawnSync('bash', [join(EVALS, 'format-happy-path', 'scaffold.sh')], { cwd: fdir, encoding: 'utf8' }).status).toBe(0);
    expect(sh(fmt.script, fdir).code).toBe(0);
    const green = readFileSync(join(fdir, fmt.file), 'utf8');
    expect(green).toMatch(/#205022/i);
    const otherGreen = green.replace(/#205022/gi, '#43a047');
    expect(regexPasses(grader('format-happy-path', 'happy-path-green'), otherGreen)).toBe(true);
    const rejectionGreen = otherGreen.replace(/(bpmnElement="Activity_SendRejectionLetter")/, '$1 bioc:stroke="#43a047"');
    expect(regexPasses(grader('format-happy-path', 'rejection-not-green'), rejectionGreen)).toBe(false);
  }, SLOW);

  it('tidy-after-edit: the layout graders say what `bpmn metrics --json` says', () => {
    const caseDir = join(EVALS, 'tidy-after-edit');
    const file = 'invoice-approval.bpmn';
    const grader = (name: string) => graders(caseDir).find((warning) => warning.name === name)!;
    const edit = `bpmn add ${file} sendTask "Inform requester" --id Activity_InformRequester --flow Flow_ReturnInvoiceToInvoiceReturned`;
    const branchBelow = `bpmn place ${file} --branch Flow_InvoiceCorrectNo --below Activity_RemindApprover`;
    const label = (side: string) => `bpmn label ${file} Gateway_InvoiceCorrect --side ${side}`;
    const variants: Record<string, string> = {
      'the fixture': 'true',
      'the edit only': edit,
      'the label fixed, the crossing left': `${edit}\n${label('above')}`,
      'the crossing fixed, the label left': `${edit}\n${branchBelow}`,
      'the solution (label above)': `${edit}\n${label('above')}\n${branchBelow}`,
      // what the agents did in the first eval run: the branch below, then the empty row closed
      'the solution, then compact': `${edit}\n${label('above')}\n${branchBelow}\nbpmn compact ${file}`,
      'label below': `${edit}\n${branchBelow}\n${label('below')}`,
      'label left (on "Check invoice" and its flow)': `${edit}\n${branchBelow}\n${label('left')}`,
      'label right (on "Approve invoice" and the "yes" flow)': `${edit}\n${branchBelow}\n${label('right')}`,
    };
    for (const [name, script] of Object.entries(variants)) {
      const dir = workDir('eval-tidy-metrics');
      expect(spawnSync('bash', [join(caseDir, 'scaffold.sh')], { cwd: dir, encoding: 'utf8' }).status).toBe(0);
      const result = sh(script, dir);
      expect(result.code, `${name}: ${result.out}${result.err}`).toBe(0);
      const metrics = bpmn(['metrics', file, '--json'], dir);
      const problems = (JSON.parse(metrics.out) as { problems: { kind: string; ids: string[] }[] }).problems;
      if (name === 'the fixture') {
        expect(problems.map((problem) => `${problem.kind} ${problem.ids.join(' ')}`).sort()).toEqual([
          'crossings Flow_ReturnInvoiceToInvoiceReturned Flow_ApprovalOverdueToRemindApprover',
          'labelClash Gateway_InvoiceCorrect Activity_ApproveInvoice',
        ]);
      }
      if (name.startsWith('the solution')) expect(problems, name).toEqual([]);
      const labelProblem = problems.some((problem) => /^label/.test(problem.kind) && problem.ids.includes('Gateway_InvoiceCorrect'));
      const crossing = problems.some((problem) => problem.kind === 'crossings');
      const xml = readFileSync(join(dir, file), 'utf8');
      // compact moved the reminder path up: the rows are no longer the solution's
      if (name === 'the solution, then compact') expect(xml).toMatch(/bpmnElement="Activity_RemindApprover"[^>]*>\s*<dc:Bounds x="720" y="327"/);
      expect(regexPasses(grader('gateway-label-clear'), xml), `${name}: gateway-label-clear`).toBe(!labelProblem);
      expect(regexPasses(grader('no-crossing'), xml), `${name}: no-crossing`).toBe(name !== 'the fixture' && !crossing);
      expect(regexPasses(grader('main-line-kept'), xml), `${name}: main-line-kept`).toBe(true);
    }
  }, SLOW);

  it('edit-hand-drawn-model: a "no" path that joins a task without a gateway fails no-implicit-join', () => {
    const dir = workDir('eval-implicit-join');
    const caseDir = join(EVALS, 'edit-hand-drawn-model');
    expect(spawnSync('bash', [join(caseDir, 'scaffold.sh')], { cwd: dir, encoding: 'utf8' }).status).toBe(0);
    const result = sh(`bpmn apply purchase-request.bpmn - <<'EOF'
[
  { "op": "add", "kind": "userTask", "name": "Approve purchase", "id": "Activity_ApprovePurchase", "flow": "Flow_0yq6cfd" },
  { "op": "add", "kind": "exclusiveGateway", "name": "Purchase approved?", "id": "Gateway_PurchaseApproved", "after": "Activity_ApprovePurchase" },
  { "op": "connect", "source": "Gateway_PurchaseApproved", "target": "Activity_0f3j5ny", "name": "no", "default": true }
]
EOF`, dir);
    expect(result.code, `${result.out}${result.err}`).toBe(0);
    expect(result.out).toMatch(/W_IMPLICIT_JOIN Activity_0f3j5ny/);
    const joinGrader = graders(caseDir).find((warning) => warning.name === 'no-implicit-join')!;
    expect(regexPasses(joinGrader, readFileSync(join(dir, 'purchase-request.bpmn'), 'utf8'))).toBe(false);
  });
});
