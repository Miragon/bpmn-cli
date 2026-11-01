import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Run {
  code: number;
  out: string;
  err: string;
}

interface Grader {
  name: string;
  type: string;
  data: Record<string, unknown>;
  body: string;
}

const ROOT = join(import.meta.dirname, '..', '..');
const PLUGIN = join(ROOT, 'plugins', 'bpmn-cli');
const SKILL = join(PLUGIN, 'skills', 'bpmn');
const EVALS = join(PLUGIN, 'evals');
const HELP_FOLDERS = ['guide', 'project', 'tables'];
const REFERENCES = ['ops.md', 'formatting.md', 'camunda7.md', 'camunda8.md'];
const RECIPES = join(SKILL, 'reference', 'recipes.md');
const PROMPT_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'model', 'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt', 'env']);
const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline']);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> };
const SLOW = 120_000;

let tmp: string;
let shimFolder: string;
let cliScript: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'bpmn-plugin-'));
  const dist = join(tmp, 'dist');
  await build({ absWorkingDir: ROOT, entryPoints: { cli: 'src/cli/index.ts' }, bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'node24', mainFields: ['module', 'main'], external: Object.keys(pkg.dependencies), outdir: dist, logLevel: 'error' });
  for (const folder of HELP_FOLDERS) {
    cpSync(join(ROOT, 'src', 'cli', 'help', folder), join(dist, folder), { recursive: true });
  }
  cpSync(join(ROOT, 'package.json'), join(tmp, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(tmp, 'node_modules'));
  cliScript = join(tmp, 'bpmn.mjs');
  writeFileSync(cliScript, "import { Cli } from './dist/cli.js';\nprocess.exitCode = await new Cli(process).run(process.argv.slice(2));\n");
  shimFolder = join(tmp, 'bin');
  mkdirSync(shimFolder);
  writeFileSync(join(shimFolder, 'bpmn'), `#!/bin/sh\nexec "${process.execPath}" "${cliScript}" "$@"\n`);
  chmodSync(join(shimFolder, 'bpmn'), 0o755);
}, 60000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function sh(script: string, cwd: string): Run {
  const spawned = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${shimFolder}:${process.env.PATH ?? ''}` } });
  return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
}

function bpmn(words: string[], cwd: string, input = ''): Run {
  const spawned = spawnSync(process.execPath, [cliScript, ...words], { cwd, encoding: 'utf8', input });
  return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
}

function workFolder(name: string): string {
  const path = join(tmp, name);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  return path;
}

function md(file: string): string {
  return readFileSync(file, 'utf8');
}

function bashBlocks(file: string): string[] {
  return [...md(file).matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)].map(([, indent, block]) => block!.replace(new RegExp(`^${indent}`, 'gm'), ''));
}

function runBlock(block: string, cwd: string): Run {
  const result = sh(block, cwd);
  if (result.code !== 0) {
    throw new Error(`a bash block failed (${result.code}):\n${block}\n--- stdout\n${result.out}\n--- stderr\n${result.err}`);
  }
  return result;
}

function recipesFolder(name: string): string {
  const base = join(tmp, 'recipes');
  if (!existsSync(join(base, 'shipping.bpmn'))) {
    const recipes = workFolder('recipes');
    bashBlocks(RECIPES).forEach((block) => runBlock(block, recipes));
  }
  const folder = workFolder(name);
  cpSync(base, folder, { recursive: true });
  return folder;
}

function scalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'")) {
    return trimmed.slice(1, trimmed.lastIndexOf("'")).replace(/''/g, "'");
  }
  if (trimmed.startsWith('"')) {
    return JSON.parse(trimmed);
  }
  if (trimmed.startsWith('[')) {
    return trimmed.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean);
  }
  if (trimmed.startsWith('{')) {
    return Object.fromEntries(trimmed.slice(1, -1).split(',').map((pair) => pair.split(':').map((part) => part.trim()) as [string, string]));
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function listItemsAfter(lines: readonly string[], index: number): string[] {
  const items: string[] = [];
  for (let next = index + 1; next < lines.length && /^\s+-\s/.test(lines[next]!); next++) {
    items.push(lines[next]!.replace(/^\s+-\s+/, '').replace(/\s+#.*$/, ''));
  }
  return items;
}

function frontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { data: {}, body: text };
  }
  const lines = match[1]!.split('\n');
  const pairs = lines.flatMap((line, index) => {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line);
    return pair ? [[pair[1]!, pair[2] === '' ? listItemsAfter(lines, index) : scalar(pair[2]!)]] : [];
  });
  return { data: Object.fromEntries(pairs), body: match[2]! };
}

function skillFiles(): string[] {
  return [join(SKILL, 'SKILL.md'), ...readdirSync(join(SKILL, 'reference')).map((name) => join(SKILL, 'reference', name))];
}

function pngSizeOf(file: string): number[] {
  const png = readFileSync(file);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('plugin metadata', () => {
  const manifest = JSON.parse(md(join(PLUGIN, '.claude-plugin', 'plugin.json'))) as Record<string, any>;
  const pluginVersion = pkg.version.includes('-rc.') ? manifest.version : pkg.version;
  const market = JSON.parse(md(join(ROOT, '.claude-plugin', 'marketplace.json'))) as Record<string, any>;

  it('the manifest follows package.json', () => {
    expect(manifest.name).toBe('bpmn-cli');
    expect(manifest.version).toBe(pluginVersion);
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository).toBe('https://github.com/Miragon/bpmn-cli');
  });

  it('the marketplace lists the plugin under its own name, from its folder on the release branch, without a version of its own', () => {
    expect(market.name).toBe('miragon-bpmn');
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0].name).toBe(manifest.name);
    expect(market.plugins[0].source).toEqual({ source: 'git-subdir', url: 'https://github.com/Miragon/bpmn-cli.git', path: 'plugins/bpmn-cli', ref: 'release' });
    expect(existsSync(join(ROOT, market.plugins[0].source.path, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(market.plugins[0].version).toBeUndefined();
  });

  it('release-please bumps the plugin version and the pinned npx version with the package', () => {
    const config = JSON.parse(md(join(ROOT, 'release-please-config.json'))) as Record<string, any>;
    const extra = config.packages['.']['extra-files'] as Array<Record<string, string>>;
    const pinned = md(join(SKILL, 'SKILL.md')).split('\n').filter((line) => /@miragon\/bpmn-cli@\d/.test(line));

    expect(extra).toContainEqual({ type: 'json', path: 'plugins/bpmn-cli/.claude-plugin/plugin.json', jsonpath: '$.version' });
    expect(extra).toContainEqual({ type: 'generic', path: 'plugins/bpmn-cli/skills/bpmn/SKILL.md' });
    expect(pinned.length).toBeGreaterThan(0);
    for (const line of pinned) {
      expect(line).toContain('x-release-please-version');
      expect(line).toContain(`@miragon/bpmn-cli@${pluginVersion}`);
    }
  });
});

describe('the skill', () => {
  const skill = md(join(SKILL, 'SKILL.md'));
  const { data, body } = frontmatter(skill);
  const pin = /@miragon\/bpmn-cli@(\S+) \*\)/.exec(skill)![1]!;

  it('has the frontmatter Claude Code reads, within its limits', () => {
    expect(data.name).toBe('bpmn');
    expect(`${data.description as string}${data.when_to_use as string}`.length).toBeLessThanOrEqual(1536);
    expect(data.description as string).toMatch(/instead of editing BPMN XML by hand/);
    expect(data['allowed-tools']).toEqual(['Bash(bpmn *)', `Bash(npx -y @miragon/bpmn-cli@${pin} *)`]);
    expect(skill.split('\n').length).toBeLessThan(500);
    expect(body).toMatch(/by id only/);
  });

  it('resolves every relative link', () => {
    const links = skillFiles().flatMap((file) => [...md(file).matchAll(/\]\(([^)#]+)\)/g)].map(([, target]) => join(dirname(file), target!)));

    expect(links.filter((target) => !existsSync(target))).toEqual([]);
  });

  it('runs its recipes in order, each model ending strictly valid', () => {
    const folder = recipesFolder('recipes-validated');

    for (const model of ['order-to-cash.bpmn', 'payment.bpmn', 'shipping.bpmn']) {
      const result = bpmn(['validate', model, '--strict'], folder);

      expect(result.code, `${model}: ${result.out}${result.err}`).toBe(0);
    }
  }, SLOW);

  it.each(REFERENCES)('runs the examples of reference/%s on the models the recipes build', (reference) => {
    const folder = recipesFolder(`reference-${reference}`);

    bashBlocks(join(SKILL, 'reference', reference)).forEach((block) => runBlock(block, folder));
  }, SLOW);

  it("runs its batch and its format examples on recipe 1's model", () => {
    const folder = workFolder('skill-examples');
    runBlock(bashBlocks(RECIPES)[0]!, folder);

    bashBlocks(join(SKILL, 'SKILL.md')).filter((block) => !block.includes('npx') && !block.includes('--version')).forEach((block) => runBlock(block, folder));
  }, SLOW);

  it('answers its version check', () => {
    expect(runBlock(bashBlocks(join(SKILL, 'SKILL.md'))[0]!, tmp).out.trim()).toBe(pkg.version);
  });

  it("draws in its look step the recipes' model into .bpmn-render/", () => {
    const folder = recipesFolder('skill-look');
    const look = bashBlocks(join(SKILL, 'SKILL.md')).filter((block) => /\bbpmn render\b/.test(block));
    expect(look).toHaveLength(1);

    const { out } = runBlock(look[0]!, folder);

    const wrote = /^wrote (\S+) {2}(\d+)x(\d+) px {2}~[\d,]+ image tokens {2}scale [\d.]+ {2}plane \S+$/m.exec(out);
    expect(wrote, out).not.toBeNull();
    expect(wrote![1]).toMatch(/^\.bpmn-render\/[\w-]+\.png$/);
    expect(out).toMatch(/^problems: none$|^problems \(numbered in the image\):$/m);
    expect(pngSizeOf(join(folder, wrote![1]!))).toEqual([Number(wrote![2]), Number(wrote![3])]);
  }, SLOW);

  it('renders only into .bpmn-render/ of the working folder, never the temp default', () => {
    const renders = skillFiles().flatMap((file) => md(file).split('\n')).filter((line) => /^\s*bpmn render\b/.test(line));

    expect(renders.length).toBeGreaterThan(5);
    expect(renders.filter((line) => !/ -o \.bpmn-render\/[\w-]+\.png\b/.test(line))).toEqual([]);
  });

  it('holds only batches of the right shape', () => {
    const folder = workFolder('ops-shape');
    expect(bpmn(['new', 'empty.bpmn'], folder).code).toBe(0);
    const batches = skillFiles().flatMap((file) => [...md(file).matchAll(/printf '%s' '(\[[\s\S]*?\])' \| bpmn apply/g)].map(([, json]) => json!.replace(/^ {3}/gm, ''))).filter((json) => json.includes('"op"'));

    expect(batches.length).toBeGreaterThan(8);
    for (const batch of batches) {
      expect(() => JSON.parse(batch), batch).not.toThrow();
      expect(bpmn(['apply', 'empty.bpmn', '-', '--dry-run', '--json'], folder, batch).err, batch).not.toMatch(/E_USAGE|E_UNKNOWN_ALIAS|E_DUPLICATE_ALIAS/);
    }
  }, SLOW);

  it('pipes batches in with printf, never through a heredoc, which Claude Code asks about', () => {
    expect(skillFiles().filter((file) => /<<\s*'?EOF/.test(md(file)))).toEqual([]);
  });
});

function graders(caseFolder: string): Grader[] {
  const folder = join(caseFolder, 'graders');
  return readdirSync(folder).filter((name) => name.endsWith('.md')).map((name) => {
    const { data, body } = frontmatter(md(join(folder, name)));
    return { name: name.replace(/\.md$/, ''), type: data.type as string, data, body };
  });
}

function graderOf(caseName: string, name: string): Grader {
  return graders(join(EVALS, caseName)).find((grader) => grader.name === name)!;
}

function regexPasses(grader: Grader, text: string): boolean {
  const flags = (grader.data.flags as string | undefined) ?? '';
  const match = (grader.data.match as string | undefined) ?? 'contains';
  const pattern = new RegExp(grader.data.pattern as string, flags);
  if (match === 'not_contains') {
    return !pattern.test(text);
  }
  const count = /^count:(\d+)$/.exec(match);
  if (count) {
    return [...text.matchAll(new RegExp(grader.data.pattern as string, flags.includes('g') ? flags : `${flags}g`))].length === Number(count[1]);
  }
  return pattern.test(text);
}

function fileGraders(caseFolder: string, file: string): Grader[] {
  return graders(caseFolder).filter((grader) => grader.type === 'regex' && (grader.data.target as Record<string, string> | undefined)?.path === file);
}

function scaffolded(name: string, caseName: string): string {
  const folder = workFolder(name);
  const scaffold = spawnSync('bash', [join(EVALS, caseName, 'scaffold.sh')], { cwd: folder, encoding: 'utf8' });
  expect(scaffold.status, scaffold.stderr).toBe(0);
  return folder;
}

function inputMatches(grader: Grader, input: unknown): boolean {
  return new RegExp(grader.data.input_match as string).test(JSON.stringify(input));
}

const SOLUTIONS: Record<string, { file: string; script: string; changeGraders: string[] }> = {
  'build-order-to-cash': {
    file: 'order-to-cash.bpmn',
    changeGraders: ['lanes', 'pools-and-message-flows', 'diagram'],
    script: `bpmn new order-to-cash.bpmn "Order to cash" --id orderToCash
bpmn apply order-to-cash.bpmn - <<'EOF'
[
  { "op": "add", "kind": "participant", "name": "Order to cash", "id": "participant_orderToCash" },
  { "op": "add", "kind": "participant", "name": "Customer", "id": "participant_customer", "blackBox": true },
  { "op": "add", "kind": "lane", "name": "Vertrieb", "id": "lane_vertrieb", "in": "participant_orderToCash" },
  { "op": "add", "kind": "lane", "name": "Lager", "id": "lane_lager", "in": "participant_orderToCash" },
  { "op": "add", "kind": "lane", "name": "Buchhaltung", "id": "lane_buchhaltung", "in": "participant_orderToCash" },
  { "op": "add", "kind": "startEvent:message", "name": "Order received", "id": "startEvent_orderReceived", "set": { "message": "Order" }, "in": "participant_orderToCash", "lane": "lane_vertrieb" },
  { "op": "add", "kind": "userTask", "name": "Check order", "id": "userTask_checkOrder", "after": "startEvent_orderReceived", "lane": "lane_vertrieb" },
  { "op": "add", "kind": "exclusiveGateway", "name": "Order accepted?", "id": "gateway_orderAccepted", "after": "userTask_checkOrder", "lane": "lane_vertrieb" },
  { "op": "add", "kind": "userTask", "name": "Pick and pack goods", "id": "userTask_pickAndPackGoods", "after": "gateway_orderAccepted", "flowName": "yes", "condition": "\${accepted}", "lane": "lane_lager" },
  { "op": "add", "kind": "userTask", "name": "Ship goods", "id": "userTask_shipGoods", "after": "userTask_pickAndPackGoods", "lane": "lane_lager" },
  { "op": "add", "kind": "sendTask", "name": "Send invoice", "id": "sendTask_sendInvoice", "after": "userTask_shipGoods", "lane": "lane_buchhaltung" },
  { "op": "add", "kind": "receiveTask", "name": "Receive payment", "id": "receiveTask_receivePayment", "set": { "message": "Payment" }, "after": "sendTask_sendInvoice", "lane": "lane_buchhaltung" },
  { "op": "add", "kind": "endEvent", "name": "Order completed", "id": "endEvent_orderCompleted", "after": "receiveTask_receivePayment", "lane": "lane_buchhaltung" },
  { "op": "add", "kind": "sendTask", "name": "Send rejection", "id": "sendTask_sendRejection", "after": "gateway_orderAccepted", "flowName": "no", "default": true, "lane": "lane_vertrieb" },
  { "op": "add", "kind": "endEvent", "name": "Order rejected", "id": "endEvent_orderRejected", "after": "sendTask_sendRejection", "lane": "lane_vertrieb" },
  { "op": "connect", "source": "participant_customer", "target": "startEvent_orderReceived", "set": { "name": "Order" } },
  { "op": "connect", "source": "sendTask_sendRejection", "target": "participant_customer", "set": { "name": "Rejection" } },
  { "op": "connect", "source": "sendTask_sendInvoice", "target": "participant_customer", "set": { "name": "Invoice" } },
  { "op": "connect", "source": "participant_customer", "target": "receiveTask_receivePayment", "set": { "name": "Payment" } }
]
EOF`,
  },
  'edit-hand-drawn-model': {
    file: 'purchase-request.bpmn',
    changeGraders: ['approval-inserted', 'timer-reminder', 'reminder-path'],
    script: `bpmn apply purchase-request.bpmn - <<'EOF'
[
  { "op": "add", "kind": "userTask", "name": "Approve purchase", "id": "userTask_approvePurchase", "flow": "Flow_0yq6cfd" },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "3 days", "id": "event_approvalOverdue", "on": "userTask_approvePurchase", "set": { "timer": "P3D", "nonInterrupting": true } },
  { "op": "add", "kind": "sendTask", "name": "Remind manager", "id": "sendTask_remindManager", "after": "event_approvalOverdue" },
  { "op": "add", "kind": "endEvent", "name": "Manager reminded", "id": "endEvent_managerReminded", "after": "sendTask_remindManager" }
]
EOF`,
  },
  'camunda7-external-task': {
    file: 'payment.bpmn',
    changeGraders: ['external-task', 'input-mapping', 'error-mapping', 'error-boundary-path'],
    script: `bpmn apply payment.bpmn - <<'EOF'
