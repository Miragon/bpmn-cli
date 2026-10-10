/**
 * The Claude Code plugin (plugins/bpmn-cli) and its marketplace (.claude-plugin/marketplace.json):
 *
 *  - the metadata agrees with package.json (name, version) and release-please keeps it so;
 *  - the skill stays within Claude Code's limits and every link in it resolves;
 *  - every command the skill teaches is right for this CLI: the bash blocks of the recipes run in
 *    order, the blocks of the other reference files run on the models the recipes leave, and every
 *    `bpmn <command> --option` mentioned anywhere in the skill exists;
 *  - the eval suite is well-formed, and its graders are satisfiable: each scaffold writes a valid
 *    model, a reference solution made with the CLI passes every file grader, the untouched fixture
 *    fails the graders that check the change, and the transcript graders match what the CLI prints.
 *
 * The CLI is bundled from src/ with esbuild into a temporary directory (not dist/, which
 * cli.test.ts rebuilds concurrently), and `bpmn` on PATH runs that bundle.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
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
  // the CLI reads ../package.json relative to its own file
  mkdirSync(join(tmp, 'cli'));
  copyFileSync(join(ROOT, 'package.json'), join(tmp, 'package.json'));
  cliFile = join(tmp, 'cli', 'cli.mjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'cli.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
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
  const r = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ''}` },
  });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

function bpmn(args: string[], cwd: string, input?: string): Run {
  const r = spawnSync(process.execPath, [cliFile, ...args], { cwd, encoding: 'utf8', input: input ?? '' });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

function workDir(name: string): string {
  const d = join(tmp, name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

/** The ```bash blocks of a markdown file, in order (indentation of list items removed). */
function bashBlocks(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)].map((m) => m[2]!.replace(new RegExp(`^${m[1]}`, 'gm'), ''));
}

function runBlocks(file: string, cwd: string): void {
  bashBlocks(file).forEach((block, i) => {
    const r = sh(block, cwd);
    if (r.code !== 0) throw new Error(`${file.slice(ROOT.length + 1)} bash block ${i + 1} failed (${r.code}):\n${block}\n--- stdout\n${r.out}\n--- stderr\n${r.err}`);
  });
}

/** A minimal reader for the frontmatter the plugin uses: key: value, 'quoted', [a, b], { k: v }. */
function frontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, unknown> = {};
  const lines = m[1]!.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv as unknown as [string, string, string];
    if (raw === '') {
      // a YAML list on the following lines
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1]!)) items.push(lines[++i]!.replace(/^\s+-\s+/, '').replace(/\s+#.*$/, ''));
      data[key] = items;
    } else data[key] = scalar(raw);
  }
  return { data, body: m[2]! };
}

function scalar(raw: string): unknown {
  const v = raw.trim();
  if (v.startsWith("'")) return v.slice(1, v.lastIndexOf("'")).replace(/''/g, "'");
  if (v.startsWith('"')) return JSON.parse(v);
  if (v.startsWith('[')) return v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
  if (v.startsWith('{')) return Object.fromEntries(v.slice(1, -1).split(',').map((p) => p.split(':').map((s) => s.trim()) as [string, string]));
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

const md = (f: string) => readFileSync(f, 'utf8');
const skillFiles = () => [join(SKILL, 'SKILL.md'), ...readdirSync(join(SKILL, 'reference')).map((f) => join(SKILL, 'reference', f))];

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
    for (const line of skill.split('\n').filter((l) => /@miragon\/bpmn-cli@\d/.test(l))) {
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
        const r = bpmn([...cmd, '--help'], tmp);
        helpOf.set(key, r.code === 0 ? r.out : '');
      }
      return helpOf.get(key)!;
    };
    const top = help([]);
    const commands = new Set([...top.matchAll(/^ {2}([a-z]+)(?:\|[a-z]+)?\s/gm)].map((m) => m[1]!));
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
    for (const f of ['order-to-cash.bpmn', 'payment.bpmn', 'shipping.bpmn']) {
      const r = bpmn(['validate', f, '--strict'], dir);
      expect(r.code, `${f}: ${r.out}${r.err}`).toBe(0);
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
        const r = bpmn(['apply', 'empty.bpmn', '-', '--dry-run', '--json'], dir, batch);
        // ids may not exist in an empty model; the shape must be right
        expect(r.err, `${file}:\n${batch}`).not.toMatch(/E_USAGE|E_UNKNOWN_ALIAS|E_DUPLICATE_ALIAS/);
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
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data, body } = frontmatter(md(join(dir, f)));
      return { name: f.replace(/\.md$/, ''), type: data.type as string, data, body };
    });
}