[
  { "op": "set", "id": "serviceTask_chargeCreditCard", "set": { "camunda:type": "external", "camunda:topic": "charge-credit-card" } },
  { "op": "ext", "id": "serviceTask_chargeCreditCard", "action": "add", "type": "camunda:inputParameter", "attrs": { "name": "amount" }, "body": "\${order.total}" },
  { "op": "add", "kind": "boundaryEvent:error", "name": "Card declined", "id": "event_cardDeclined", "on": "serviceTask_chargeCreditCard", "set": { "error": "Card declined", "errorCode": "CARD_DECLINED" } },
  { "op": "add", "kind": "userTask", "name": "Inform customer", "id": "userTask_informCustomer", "after": "event_cardDeclined" },
  { "op": "add", "kind": "endEvent", "name": "Payment failed", "id": "endEvent_paymentFailed", "after": "userTask_informCustomer" },
  { "op": "ext", "id": "serviceTask_chargeCreditCard", "action": "add", "type": "camunda:errorEventDefinition", "attrs": { "id": "ErrorMapping_CardDeclined", "errorRef": "error_cardDeclined", "expression": "\${declined}" } }
]
EOF`,
  },
  'format-happy-path': {
    file: 'claim-handling.bpmn',
    changeGraders: ['happy-path-green', 'rejection-below'],
    script: `bpmn apply claim-handling.bpmn - <<'EOF'
[
  { "op": "color", "path": ["startEvent_claimReceived", "endEvent_claimPaid"], "color": "green" },
  { "op": "place", "branch": "flow_claimCoveredToSendRejectionLetter", "below": "serviceTask_payOutClaim" }
]
EOF`,
  },
  'tidy-after-edit': {
    file: 'invoice-approval.bpmn',
    changeGraders: ['inform-requester', 'gateway-label-clear', 'no-crossing'],
    script: `bpmn add invoice-approval.bpmn sendTask "Inform requester" --id sendTask_informRequester --flow flow_returnInvoiceToSupplierToInvoiceReturned
bpmn apply invoice-approval.bpmn - <<'EOF'
[
  { "op": "label", "id": "gateway_invoiceCorrect", "side": "above" },
  { "op": "place", "branch": "flow_invoiceCorrectToReturnInvoiceToSupplier", "below": "sendTask_remindApprover" }
]
EOF
bpmn render invoice-approval.bpmn --problems -o .bpmn-render/invoice-approval.png`,
  },
  'camunda8-retoure-german': {
    file: 'retoure.bpmn',
    changeGraders: ['camunda8-file', 'job-workers', 'user-task-group', 'feel-gateway'],
    script: `bpmn new retoure.bpmn Retoure --id retoure --target camunda8