function regexPasses(g: Grader, text: string): boolean {
  const flags = (g.data.flags as string | undefined) ?? '';
  const match = (g.data.match as string | undefined) ?? 'contains';
  const re = new RegExp(g.data.pattern as string, flags);
  if (match === 'not_contains') return !re.test(text);
  const count = /^count:(\d+)$/.exec(match);
  if (count) return [...text.matchAll(new RegExp(g.data.pattern as string, flags.includes('g') ? flags : `${flags}g`))].length === Number(count[1]);
  return re.test(text);
}

function fileGraders(caseDir: string, file: string): Grader[] {
  return graders(caseDir).filter((g) => g.type === 'regex' && typeof g.data.target === 'object' && (g.data.target as Record<string, string>).path === file);
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
  { "op": "ext", "id": "Activity_ChargeCreditCard", "action": "add", "type": "camunda:errorEventDefinition", "attrs": { "id": "ErrorMapping_CardDeclined", "errorRef": "Error_CardDeclined", "expression": "\${declined}" } }
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
    .filter((d) => d.isDirectory() && existsSync(join(EVALS, d.name, 'prompt.md')))
    .map((d) => d.name);

  it('has the cases the plugin is measured on, each with a prompt and graders', () => {
    expect(cases.sort()).toEqual(['build-order-to-cash', 'camunda7-external-task', 'camunda8-retoure-german', 'edit-hand-drawn-model', 'format-happy-path', 'ignores-python-question']);
    for (const c of cases) {
      const { data, body } = frontmatter(md(join(EVALS, c, 'prompt.md')));
      for (const key of Object.keys(data)) expect(PROMPT_KEYS.has(key), `${c}: prompt.md key ${key}`).toBe(true);
      expect(body.trim().length).toBeGreaterThan(50);
      // realistic prompts: the user does not name the skill
      expect(body).not.toMatch(/\bskill\b|bpmn-cli|@miragon/i);
      expect(graders(join(EVALS, c)).length).toBeGreaterThan(0);
      if (existsSync(join(EVALS, c, 'case.yaml'))) {
        const yaml = md(join(EVALS, c, 'case.yaml'));
        expect(yaml).toMatch(/^schema_version: "1\.1"$/m);
        expect(yaml).toMatch(new RegExp(`^name: ${c}$`, 'm'));
        const script = /scaffold_script: (\S+)/.exec(yaml)?.[1];
        if (script) expect(existsSync(join(EVALS, c, script)), `${c}: ${script}`).toBe(true);
      }
    }
  });

  it('every grader has a known type and its patterns compile', () => {
    for (const c of cases) {
      for (const g of graders(join(EVALS, c))) {
        expect(GRADER_TYPES.has(g.type), `${c}/${g.name}: type ${g.type}`).toBe(true);
        if (g.type === 'regex') expect(() => new RegExp(g.data.pattern as string, (g.data.flags as string) ?? ''), `${c}/${g.name}`).not.toThrow();
        if (g.type === 'tool_used' && g.data.input_match) expect(() => new RegExp(g.data.input_match as string), `${c}/${g.name}`).not.toThrow();
        if (g.type === 'llm') expect(g.body.trim(), `${c}/${g.name}`).toMatch(/PASS[\s\S]*FAIL/);
      }
    }
  });

  it('the tool graders tell CLI use from hand-written XML', () => {
    const g = (c: string, name: string) => graders(join(EVALS, c)).find((x) => x.name === name)!;
    const matches = (gr: Grader, input: unknown) => new RegExp(gr.data.input_match as string).test(JSON.stringify(input));
    const skill = g('build-order-to-cash', 'skill-used');
    expect(matches(skill, { skill: 'bpmn-cli:bpmn' })).toBe(true);
    expect(matches(skill, { skill: 'bpmn' })).toBe(true);
    expect(matches(skill, { skill: 'pdf' })).toBe(false);
    const xml = g('build-order-to-cash', 'no-xml-in-shell');
    const cli = `bpmn apply order-to-cash.bpmn - <<'EOF'\n[{ "op": "add", "kind": "userTask", "name": "Check order", "id": "Activity_CheckOrder", "after": "Event_OrderReceived" }]\nEOF`;
    expect(matches(xml, { command: cli })).toBe(false);
    expect(matches(xml, { command: `bpmn ext add f.bpmn Activity_X zeebe:ioMapping --xml '<zeebe:ioMapping><zeebe:input source="=a" target="b"/></zeebe:ioMapping>'` })).toBe(false);
    expect(matches(xml, { command: `cat > order-to-cash.bpmn <<'EOF'\n<?xml version="1.0"?>\n<bpmn:definitions>` })).toBe(true);
    expect(matches(xml, { command: `sed -i '' 's/Task_1/Task_2/' order-to-cash.bpmn` })).toBe(true);
    expect(matches(xml, { command: `python3 -c "import xml.etree.ElementTree as ET"` })).toBe(true);
    const write = g('build-order-to-cash', 'no-bpmn-write');
    expect(matches(write, { file_path: '/w/order-to-cash.bpmn', content: '<?xml' })).toBe(true);
    expect(matches(write, { file_path: '/w/ops.json', content: '[]' })).toBe(false);
    const validated = g('build-order-to-cash', 'validated');
    expect(matches(validated, { command: 'bpmn validate order-to-cash.bpmn --strict' })).toBe(true);
    expect(matches(validated, { command: 'npx -y @miragon/bpmn-cli@1.2.3 validate order-to-cash.bpmn' })).toBe(true);
    expect(matches(validated, { command: 'bpmn show order-to-cash.bpmn' })).toBe(false);
    const strict = g('camunda7-external-task', 'strict-validate-ran');
    expect(matches(strict, { command: 'bpmn validate payment.bpmn --strict' })).toBe(true);
    expect(matches(strict, { command: 'bpmn validate payment.bpmn' })).toBe(false);
  });

  for (const [c, solution] of Object.entries(SOLUTIONS)) {
    it(`${c}: a CLI solution passes every file grader; the starting point fails the change graders`, () => {
      const dir = workDir(`eval-${c}`);
      const caseDir = join(EVALS, c);
      if (existsSync(join(caseDir, 'scaffold.sh'))) {
        const s = spawnSync('bash', [join(caseDir, 'scaffold.sh')], { cwd: dir, encoding: 'utf8' });
        expect(s.status, s.stderr).toBe(0);
        const v = bpmn(['validate', solution.file], dir);
        expect(v.code, `${c}: the fixture is valid\n${v.out}${v.err}`).toBe(0);
        expect(v.out).not.toMatch(/^import:/m);
        const before = readFileSync(join(dir, solution.file), 'utf8');
        for (const g of fileGraders(caseDir, solution.file).filter((x) => solution.changeGraders.includes(x.name))) {
          expect(regexPasses(g, before), `${c}/${g.name} must fail on the untouched fixture`).toBe(false);
        }
      }
      const r = sh(solution.script, dir);
      expect(r.code, `${r.out}${r.err}`).toBe(0);
      const after = readFileSync(join(dir, solution.file), 'utf8');
      const fg = fileGraders(caseDir, solution.file);
      expect(fg.map((g) => g.name)).toEqual(expect.arrayContaining(solution.changeGraders));
      for (const g of fg) expect(regexPasses(g, after), `${c}/${g.name} on the CLI solution`).toBe(true);
      // the transcript graders match what the CLI prints for the solution
      for (const g of graders(caseDir).filter((x) => x.type === 'regex' && x.data.target === 'trace')) {
        const v = bpmn(['validate', solution.file, '--strict'], dir);
        expect(regexPasses(g, v.out), `${c}/${g.name} on: ${v.out}`).toBe(true);
      }
    }, SLOW);
  }
});