bpmn apply retoure.bpmn - <<'EOF'
[
  { "op": "add", "kind": "startEvent", "name": "Retoure angemeldet", "id": "startEvent_retoureAngemeldet", "in": "retoure" },
  { "op": "add", "kind": "userTask", "name": "Ware prüfen", "id": "userTask_warePruefen", "after": "startEvent_retoureAngemeldet" },
  { "op": "ext", "id": "userTask_warePruefen", "action": "add", "type": "zeebe:assignmentDefinition", "attrs": { "candidateGroups": "lager" } },
  { "op": "add", "kind": "exclusiveGateway", "name": "Ware in Ordnung?", "id": "gateway_wareInOrdnung", "after": "userTask_warePruefen" },
  { "op": "add", "kind": "serviceTask", "name": "Gutschrift erstellen", "id": "serviceTask_gutschriftErstellen", "after": "gateway_wareInOrdnung", "flowName": "ja", "condition": "= wareInOrdnung" },
  { "op": "ext", "id": "serviceTask_gutschriftErstellen", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "create-credit-note" } },
  { "op": "add", "kind": "endEvent", "name": "Retoure abgeschlossen", "id": "endEvent_retoureAbgeschlossen", "after": "serviceTask_gutschriftErstellen" },
  { "op": "add", "kind": "serviceTask", "name": "Ablehnungsmail senden", "id": "serviceTask_ablehnungsmailSenden", "after": "gateway_wareInOrdnung", "flowName": "nein", "condition": "= not(wareInOrdnung)" },
  { "op": "ext", "id": "serviceTask_ablehnungsmailSenden", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "send-rejection-mail" } },
  { "op": "add", "kind": "endEvent", "name": "Retoure abgelehnt", "id": "endEvent_retoureAbgelehnt", "after": "serviceTask_ablehnungsmailSenden" }
]
EOF
bpmn validate retoure.bpmn --strict`,
  },
};

describe('the eval suite', () => {
  const cases = readdirSync(EVALS, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(EVALS, entry.name, 'prompt.md'))).map((entry) => entry.name);

  it('has the cases the plugin is measured on, each with a realistic prompt and graders', () => {
    expect([...cases].sort()).toEqual(['build-order-to-cash', 'camunda7-external-task', 'camunda8-retoure-german', 'edit-hand-drawn-model', 'format-happy-path', 'ignores-python-question', 'tidy-after-edit']);
    for (const caseName of cases) {
      const { data, body } = frontmatter(md(join(EVALS, caseName, 'prompt.md')));

      expect(Object.keys(data).filter((key) => !PROMPT_KEYS.has(key))).toEqual([]);
      expect(body.trim().length).toBeGreaterThan(50);
      expect(body).not.toMatch(/\bskill\b|bpmn-cli|@miragon/i);
      expect(graders(join(EVALS, caseName)).length).toBeGreaterThan(0);
    }
  });

  it('names its scaffold in each case.yaml', () => {
    for (const caseName of cases.filter((name) => existsSync(join(EVALS, name, 'case.yaml')))) {
      const yaml = md(join(EVALS, caseName, 'case.yaml'));

      expect(yaml).toMatch(/^schema_version: "1\.1"$/m);
      expect(yaml).toMatch(new RegExp(`^name: ${caseName}$`, 'm'));
      expect(existsSync(join(EVALS, caseName, /scaffold_script: (\S+)/.exec(yaml)![1]!))).toBe(true);
    }
  });

  it('gives every grader a known type, and patterns that compile', () => {
    for (const grader of cases.flatMap((caseName) => graders(join(EVALS, caseName)))) {
      expect(GRADER_TYPES.has(grader.type), `${grader.name}: type ${grader.type}`).toBe(true);
      if (grader.type === 'regex') {
        expect(() => new RegExp(grader.data.pattern as string, (grader.data.flags as string) ?? ''), grader.name).not.toThrow();
      }
      if (grader.type === 'tool_used' && grader.data.input_match) {
        expect(() => new RegExp(grader.data.input_match as string), grader.name).not.toThrow();
      }
      if (grader.type === 'llm') {
        expect(grader.body.trim(), grader.name).toMatch(/PASS[\s\S]*FAIL/);
      }
    }
  });

  it('tells CLI use from hand-written XML in its tool graders', () => {
    const xml = graderOf('build-order-to-cash', 'no-xml-in-shell');
    const write = graderOf('build-order-to-cash', 'no-bpmn-write');
    const built = graderOf('build-order-to-cash', 'built-with-the-cli');
    const validated = graderOf('build-order-to-cash', 'validated');
    const skill = graderOf('build-order-to-cash', 'skill-used');
    const look = graderOf('tidy-after-edit', 'render-read');
    const strict = graderOf('camunda7-external-task', 'strict-validate-ran');

    expect(['bpmn-cli:bpmn', 'bpmn', 'pdf'].map((name) => inputMatches(skill, { skill: name }))).toEqual([true, true, false]);
    expect(inputMatches(xml, { command: `printf '%s' '[{ "op": "add", "kind": "userTask", "id": "userTask_checkOrder" }]' | bpmn apply order-to-cash.bpmn -` })).toBe(false);
    expect(inputMatches(xml, { command: `bpmn ext add f.bpmn serviceTask_x zeebe:ioMapping --xml '<zeebe:ioMapping><zeebe:input source="=a" target="b"/></zeebe:ioMapping>'` })).toBe(false);
    expect(inputMatches(xml, { command: `cat > order-to-cash.bpmn <<'EOF'\n<?xml version="1.0"?>\n<bpmn:definitions>` })).toBe(true);
    expect(inputMatches(xml, { command: `sed -i '' 's/Task_1/Task_2/' order-to-cash.bpmn` })).toBe(true);
    expect(inputMatches(write, { file_path: '/w/order-to-cash.bpmn', content: '<?xml' })).toBe(true);
    expect(inputMatches(write, { file_path: '/w/ops.json', content: '[]' })).toBe(false);
    expect(inputMatches(built, { command: `printf '%s' '[]' | bpmn apply order-to-cash.bpmn -` })).toBe(true);
    expect(inputMatches(built, { command: 'bpmn new order-to-cash.bpmn "Order to cash"' })).toBe(true);
    expect(inputMatches(built, { command: 'npx -y @miragon/bpmn-cli@1.2.3 add order-to-cash.bpmn userTask "Check order" --after startEvent_orderReceived' })).toBe(true);
    expect(inputMatches(built, { command: 'bpmn show order-to-cash.bpmn' })).toBe(false);
    expect(inputMatches(validated, { command: 'bpmn validate order-to-cash.bpmn --strict' })).toBe(true);
    expect(inputMatches(validated, { command: 'npx -y @miragon/bpmn-cli@1.2.3 validate order-to-cash.bpmn' })).toBe(true);
    expect(inputMatches(validated, { command: 'bpmn show order-to-cash.bpmn' })).toBe(false);
    expect(look.data.arm).toBe('with-only');
    expect(inputMatches(look, { file_path: '/w/.bpmn-render/invoice-approval.png' })).toBe(true);
    expect(inputMatches(look, { file_path: '/w/invoice-approval.bpmn' })).toBe(false);
    expect(inputMatches(strict, { command: 'bpmn validate payment.bpmn --strict' })).toBe(true);
    expect(inputMatches(strict, { command: 'bpmn validate payment.bpmn' })).toBe(false);
  });

  it.each(Object.entries(SOLUTIONS))('%s: a CLI solution passes every file grader; the starting point fails the change graders', (caseName, solution) => {
    const caseFolder = join(EVALS, caseName);
    const folder = existsSync(join(caseFolder, 'scaffold.sh')) ? scaffolded(`eval-${caseName}`, caseName) : workFolder(`eval-${caseName}`);
    if (existsSync(join(caseFolder, 'scaffold.sh'))) {
      const validation = bpmn(['validate', solution.file], folder);
      expect(validation.code, `${caseName}: the fixture is valid\n${validation.out}${validation.err}`).toBe(0);
      expect(validation.out).not.toMatch(/^import:/m);
      const before = md(join(folder, solution.file));
      for (const grader of fileGraders(caseFolder, solution.file).filter(({ name }) => solution.changeGraders.includes(name))) {
        expect(regexPasses(grader, before), `${caseName}/${grader.name} must fail on the untouched fixture`).toBe(false);
      }
    }

    runBlock(solution.script, folder);

    const after = md(join(folder, solution.file));
    const passed = fileGraders(caseFolder, solution.file);
    expect(passed.map(({ name }) => name)).toEqual(expect.arrayContaining(solution.changeGraders));
    expect(passed.filter((grader) => !regexPasses(grader, after)).map(({ name }) => name)).toEqual([]);
    const validation = bpmn(['validate', solution.file, '--strict'], folder);
    for (const grader of graders(caseFolder).filter(({ type, data }) => type === 'regex' && data.target === 'trace')) {
      expect(regexPasses(grader, validation.out), `${caseName}/${grader.name} on: ${validation.out}`).toBe(true);
    }
  }, SLOW);

  it('judges structure in edit-hand-drawn-model, whatever the style of the new ids', () => {
    const { file, script } = SOLUTIONS['edit-hand-drawn-model']!;
    const folder = scaffolded('eval-hash-ids', 'edit-hand-drawn-model');

    runBlock(script.replaceAll('userTask_approvePurchase', 'Activity_1a7mq4e').replaceAll('event_approvalOverdue', 'Event_1x6rt2w'), folder);

    const model = md(join(folder, file));
    expect(['approval-inserted', 'timer-reminder', 'reminder-path'].filter((name) => !regexPasses(graderOf('edit-hand-drawn-model', name), model))).toEqual([]);
    expect(regexPasses(graderOf('edit-hand-drawn-model', 'speaking-new-ids'), model)).toBe(false);
  }, SLOW);

  it('judges the colour in format-happy-path, whatever the green', () => {
    const { file, script } = SOLUTIONS['format-happy-path']!;
    const folder = scaffolded('eval-other-green', 'format-happy-path');

    runBlock(script, folder);

    const green = md(join(folder, file));
    const otherGreen = green.replace(/#205022/gi, '#43a047');
    expect(green).toMatch(/#205022/i);
    expect(regexPasses(graderOf('format-happy-path', 'happy-path-green'), otherGreen)).toBe(true);
    expect(regexPasses(graderOf('format-happy-path', 'rejection-not-green'), otherGreen.replace(/(bpmnElement="sendTask_sendRejectionLetter")/, '$1 bioc:stroke="#43a047"'))).toBe(false);
  }, SLOW);

  it('tidy-after-edit: the layout graders say what `bpmn diagram --json` says', () => {
    const file = 'invoice-approval.bpmn';
    const edit = `bpmn add ${file} sendTask "Inform requester" --id sendTask_informRequester --flow flow_returnInvoiceToSupplierToInvoiceReturned`;
    const branchBelow = `bpmn place ${file} --branch flow_invoiceCorrectToReturnInvoiceToSupplier --below sendTask_remindApprover`;
    const label = (side: string) => `bpmn label ${file} gateway_invoiceCorrect --side ${side}`;
    const variants: Record<string, string> = {
      'the fixture': 'true',
      'the edit only': edit,
      'the label fixed, the crossing left': `${edit}\n${label('above')}`,
      'the crossing fixed, the label left': `${edit}\n${branchBelow}`,
      'the solution (label above)': `${edit}\n${label('above')}\n${branchBelow}`,
      'the solution, then compact': `${edit}\n${label('above')}\n${branchBelow}\nbpmn compact ${file}`,
      'label below': `${edit}\n${branchBelow}\n${label('below')}`,
      'label left (on "Check invoice" and its flow)': `${edit}\n${branchBelow}\n${label('left')}`,
      'label right (on "Approve invoice" and the "yes" flow)': `${edit}\n${branchBelow}\n${label('right')}`,
    };
    for (const [name, script] of Object.entries(variants)) {
      const folder = scaffolded('eval-tidy-diagram', 'tidy-after-edit');
      runBlock(script, folder);

      const { problems } = JSON.parse(bpmn(['diagram', file, '--json'], folder).out) as { problems: { kind: string; ids: string[] }[] };
      const xml = md(join(folder, file));

      if (name === 'the fixture') {
        expect(problems.map(({ kind, ids }) => `${kind} ${ids.join(' ')}`).sort()).toEqual(['crossings flow_returnInvoiceToSupplierToInvoiceReturned flow_approvalOverdueToRemindApprover', 'labelClash gateway_invoiceCorrect userTask_approveInvoice']);
      }
      if (name.startsWith('the solution')) {
        expect(problems, name).toEqual([]);
      }
      if (name === 'the solution, then compact') {
        expect(xml).toMatch(/bpmnElement="sendTask_remindApprover"[^>]*>\s*<dc:Bounds x="720" y="327"/);
      }
      const labelProblem = problems.some(({ kind, ids }) => kind.startsWith('label') && ids.includes('gateway_invoiceCorrect'));
      const crossing = problems.some(({ kind }) => kind === 'crossings');
      expect(regexPasses(graderOf('tidy-after-edit', 'gateway-label-clear'), xml), `${name}: gateway-label-clear`).toBe(!labelProblem);
      expect(regexPasses(graderOf('tidy-after-edit', 'no-crossing'), xml), `${name}: no-crossing`).toBe(name !== 'the fixture' && !crossing);
      expect(regexPasses(graderOf('tidy-after-edit', 'main-line-kept'), xml), `${name}: main-line-kept`).toBe(true);
    }
  }, SLOW);

  it('edit-hand-drawn-model: a "no" path that joins a task without a gateway fails no-implicit-join', () => {
    const folder = scaffolded('eval-implicit-join', 'edit-hand-drawn-model');

    const { out } = runBlock(`bpmn apply purchase-request.bpmn - <<'EOF'
[
  { "op": "add", "kind": "userTask", "name": "Approve purchase", "id": "userTask_approvePurchase", "flow": "Flow_0yq6cfd" },
  { "op": "add", "kind": "exclusiveGateway", "name": "Purchase approved?", "id": "gateway_purchaseApproved", "after": "userTask_approvePurchase" },
  { "op": "connect", "source": "gateway_purchaseApproved", "target": "Activity_0f3j5ny", "set": { "name": "no", "default": true } }
]
EOF`, folder);

    expect(out).toMatch(/W_IMPLICIT_JOIN Activity_0f3j5ny/);
    expect(regexPasses(graderOf('edit-hand-drawn-model', 'no-implicit-join'), md(join(folder, 'purchase-request.bpmn')))).toBe(false);
  });
});
