/**
 * The project's bpmnlint configuration (issue #33): src/validate/bpmnlint-validator.ts (the
 * core: resolution, the advisory validator) and src/node/bpmnlint.ts (lookup,
 * loading, the resolver chain), with the real bpmnlint and
 * @miragon/bpmnlint-plugin-rules, offline.
 *
 * Every case builds a repository of its own in a temporary directory (a .git
 * directory, a .bpmnlintrc, models; a node_modules only where the case writes
 * project plugins), except the cases about a model outside a repository.
 * test/global-setup.ts makes sure no .bpmnlintrc above the temporary
 * directory changes them. The CLI cases run a build of src/ under
 * plain node (it loads bpmnlint and the plugin as the published package
 * does; vitest's module loader would hide a load failure), built into a
 * temporary directory of their own.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { bpmnlintUnavailableFindings, bpmnlintValidator, BPMNLINT_COVERS, resolveBpmnlintConfig, type BpmnlintEngine, type BpmnlintResolver } from '../src/validate/bpmnlint-validator.js';
import { idConventionsFromLint, ID_NAMING_RULE } from '../src/ids/conventions.js';
import { Doc } from '../src/model/document.js';
import type { CliError } from '../src/shared/errors.js';
import type { Op } from '../src/ops/types.js';
import { bpmnlintEngine, findBpmnlintConfig, loadBpmnlint, projectBpmnlint, projectBpmnlintSettings } from '../src/node/bpmnlint.js';
import { checkFile, checkLoadedDoc, mutateFile } from '../src/node/files.js';
import { gitRoot } from '../src/node/find-up.js';
import { checkDoc } from '../src/pipeline/index.js';
import { advisoryValidators, mutationReport, mutationSummary, renderMutation, renderSummary, renderValidation, validationReport } from '../src/report/command-report.js';
import type { ValidatorFinding, ValidatorIssue } from '../src/validate/validators.js';

const ROOT = join(import.meta.dirname, '..');
const fixture = (path: string): string => readFileSync(join(ROOT, 'test', 'fixtures', path), 'utf8');

let top: string;
beforeAll(() => {
  top = mkdtempSync(join(tmpdir(), 'bpmn-lint-'));
});
afterAll(() => rmSync(top, { recursive: true, force: true }));

let repos = 0;
/** A repository (a .git directory) with a .bpmnlintrc (text, or an object written as JSON; undefined: none) and files. */
function repo(rc: unknown, files: Record<string, string> = {}, parent = top): string {
  const dir = join(parent, `repo${++repos}`);
  mkdirSync(join(dir, '.git'), { recursive: true });
  if (rc !== undefined) writeFileSync(join(dir, '.bpmnlintrc'), typeof rc === 'string' ? rc : JSON.stringify(rc));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

/** A bpmnlint plugin in <dir>/node_modules/<name>: its configs and rules (rule name -> module source). */
function plugin(dir: string, name: string, def: { version?: string; configs?: Record<string, unknown>; rules?: Record<string, string>; main?: string }): string {
  const pkg = join(dir, 'node_modules', name);
  mkdirSync(join(pkg, 'rules'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version: def.version ?? '1.2.0', main: 'index.js' }));
  writeFileSync(join(pkg, 'index.js'), def.main ?? `module.exports = { configs: ${JSON.stringify(def.configs ?? {})} };`);
  for (const [rule, source] of Object.entries(def.rules ?? {})) writeFileSync(join(pkg, 'rules', `${rule}.js`), source);
  return pkg;
}

/** A model made with the in-memory API (a new file: every node lists its flows). */
async function model(ops: unknown[], name = 'Order'): Promise<string> {
  return (await applyToXml((await newXml({ processName: name })).xml, ops)).xml;
}

/** start "Received" -> userTask "Check" -> end "Done" in Process_Order. */
const LINE = [
  { op: 'add', kind: 'start', name: 'Received' },
  { op: 'add', kind: 'userTask', name: 'Check', after: 'Event_Received' },
  { op: 'add', kind: 'end', name: 'Done', after: 'Activity_Check' },
];

/** A moddle descriptor BpmnModdle takes, and fails on when it parses any file: a property that redefines one bpmn has not. */
const REDEFINES_NOTHING = { name: 'X', prefix: 'x', uri: 'http://example.org/x', types: [{ name: 'A', extends: ['bpmn:BaseElement'], properties: [{ name: 'id', type: 'String', redefines: 'bpmn:Nope#x' }] }] };

/** The same XML without the incoming / outgoing lists (a generated or hand-written model). */
const listless = (xml: string): string => xml.replace(/\s*<bpmn:(incoming|outgoing)>[^<]*<\/bpmn:\1>/g, '');

const lintOf = (issues: readonly unknown[]): ValidatorIssue[] => (issues as ValidatorIssue[]).filter((w) => w.validator === 'bpmnlint');
const codes = (issues: readonly unknown[]): string[] => (issues as Array<{ code: string; element?: string }>).map((w) => `${w.code}${w.element ? ` ${w.element}` : ''}`);

describe('resolveBpmnlintConfig: the effective rules', () => {
  it('normalises the names, keeps the options as bpmnlint hands them to the rule, runs any flag but off as a warning', async () => {
    const engine = bpmnlintEngine();
    const resolved = await resolveBpmnlintConfig(engine, {
      extends: 'bpmnlint:recommended',
      rules: {
        'bpmnlint/label-required': 'warn',
        '@miragon/bpmnlint-plugin-rules/element-id-naming': ['error', { case: 'PascalCase' }],
        '@miragon/rules/no-generated-ids': ['warn'],
        'no-disconnected': 0,
        'no-implicit-start': 'OFF',
        'fake-join': 3,
        'superfluous-gateway': 'warning',
        'no-inclusive-gateway': false,
        'single-blank-start-event': 2,
      },
    });
    expect(resolved.unavailable).toEqual([]);
    expect(resolved.rules['label-required']).toEqual({ severity: 'warn', config: {} });
    expect(resolved.rules['@miragon/rules/element-id-naming']).toEqual({ severity: 'error', config: { case: 'PascalCase' } });
    // ["warn"]: the rule gets undefined, like in bpmnlint
    expect(resolved.rules['@miragon/rules/no-generated-ids']).toEqual({ severity: 'warn', config: undefined });
    expect(resolved.rules['no-disconnected']!.severity).toBe('off');
    expect(resolved.rules['no-implicit-start']!.severity).toBe('off');
    expect(resolved.rules['fake-join']!.severity).toBe('info');
    // bpmnlint runs a rule whose flag it does not know
    expect(resolved.rules['superfluous-gateway']!.severity).toBe('warn');
    expect(resolved.rules['no-inclusive-gateway']!.severity).toBe('warn');
    expect(resolved.rules['single-blank-start-event']!.severity).toBe('error');
    // inherited, untouched
    expect(resolved.rules['end-event-required']).toEqual({ severity: 'error', config: {} });
  });

  it('a rule name bpmnlint cannot parse leaves out only that entry (bpmnlint fails on the whole file)', async () => {
    const resolved = await resolveBpmnlintConfig(bpmnlintEngine(), { extends: 'bpmnlint:recommended', rules: { 'no-implicit-end': 'off', 'no-disconnected': 'off', 'no-implicit-start': 'off', '@acme/foo': 'warn' } });
    expect(resolved.unavailable).toEqual([expect.objectContaining({ kind: 'rule', name: '@acme/foo', reason: 'unparseable rule name' })]);
    for (const rule of ['no-implicit-end', 'no-disconnected', 'no-implicit-start']) expect(resolved.rules[rule]!.severity, rule).toBe('off');
    expect(resolved.rules['label-required']!.severity).toBe('error');
  });

  it('awaits a resolver that answers with promises; a rejected rule is left out with its reason', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const rc = { extends: 'bpmnlint:recommended' };
    const sync = await resolveBpmnlintConfig({ Linter, resolver }, rc);
    const asyncResolver: BpmnlintResolver = {
      resolveRule: async (pkg, name) => resolver.resolveRule(pkg, name),
      resolveConfig: async (pkg, name) => resolver.resolveConfig(pkg, name),
    };
    const resolved = await resolveBpmnlintConfig({ Linter, resolver: asyncResolver }, rc);
    expect(resolved).toEqual(sync);
    const run = async (engine: BpmnlintEngine, r: typeof sync) => (await bpmnlintValidator(engine, r).validate!(xml, { phase: 'check', platform: 'none', ops: [], doc: () => Doc.fromXml(xml) })) as ValidatorFinding[];
    expect(await run({ Linter, resolver: asyncResolver }, resolved)).toEqual(await run({ Linter, resolver }, sync));
    const rejecting: BpmnlintResolver = { resolveConfig: asyncResolver.resolveConfig, resolveRule: async (pkg, name) => (name === 'label-required' ? Promise.reject(new Error('no label rule here')) : resolver.resolveRule(pkg, name)) };
    const partial = await resolveBpmnlintConfig({ Linter, resolver: rejecting }, rc);
    expect(partial.unavailable).toEqual([{ kind: 'rule', name: 'label-required', pkg: 'bpmnlint', reason: 'no label rule here' }]);
    expect(partial.rules['label-required']).toBeUndefined();
  });

  it('an extends entry that is no string, or a config that extends itself, is left out and named', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    const looping: BpmnlintResolver = {
      resolveRule: (pkg, name) => resolver.resolveRule(pkg, name),
      resolveConfig: (pkg, name) => (pkg === 'bpmnlint-plugin-loop' ? { extends: 'plugin:loop/self', rules: { 'bpmnlint/label-required': 'warn' } } : resolver.resolveConfig(pkg, name)),
    };
    const resolved = await resolveBpmnlintConfig({ Linter, resolver: looping }, { extends: ['bpmnlint:recommended', { _: 1 } as unknown as string, 'plugin:loop/self'] });
    expect(resolved.unavailable.map((u) => [u.kind, u.name, u.reason])).toEqual([
      ['config', '{"_":1}', 'extends takes config names (strings)'],
      ['config', 'plugin:loop/self', 'it extends itself, directly or through the configs it extends (a cycle; bpmnlint fails on the whole file with it); its rules apply once'],
    ]);
    expect(resolved.rules['label-required']!.severity).toBe('warn');
  });

  it('a cycle with fan-out (a config that extends itself twice, configs that extend each other) is walked once: one entry per config that closes it, its rules apply', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    const configs: Record<string, unknown> = {
      twice: { extends: ['plugin:cyc/twice', 'plugin:cyc/twice'], rules: { 'bpmnlint/label-required': 'warn' } },
      all: { extends: ['plugin:cyc/recommended', 'plugin:cyc/strict'], rules: { 'bpmnlint/no-gateway-join-fork': 'warn' } },
      recommended: { extends: ['plugin:cyc/all', 'plugin:cyc/strict'], rules: { 'bpmnlint/superfluous-gateway': 'warn' } },
      strict: { extends: ['plugin:cyc/all', 'plugin:cyc/recommended'], rules: { 'bpmnlint/single-blank-start-event': 'error' } },
    };
    const cyclic: BpmnlintResolver = {
      resolveRule: (pkg, name) => resolver.resolveRule(pkg, name),
      resolveConfig: (pkg, name) => (pkg === 'bpmnlint-plugin-cyc' ? configs[name] : resolver.resolveConfig(pkg, name)),
    };
    // before: 2^16 walks and a message of 900 KB (twice; three parents ran out of memory), seconds for the three configs
    const resolved = await resolveBpmnlintConfig({ Linter, resolver: cyclic }, { extends: ['plugin:cyc/twice', 'plugin:cyc/all'] });
    expect(resolved.unavailable.map((u) => u.name)).toEqual(['plugin:cyc/twice', 'plugin:cyc/all', 'plugin:cyc/recommended', 'plugin:cyc/strict']);
    expect(Object.fromEntries(Object.entries(resolved.rules).map(([name, s]) => [name, s.severity]))).toEqual({ 'label-required': 'warn', 'single-blank-start-event': 'error', 'superfluous-gateway': 'warn', 'no-gateway-join-fork': 'warn' });
    const findings = bpmnlintUnavailableFindings(resolved.unavailable);
    expect(findings.map((f) => f.message)).toEqual([
      'plugin:cyc/twice, plugin:cyc/all, plugin:cyc/recommended, plugin:cyc/strict left out: it extends itself, directly or through the configs it extends (a cycle; bpmnlint fails on the whole file with it); its rules apply once',
    ]);
  });

  it('a moddle module path the host resolved nothing for is left out and named, not dropped silently', async () => {
    const resolved = await resolveBpmnlintConfig(bpmnlintEngine(), { moddleExtensions: { camunda: 'camunda-bpmn-moddle/resources/camunda.json' } });
    expect(resolved.moddleExtensions).toEqual({});
    expect(resolved.unavailable).toEqual([expect.objectContaining({ kind: 'moddle', name: 'camunda', pkg: 'camunda-bpmn-moddle/resources/camunda.json', reason: 'a module path, which the host resolves' })]);
  });

  it('a moddle value that is neither a descriptor object nor a module path (5, null, true) is left out and named, with or without the host', async () => {
    const reason = 'neither a descriptor object nor a module path (bpmnlint fails on the whole file with it)';
    for (const host of [{ moddleExtensions: {} }, {}]) {
      const resolved = await resolveBpmnlintConfig(bpmnlintEngine(), { moddleExtensions: { a: 5, b: null, e: true } }, host);
      expect(resolved.moddleExtensions).toEqual({});
      expect(resolved.unavailable.map((u) => [u.kind, u.name, u.pkg, u.reason])).toEqual([
        ['moddle', 'a', '5', reason],
        ['moddle', 'b', 'null', reason],
        ['moddle', 'e', 'true', reason],
      ]);
    }
  });

  it('a moddleExtensions that is a string is left out as one entry, not one per character', async () => {
    for (const host of [{ moddleExtensions: {} }, {}]) {
      const resolved = await resolveBpmnlintConfig(bpmnlintEngine(), { moddleExtensions: 'camunda' as unknown as Record<string, unknown> }, host);
      expect(resolved.moddleExtensions).toEqual({});
      expect(bpmnlintUnavailableFindings(resolved.unavailable).map((f) => f.message)).toEqual([
        'moddleExtensions "camunda" left out: it is not an object of prefix -> descriptor or module path (bpmnlint fails on the whole file with it); rules reading the properties of a moddle extension may report findings that are not there',
      ]);
    }
    // the node layer reads no character as a module path: the validator line counts one
    const dir = repo({ extends: 'bpmnlint:recommended', moddleExtensions: 'camunda-bpmn-moddle/resources/camunda.json' });
    const loaded = await loadBpmnlint(join(dir, '.bpmnlintrc'), { from: dir });
    expect(loaded.ok && loaded.notes).toEqual([]);
    expect(loaded.detail).toBe('.bpmnlintrc in .; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)');
  });
});

describe('bpmnlintValidator: findings', () => {
  const ctx = (xml: string, phase: 'before' | 'after' | 'check' = 'check') => ({ phase, platform: 'none' as const, ops: [], doc: () => Doc.fromXml(xml) });

  it('maps a report to code, element, severity and a key without array indices; nothing else of the report', async () => {
    const engine = bpmnlintEngine();
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const v = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended', rules: { 'fake-join': 'info', 'label-required': 'warn' } }), { detail: 'test' });
    expect(v).toMatchObject({ name: 'bpmnlint', detail: 'test', blocks: false, covers: BPMNLINT_COVERS });
    const found = (await v.validate!(xml, ctx(xml))) as ValidatorFinding[];
    expect(found).toEqual([{ severity: 'warning', code: 'label-required', message: 'Element is missing label/name', element: 'Activity_AfterCheck', key: 'Activity_AfterCheck|name|Element is missing label/name' }]);
  });

  it('the key of a finding with a path leaves out the array indices: removing an earlier sibling changes nothing', async () => {
    const dir = repo({ extends: 'plugin:camunda-compat/camunda-cloud-8-10', moddleExtensions: { zeebe: 'zeebe-bpmn-moddle/resources/zeebe.json' } });
    const xml = await model(LINE).then((x) => applyToXml(x, [{ op: 'ext', id: 'Activity_Check', action: 'add', type: 'zeebe:input', attrs: { source: '=a', target: 'a' } }]));
    // a second input without target (the io-mapping rule reports it with its index in the path)
    const file = join(dir, 'c8.bpmn');
    writeFileSync(file, xml.xml.replace('<zeebe:input source="=a" target="a" />', '<zeebe:input source="=a" target="a" />\n          <zeebe:input source="=b" />'));
    const before = lintOf((await checkFile(file, { lintProjectCode: true })).validation.errors);
    expect(codes(before)).toContain('camunda-compat/io-mapping Activity_Check');
    const r = await mutateFile(file, [{ op: 'ext', id: 'Activity_Check', action: 'remove', type: 'zeebe:input[target=a]' }], { dryRun: true });
    const report = mutationReport(r);
    expect(codes(report.warnings.added)).not.toContain('camunda-compat/io-mapping Activity_Check');
    expect(codes(report.warnings.resolved)).not.toContain('camunda-compat/io-mapping Activity_Check');
  });

  it('a rule that throws (check or factory) is one W_LINT_FAILED; the others report, nothing goes to stderr', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    const local: Record<string, unknown> = {
      boom: () => ({ check: (node: { $type: string; id: string }) => {
        if (node.$type === 'bpmn:EndEvent') throw new Error(`kaboom on ${node.id}`);
      } }),
      'bad-options': (o: { size: number }) => ({ check: () => o.size.toFixed() }),
      'no-check': () => ({}),
      leave: () => ({ check: { leave: (node: { $type: string; id: string }) => { if (node.$type === 'bpmn:UserTask') throw new Error('on leave'); } } }),
    };
    const engine: BpmnlintEngine = { Linter, resolver: { resolveConfig: (pkg, name) => resolver.resolveConfig(pkg, name), resolveRule: (pkg, name) => (pkg === 'bpmnlint-plugin-local' ? local[name] : resolver.resolveRule(pkg, name)) } };
    const resolved = await resolveBpmnlintConfig(engine, { rules: { 'local/boom': 'warn', 'local/bad-options': ['error'], 'local/no-check': 'warn', 'local/leave': 'warn', 'label-required': 'error' } });
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const found = (await bpmnlintValidator(engine, resolved).validate!(xml, ctx(xml))) as ValidatorFinding[];
      expect(error).not.toHaveBeenCalled();
      expect(found.map((f) => `${f.code}: ${f.message}`).sort()).toEqual([
        'W_LINT_FAILED: bpmnlint rule local/bad-options failed: Cannot read properties of undefined (reading \'size\'); its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/boom failed: kaboom on Event_Done; its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/leave failed: on leave; its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/no-check failed: the rule has no check; its findings are left out',
        'label-required: Element is missing label/name',
      ]);
      expect(found.find((f) => f.code === 'W_LINT_FAILED')!.key).toMatch(/^failed\|local\//);
    } finally {
      error.mockRestore();
    }
  });

  it('an async check that rejects and a factory that returns a promise are W_LINT_FAILED, never an unhandled rejection; an async check keeps what it reported before its first await', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    type Node = { $type: string; id: string };
    const local: Record<string, unknown> = {
      'async-check': () => ({ async check(node: Node) {
        if (node.$type === 'bpmn:Process') throw new Error('async boom');
      } }),
      'async-later': () => ({ async check(node: Node) {
        await null;
        if (node.$type === 'bpmn:EndEvent') throw new Error('later boom');
      } }),
      'async-ok': () => ({ async check(node: Node, reporter: { report(id: string, message: string): void }) {
        if (node.$type === 'bpmn:EndEvent') reporter.report(node.id, 'reported before the first await');
      } }),
      'async-factory': async () => {
        throw new Error('async factory boom');
      },
      'async-factory-ok': async () => ({ check: () => undefined }),
    };
    const engine: BpmnlintEngine = { Linter, resolver: { resolveConfig: (pkg, name) => resolver.resolveConfig(pkg, name), resolveRule: (pkg, name) => (pkg === 'bpmnlint-plugin-local' ? local[name] : resolver.resolveRule(pkg, name)) } };
    const resolved = await resolveBpmnlintConfig(engine, { rules: Object.fromEntries([...Object.keys(local).map((name) => [`local/${name}`, 'warn']), ['label-required', 'error']]) });
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const found = (await bpmnlintValidator(engine, resolved).validate!(xml, ctx(xml))) as ValidatorFinding[];
      await new Promise((done) => setTimeout(done, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect(found.map((f) => `${f.code}${f.element ? ` ${f.element}` : ''}: ${f.message}`).sort()).toEqual([
        'W_LINT_FAILED: bpmnlint rule local/async-check failed: async boom; its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/async-factory failed: the rule factory returned a promise (bpmnlint rules are synchronous); its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/async-factory-ok failed: the rule factory returned a promise (bpmnlint rules are synchronous); its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/async-later failed: later boom; its findings are left out',
        'label-required Activity_AfterCheck: Element is missing label/name',
        'local/async-ok Event_Done: reported before the first await',
      ]);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a model bpmnlint cannot lint at all (a descriptor BpmnModdle takes but cannot parse with) is one W_LINT_FAILED that says no rule ran; a write leaves it out', async () => {
    const engine = bpmnlintEngine();
    const xml = await model(LINE);
    const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended', moddleExtensions: { x: REDEFINES_NOTHING } });
    expect(resolved.unavailable).toEqual([]);
    const failed = {
      severity: 'warning',
      code: 'W_LINT_FAILED',
      message: 'bpmnlint could not lint the model: refined property <bpmn:x> not found',
      key: 'failed|',
      hint: "No rule ran. Check the .bpmnlintrc's moddleExtensions (a descriptor bpmnlint cannot load fails in CI too); else report the file and the .bpmnlintrc. --no-lint-config skips bpmnlint.",
    };
    const v = bpmnlintValidator(engine, resolved);
    expect(await v.validate!(xml, ctx(xml))).toEqual([failed]);
    // a write does not compare it: its validator line says that no rule ran
    for (const phase of ['before', 'after'] as const) expect(await v.validate!(xml, ctx(xml, phase)), phase).toEqual([{ ...failed, leftOut: 'W_LINT_FAILED, no rule ran' }]);
  });

  it('a moddle descriptor BpmnModdle rejects (a prefix or uri already defined, an extends of an unknown type) is left out alone: W_LINT_UNAVAILABLE, the other rules run', async () => {
    const engine = bpmnlintEngine();
    const xml = await model([...LINE, { op: 'add', kind: 'task', in: 'Process_Order' }]);
    const ext = (prefix: string, more: object = {}) => ({ name: prefix.toUpperCase(), prefix, uri: `http://example.org/${prefix}`, types: [], ...more });
    const moddleExtensions = {
      dup: ext('bpmn'),
      nope: ext('nope', { types: [{ name: 'A', extends: ['bpmn:Nope'], properties: [] }] }),
      uri: ext('u', { uri: 'http://www.omg.org/spec/BPMN/20100524/MODEL' }),
      ok: ext('ok'),
      again: ext('ok'),
      empty: [],
      second: {},
    };
    const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended', moddleExtensions });
    expect(resolved.moddleExtensions).toEqual({ ok: moddleExtensions.ok, empty: [] });
    const hint = 'Fix the descriptor, or remove the moddleExtensions entry; bpmnlint in CI fails on the whole file with it.';
    expect(resolved.unavailable).toEqual([
      { kind: 'moddle', name: 'dup', pkg: 'descriptor object', reason: 'BpmnModdle rejects it (package with prefix <bpmn> already defined)', hint },
      { kind: 'moddle', name: 'nope', pkg: 'descriptor object', reason: expect.stringMatching(/^BpmnModdle rejects it \(.+\)$/), hint },
      { kind: 'moddle', name: 'uri', pkg: 'descriptor object', reason: 'BpmnModdle rejects it (package with uri <http://www.omg.org/spec/BPMN/20100524/MODEL> already defined)', hint },
      { kind: 'moddle', name: 'again', pkg: 'descriptor object', reason: 'BpmnModdle rejects it (package with prefix <ok> already defined)', hint },
      { kind: 'moddle', name: 'second', pkg: 'descriptor object', reason: 'BpmnModdle rejects it (package with prefix <undefined> already defined)', hint },
    ]);
    const found = (await bpmnlintValidator(engine, resolved).validate!(xml, ctx(xml))) as ValidatorFinding[];
    expect(codes(found.filter((f) => !f.code.startsWith('W_LINT_')))).toEqual(['label-required Activity_Task', 'no-disconnected Activity_Task', 'no-implicit-end Activity_Task', 'no-implicit-start Activity_Task']);
    expect(found.filter((f) => f.code.startsWith('W_LINT_')).map((f) => f.message)).toEqual([
      'moddle extension dup (descriptor object) left out: BpmnModdle rejects it (package with prefix <bpmn> already defined); rules reading dup: properties may report findings that are not there',
      expect.stringMatching(/^moddle extension nope \(descriptor object\) left out: BpmnModdle rejects it \(.+\); rules reading nope: properties may report findings that are not there$/),
      'moddle extension uri (descriptor object) left out: BpmnModdle rejects it (package with uri <http://www.omg.org/spec/BPMN/20100524/MODEL> already defined); rules reading uri: properties may report findings that are not there',
      'moddle extension again (descriptor object) left out: BpmnModdle rejects it (package with prefix <ok> already defined); rules reading again: properties may report findings that are not there',
      'moddle extension second (descriptor object) left out: BpmnModdle rejects it (package with prefix <undefined> already defined); rules reading second: properties may report findings that are not there',
    ]);
  });

  it('a new Linter per run: stateful rules (no-duplicate-sequence-flows) do not carry state from one run to the next', async () => {
    const engine = bpmnlintEngine();
    const xml = fixture('incremental/orders.bpmn');
    const v = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:all' }));
    const first = (await v.validate!(xml, ctx(xml))) as ValidatorFinding[];
    const second = (await v.validate!(xml, ctx(xml))) as ValidatorFinding[];
    expect(second).toEqual(first);
    expect(first.filter((f) => f.code === 'no-duplicate-sequence-flows')).toEqual([]);
  });

  it('finds what bpmnlint finds (orders.bpmn, gallery.bpmn), every finding once', async () => {
    const plugin = bpmnlintEngine().plugin;
    const rc = { extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation'] };
    for (const name of ['incremental/orders.bpmn', 'render/gallery.bpmn']) {
      const xml = fixture(name);
      const { Linter } = bpmnlintEngine();
      const { BpmnModdle } = await import('bpmn-moddle');
      const reports = await new Linter({ config: rc, resolver: plugin.createBundledResolver() }).lint((await new BpmnModdle().fromXML(xml)).rootElement);
      const expected = Object.entries(reports).flatMap(([rule, list]) => list.map((r) => `${rule} ${r.id ?? ''} ${r.message}`)).sort();
      const engine = bpmnlintEngine();
      const check = await checkDoc(await Doc.fromXml(xml), { validators: [bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, rc))] });
      const found = lintOf([...check.validation.errors, ...check.validation.warnings]).map((f) => `${f.code} ${f.element ?? ''} ${f.message}`).sort();
      expect(found, name).toEqual(expected);
      expect(found.length, name).toBeGreaterThan(5);
    }
  });

  it('the import warnings of the lint parse bpmn-cli\'s reader does not report: import-warning errors with a hint; bpmn-cli\'s decision link in a model without an engine has its own', async () => {
    const engine = bpmnlintEngine();
    const run = async (xml: string, rc: object) => {
      const v = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, rc));
      return { check: await checkDoc(await Doc.fromXml(xml)), found: (await v.validate!(xml, ctx(xml))) as ValidatorFinding[] };
    };
    // a model without an engine (no engine namespace): bpmn-cli's reader takes calledDecision as the decision link, bpmnlint's parse does not know it
    const design = await model([...LINE, { op: 'add', kind: 'businessRuleTask', name: 'Decide', after: 'Activity_Check' }, { op: 'set', id: 'Activity_Decide', values: { calledDecision: 'risk' } }]);
    const linked = await run(design, { rules: { 'label-required': 'error' } });
    expect(linked.check.importWarnings).toEqual([]);
    expect(linked.found).toEqual([{ severity: 'error', code: 'import-warning', message: 'Import warning: unknown attribute <calledDecision>', element: 'Activity_Decide', key: 'import|Activity_Decide|unknown attribute <calledDecision>', hint: expect.stringMatching(/^bpmn-cli's decision link in a model without an engine \(an unprefixed calledDecision on a business rule task; bpmn-cli's reader keeps it\): keep it\./) }]);
    // a moddle extension that declares the attribute: bpmnlint reads it
    const descriptor = { name: 'DesignIq', prefix: 'diq', uri: 'http://example.org/diq', types: [{ name: 'DecisionLink', extends: ['bpmn:BusinessRuleTask'], properties: [{ name: 'calledDecision', isAttr: true, type: 'String' }] }] };
    expect((await run(design, { rules: { 'label-required': 'error' }, moddleExtensions: { diq: descriptor } })).found).toEqual([]);
    // what bpmn-cli's reader reports itself is not listed again
    const foo = (await model(LINE)).replace('<bpmn:userTask id="Activity_Check"', '<bpmn:userTask foo="bar" id="Activity_Check"');
    const own = await run(foo, { rules: { 'label-required': 'error' } });
    expect(own.check.importWarnings).toEqual(['unknown attribute <foo>']);
    expect(own.found).toEqual([]);
    // an unresolved reference only the lint parse sees (a camunda errorRef read through the camunda moddle extension)
    const c7 = (await applyToXml((await newXml({ processName: 'Order', target: 'camunda7' })).xml, [...LINE, { op: 'add', kind: 'serviceTask', name: 'Call', after: 'Activity_Check' }])).xml
      .replace('<bpmn:serviceTask id="Activity_Call" name="Call">', '<bpmn:serviceTask id="Activity_Call" name="Call">\n      <bpmn:extensionElements><camunda:errorEventDefinition id="Def_X" errorRef="Error_Missing" /></bpmn:extensionElements>');
    const camunda = bpmnlintEngine().plugin.getDefaultLintConfig({ engine: 'c7' }).moddleExtensions!;
    const dangling = await run(c7, { rules: { 'label-required': 'error' }, moddleExtensions: camunda });
    expect(dangling.found).toEqual([expect.objectContaining({ severity: 'error', code: 'import-warning', message: 'Import warning: unresolved reference <Error_Missing>', element: 'Def_X', hint: expect.stringMatching(/^bpmnlint parses the file with the \.bpmnlintrc's moddle extensions only and reports this as an error; bpmnlint in CI fails on it too\./) })]);
  });
});

describe('covered lint warnings and the incoming / outgoing lists', () => {
  const run = async (xml: string, rules: Record<string, unknown> = {}) => {
    const engine = bpmnlintEngine();
    const v = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended', rules }));
    return checkDoc(await Doc.fromXml(xml), { validators: [v] });
  };

  it('each row of BPMNLINT_COVERS: the lint warning about the same element is dropped, the bpmnlint finding takes its hint', async () => {
    const empty = (await newXml({ processName: 'Order' })).xml;
    const noEnd = await model(LINE.slice(0, 2));
    for (const [xml, rule] of [[empty, 'start-event-required'], [empty, 'end-event-required'], [noEnd, 'no-implicit-end']] as const) {
      const lint = BPMNLINT_COVERS[rule]!;
      const plain = await checkDoc(await Doc.fromXml(xml));
      const warning = plain.validation.warnings.find((w) => w.code === lint)!;
      expect(warning, rule).toBeDefined();
      const checked = await run(xml);
      expect(codes(checked.validation.warnings), rule).not.toContain(`${lint} ${warning.element}`);
      const finding = [...checked.validation.errors, ...checked.validation.warnings].find((w) => w.code === rule && w.element === warning.element);
      expect(finding?.hint, rule).toBe(warning.hint);
    }
    // a rule that is off covers nothing
    const off = await run(noEnd, { 'no-implicit-end': 'off' });
    expect(codes(off.validation.warnings)).toContain('W_DEAD_END Activity_Check');
  });

  it('a file without incoming / outgoing lists: validate lists the list rules with a hint, a write leaves the false ones out', async () => {
    const xml = listless(await model(LINE));
    const checked = await run(xml);
    const lists = lintOf(checked.validation.errors).filter((f) => ['no-implicit-end', 'no-implicit-start', 'no-disconnected'].includes(f.code));
    expect(codes(lists).sort()).toEqual(['no-disconnected Activity_Check', 'no-disconnected Event_Done', 'no-disconnected Event_Received', 'no-implicit-end Activity_Check', 'no-implicit-end Event_Received', 'no-implicit-start Activity_Check', 'no-implicit-start Event_Done']);
    for (const f of lists) expect(f.hint).toMatch(/^The element has sequence flows the file does not list under incoming \/ outgoing, which no-/);
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'listless.bpmn': xml });
    const added = mutationReport(await mutateFile(join(dir, 'listless.bpmn'), [{ op: 'add', kind: 'userTask', name: 'Ship', after: 'Activity_Check' }], { dryRun: true })).warnings.added;
    expect(lintOf(added)).toEqual([]);
    // a node that really has no flow is reported (and covers W_DEAD_END)
    const loose = mutationReport(await mutateFile(join(dir, 'listless.bpmn'), [{ op: 'add', kind: 'userTask', name: 'Loose', in: 'Process_Order' }], { dryRun: true })).warnings.added;
    expect(codes(lintOf(loose))).toEqual(['no-disconnected Activity_Loose', 'no-implicit-end Activity_Loose', 'no-implicit-start Activity_Loose']);
    expect(codes(loose)).not.toContain('W_DEAD_END Activity_Loose');
    expect(lintOf(loose).find((f) => f.code === 'no-implicit-end')!.hint).toMatch(/^Continue the flow/);
  });

  it("a write on a file without incoming / outgoing lists counts the findings it leaves out: its totals are validate's, also after a new element; they never block", async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'listless.bpmn': listless(await model(LINE)) });
    const file = join(dir, 'listless.bpmn');
    expect((await checkFile(file)).validation.validators![0]!.counts).toEqual({ errors: 7, warnings: 0 });
    const lists = 'incoming / outgoing lists the file does not keep';
    const renamed = mutationReport(await mutateFile(file, [{ op: 'set', id: 'Activity_Check', values: { name: 'Check order' } }], { dryRun: true, lintFrom: dir }));
    expect(renamed.validation.validators).toEqual([{ name: 'bpmnlint', detail: '.bpmnlintrc in .', blocks: false, errors: [], warnings: [], preexisting: [], resolved: [], counts: { errors: 7, warnings: 0 }, leftOut: [{ reason: lists, count: 7 }] }]);
    expect(renderMutation(renamed)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 7 error(s), 0 warning(s) in the result (0 added, 0 resolved, 0 already in the file, 7 left out (incoming / outgoing lists the file does not keep; `bpmn validate <file>` lists them))\n');
    // --summary counts the findings the file already had among the warnings, and names the left-out ones in a line of its own
    const summary = mutationSummary(renamed);
    expect(summary.warnings.preexistingCount).toBe(renamed.warnings.preexistingCount);
    expect(summary.leftOut).toEqual([{ validator: 'bpmnlint', reason: lists, count: 7 }]);
    expect(renderSummary(summary, { dryRun: true }).split('\n')).toContain('validator bpmnlint: 7 left out (incoming / outgoing lists the file does not keep; `bpmn validate <file>` lists them)');
    // a new element: its list-rule findings are left out too, none is added; validate on the written file gives the same totals
    const added = await mutateFile(file, [{ op: 'add', kind: 'userTask', name: 'Ship', after: 'Activity_Check' }], { lintFrom: dir });
    expect(lintOf(mutationReport(added).warnings.added)).toEqual([]);
    const after = added.validation.validators![0]!;
    const validate = (await checkFile(file)).validation.validators![0]!;
    expect(after.counts).toEqual(validate.counts);
    expect(after.counts).toEqual({ errors: 10, warnings: 0 });
    expect(after.leftOut).toEqual([{ reason: lists, count: 10 }]);
    // lintBlocks: they do not block, and the line of a blocking validator names them too
    const blocking = mutationReport(await mutateFile(file, [{ op: 'set', id: 'Activity_Ship', values: { name: 'Ship order' } }], { dryRun: true, lintBlocks: true, lintFrom: dir }));
    expect(renderMutation(blocking)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 10 error(s), 0 warning(s) in the result (10 left out (incoming / outgoing lists the file does not keep; `bpmn validate <file>` lists them))\n');
    // a file that keeps its lists: no leftOut, the line as before
    const kept = repo({ extends: 'bpmnlint:recommended' }, { 'lists.bpmn': await model(LINE) });
    const plain = mutationReport(await mutateFile(join(kept, 'lists.bpmn'), [{ op: 'set', id: 'Activity_Check', values: { name: 'Check order' } }], { dryRun: true, lintFrom: kept }));
    expect(plain.validation.validators![0]).not.toHaveProperty('leftOut');
    expect(renderMutation(plain)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 0 error(s), 0 warning(s) in the result (0 added, 0 resolved, 0 already in the file)\n');
    expect(mutationSummary(plain)).not.toHaveProperty('leftOut');
  });

  it('a write on a file without the lists that gives a real dead end or a loose node a flow resolves no bpmnlint finding it still has; W_DEAD_END is resolved as itself', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'loose.bpmn': listless(await model([...LINE, { op: 'add', kind: 'task', name: 'Loose', in: 'Process_Order' }])) });
    const file = join(dir, 'loose.bpmn');
    // the loose task: no-disconnected, no-implicit-end and no-implicit-start, real ones (it has no flow)
    expect(codes(lintOf((await checkFile(file)).validation.errors)).filter((c) => c.endsWith('Activity_Loose'))).toEqual(['no-disconnected Activity_Loose', 'no-implicit-end Activity_Loose', 'no-implicit-start Activity_Loose']);
    for (const ops of [[{ op: 'add', kind: 'end', name: 'Fin', after: 'Activity_Loose' }], [{ op: 'connect', source: 'Activity_Check', target: 'Activity_Loose' }]] as Op[][]) {
      const r = mutationReport(await mutateFile(file, ops, { dryRun: true, lintFrom: dir }));
      const v = r.validation.validators![0]!;
      // bpmnlint in CI still reports them (the lists stay unwritten): left out, not resolved
      expect(lintOf(r.warnings.resolved), ops[0]!.op).toEqual([]);
      expect(v.resolved, ops[0]!.op).toEqual([]);
      // added + already in the file + left out = the totals
      const kept = v.counts.errors + v.counts.warnings - v.warnings.length - v.leftOut![0]!.count;
      expect(renderMutation(r), ops[0]!.op).toContain(` in the result (${v.warnings.length} added, 0 resolved, ${kept} already in the file, ${v.leftOut![0]!.count} left out (`);
    }
    const ended = mutationReport(await mutateFile(file, [{ op: 'add', kind: 'end', name: 'Fin', after: 'Activity_Loose' }], { dryRun: true, lintFrom: dir }));
    expect(codes(ended.warnings.resolved)).toEqual(['W_DEAD_END Activity_Loose']);
    expect(ended.validation.validators![0]).toMatchObject({ counts: { errors: 12, warnings: 0 }, leftOut: [{ count: 11 }] });
    const connected = mutationReport(await mutateFile(file, [{ op: 'connect', source: 'Activity_Check', target: 'Activity_Loose' }], { dryRun: true, lintFrom: dir }));
    expect(codes(connected.warnings.resolved)).toEqual(['W_UNREACHABLE Activity_Loose']);
    expect(connected.validation.validators![0]).toMatchObject({ counts: { errors: 10, warnings: 0 }, leftOut: [{ count: 9 }] });
  });

  it('validate folds a list rule by hint: a real dead end keeps its own line and the fixing command', async () => {
    // Activity_Loose has an incoming flow and no outgoing one: a dead end among the findings of the missing lists
    const xml = listless(await model([...LINE, { op: 'add', kind: 'task', name: 'Ship', after: 'Activity_Check' }, { op: 'add', kind: 'task', name: 'Loose', in: 'Process_Order' }, { op: 'connect', source: 'Activity_Ship', target: 'Activity_Loose' }]));
    const engine = bpmnlintEngine();
    const v = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended' }));
    const lines = renderValidation(validationReport(await checkDoc(await Doc.fromXml(xml), { validators: [v] }))).split('\n');
    expect(lines).toContain('[bpmnlint error] no-implicit-end x3 [Event_Received, Activity_Check, Activity_Ship]: Element is an implicit end  (The element has sequence flows the file does not list under incoming / outgoing, which no-implicit-end reads (bpmnlint in CI reports it too); bpmn-cli writes those lists only where the file keeps them.)');
    expect(lines.find((l) => l.startsWith('[bpmnlint error] no-implicit-end Activity_Loose: Element is an implicit end  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Activity_Loose`)'))).toBeDefined();
  });

  it('event-based-gateway counts the outgoing list: validate lists it with the hint, a write that draws two branches does not, one branch is reported in both', async () => {
    const base = listless(await model([{ op: 'add', kind: 'start', name: 'Paid' }, { op: 'add', kind: 'end', name: 'Done', after: 'Event_Paid' }]));
    const branches: Op[] = [
      { op: 'add', kind: 'eventBasedGateway', after: 'Event_Paid' },
      { op: 'add', kind: 'catch:timer', name: 'Timeout', flow: 'Flow_AfterPaidToDone' },
      { op: 'add', kind: 'catch:message', name: 'Answer', after: 'Gateway_AfterPaid', to: 'Event_Done' },
    ];
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'paid.bpmn': base });
    const file = join(dir, 'paid.bpmn');
    for (const lintBlocks of [false, true]) {
      const r = mutationReport(await mutateFile(file, branches, { dryRun: true, lintBlocks }));
      expect(codes(lintOf(r.warnings.added)), String(lintBlocks)).toEqual([]);
    }
    const two = await run((await mutateFile(file, branches, { dryRun: true })).xml);
    const gateway = lintOf(two.validation.errors).find((f) => f.code === 'event-based-gateway');
    expect(gateway).toMatchObject({ element: 'Gateway_AfterPaid', hint: expect.stringMatching(/^The element has sequence flows the file does not list under incoming \/ outgoing, which event-based-gateway reads/) });
    // one branch: a finding of the model, not of the lists
    const one = mutationReport(await mutateFile(file, branches.slice(0, 2), { dryRun: true }));
    expect(codes(lintOf(one.warnings.added))).toContain('event-based-gateway Gateway_AfterPaid');
    const single = lintOf((await run((await mutateFile(file, branches.slice(0, 2), { dryRun: true })).xml)).validation.errors).find((f) => f.code === 'event-based-gateway');
    expect(single?.hint).toBeUndefined();
  });
});

describe('the .bpmnlintrc on disk: lookup and flags', () => {
  it('the nearest .bpmnlintrc above the file wins; one above the repository root (.git directory or file) does not count', async () => {
    const outer = join(top, 'outer-lookup');
    mkdirSync(outer, { recursive: true });
    writeFileSync(join(outer, '.bpmnlintrc'), '{ "extends": "bpmnlint:recommended" }');
    const dir = repo(undefined, { 'models/a/x.bpmn': '' }, outer);
    expect(findBpmnlintConfig(join(dir, 'models', 'a'))).toBeUndefined();
    writeFileSync(join(dir, '.bpmnlintrc'), '{}');
    writeFileSync(join(dir, 'models', '.bpmnlintrc'), '{}');
    expect(findBpmnlintConfig(join(dir, 'models', 'a'))).toBe(join(dir, 'models', '.bpmnlintrc'));
    // a worktree or submodule: .git is a file
    const sub = join(dir, 'models', 'a');
    writeFileSync(join(sub, '.git'), 'gitdir: ../../.git/modules/a\n');
    expect(findBpmnlintConfig(sub)).toBeUndefined();
  });

  it('outside a git repository only the model\'s own directory counts, and project plugins do not run (bundled rules do)', async () => {
    const outside = join(top, 'outside');
    expect(gitRoot(top), 'the temporary directory lies in a git repository').toBeUndefined();
    const marker = join(outside, 'RAN.txt');
    const evil = { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` };
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    // a .bpmnlintrc and a plugin in a parent directory (~, /tmp): not looked at
    mkdirSync(join(outside, 'a', 'b'), { recursive: true });
    writeFileSync(join(outside, '.bpmnlintrc'), JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }));
    plugin(outside, 'bpmnlint-plugin-evil', evil);
    writeFileSync(join(outside, 'a', 'b', 'x.bpmn'), xml);
    expect(findBpmnlintConfig(join(outside, 'a', 'b'))).toBeUndefined();
    const below = await checkFile(join(outside, 'a', 'b', 'x.bpmn'), { lintProjectCode: true, lintFrom: join(outside, 'a', 'b') });
    expect(below.validation.validators).toBeUndefined();
    expect(renderValidation(validationReport(below))).toBe(renderValidation(validationReport(await checkFile(join(outside, 'a', 'b', 'x.bpmn'), { lintConfig: false }))));
    // stdin: from the working directory, the same
    expect((await checkLoadedDoc(await Doc.fromXml(xml), { lintProjectCode: true, lintFrom: join(outside, 'a', 'b') })).validation.validators).toBeUndefined();
    // in the model's own directory: the bundled rules run, the plugin does not
    writeFileSync(join(outside, 'x.bpmn'), xml);
    expect(findBpmnlintConfig(outside)).toBe(join(outside, '.bpmnlintrc'));
    const own = await checkFile(join(outside, 'x.bpmn'), { lintProjectCode: true, lintFrom: outside });
    expect(codes(lintOf(own.validation.errors))).toContain('label-required Activity_AfterCheck');
    expect(own.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => `${w.message}  (${w.hint})`)).toEqual([
      'plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in . is in none)  (Keep the .bpmnlintrc and the plugin in a git repository, or remove the plugin from the configuration; --no-lint-config skips bpmnlint.)',
    ]);
    // a library host without lintProjectCode: the hint does not send it to a setting that would not help
    const host = await checkFile(join(outside, 'x.bpmn'), { lintFrom: outside });
    expect(host.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => `${w.message}  (${w.hint})`)).toEqual([
      'plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)  (Remove it from the configuration; lintProjectCode: true would not run it either: bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in . is in none).)',
    ]);
    expect(existsSync(marker)).toBe(false);
  });

  // POSIX uids; as root every file belongs to root, which counts as one's own
  it.skipIf(!process.getuid || process.getuid() === 0)('a repository whose .git belongs to another user (a planted /tmp/.git): its .bpmnlintrc applies with the rules bpmn-cli ships, its project plugins do not run, W_LINT_UNAVAILABLE says why', async () => {
    const marker = join(top, 'RAN-foreign.txt');
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'x.bpmn': xml, 'models/y.bpmn': xml });
    plugin(dir, 'bpmnlint-plugin-evil', { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const why = (from: string) => `plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only in a repository of the user running it (the repository of ${from} belongs to another user)`;
    // the files belong to the user running the tests: seen from another uid they belong to someone else
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(424242);
    try {
      // the lookup goes up to the repository root, whoever owns it
      expect(findBpmnlintConfig(join(dir, 'models'))).toBe(join(dir, '.bpmnlintrc'));
      for (const [file, from, git] of [[join(dir, 'x.bpmn'), dir, '.git'], [join(dir, 'models', 'y.bpmn'), join(dir, 'models'), '../.git']] as const) {
        const checked = await checkFile(file, { lintProjectCode: true, lintFrom: from });
        expect(codes(lintOf(checked.validation.errors)), file).toContain('label-required Activity_AfterCheck');
        expect(checked.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => w.message), file).toEqual([why(git)]);
        // git's safe.directory is not read: the hint does not say git refuses the repository
        expect(checked.validation.warnings.find((w) => w.code === 'W_LINT_UNAVAILABLE')?.hint).toBe("Check who created that repository and its .git; run bpmn-cli as its owner (git's safe.directory does not change this), or remove the plugin from the configuration; --no-lint-config skips bpmnlint.");
      }
      expect(existsSync(marker)).toBe(false);
    } finally {
      uid.mockRestore();
    }
    // as its owner: the plugin runs
    await checkFile(join(dir, 'models', 'y.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(existsSync(marker)).toBe(true);
  });

  // what git checks (lstat): a .git link or hard link counts by its own owner, not by what it points to
  it.skipIf(!process.getuid || process.getuid() === 0)('a .git link to / or hard link, planted by another user: the .bpmnlintrc applies, its plugins do not run; a hard link to a file that names no git directory is no repository; root runs plugins only in its own and, under sudo, SUDO_UID\'s', async () => {
    const me = process.getuid!();
    const evil = (marker: string) => ({ main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const store = join(top, 'planted-store');
    mkdirSync(join(store, 'wt.git'), { recursive: true });
    writeFileSync(join(store, 'gitfile'), `gitdir: ${join(store, 'wt.git')}\n`);
    // [name, how the .git is planted, whether it makes a repository]
    const layouts: Array<[string, (git: string) => void, boolean]> = [
      ['planted-symlink', (git) => symlinkSync('/', git), true],
      ['planted-hardlink-gitfile', (git) => linkSync(join(store, 'gitfile'), git), true],
      // /etc/hosts names no git directory: git takes it for no repository, and so does the lookup
      ['planted-hardlink', (git) => linkSync('/etc/hosts', git), false],
    ];
    const cases: Array<{ dir: string; marker: string; counts: boolean }> = [];
    for (const [name, git, counts] of layouts) {
      const dir = join(top, name);
      mkdirSync(join(dir, 'models'), { recursive: true });
      try {
        git(join(dir, '.git'));
      } catch {
        continue; // no hard links to root's files here (Linux: fs.protected_hardlinks)
      }
      writeFileSync(join(dir, '.bpmnlintrc'), JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }));
      plugin(dir, 'bpmnlint-plugin-evil', evil(join(dir, 'RAN.txt')));
      cases.push({ dir, marker: join(dir, 'RAN.txt'), counts });
    }
    expect(cases.length).toBeGreaterThan(1);
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const why = (git: string) => `plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only in a repository of the user running it (the repository of ${git} belongs to another user)`;
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(424242);
    try {
      for (const { dir, marker, counts } of cases) {
        writeFileSync(join(dir, 'models', 'y.bpmn'), xml);
        // seen from another uid, the planter's files are someone else's: the parent .bpmnlintrc applies (bpmn-cli's rules), its plugin does not run
        expect(findBpmnlintConfig(join(dir, 'models')), dir).toBe(counts ? join(dir, '.bpmnlintrc') : undefined);
        const below = await checkFile(join(dir, 'models', 'y.bpmn'), { lintProjectCode: true, lintFrom: join(dir, 'models') });
        if (counts) {
          expect(codes(lintOf(below.validation.errors)), dir).toContain('label-required Activity_AfterCheck');
          expect(below.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => w.message), dir).toEqual([why('../.git')]);
        } else {
          expect(below.validation.validators, dir).toBeUndefined();
        }
        // the .bpmnlintrc next to the model: bundled rules only
        writeFileSync(join(dir, 'x.bpmn'), xml);
        const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
        expect(codes(lintOf(checked.validation.errors)), dir).toContain('label-required Activity_AfterCheck');
        expect(checked.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => w.message), dir).toEqual([why('.git')]);
        expect(existsSync(marker), dir).toBe(false);
      }
    } finally {
      uid.mockRestore();
    }
    // root over the user's checkout: the .bpmnlintrc applies; plugins run for root's own files and, under sudo, those of SUDO_UID, not another user's
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'models/y.bpmn': xml });
    const marker = join(dir, 'RAN.txt');
    plugin(dir, 'bpmnlint-plugin-evil', evil(marker));
    const root = vi.spyOn(process, 'getuid').mockReturnValue(0);
    const run = async () => (await checkFile(join(dir, 'models', 'y.bpmn'), { lintProjectCode: true, lintFrom: dir })).validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => w.message);
    try {
      // only the decimal digits sudo writes (git's strtoul would also take a leading blank or +)
      for (const sudo of ['', ` ${me}`]) {
        vi.stubEnv('SUDO_UID', sudo);
        expect(findBpmnlintConfig(join(dir, 'models')), sudo).toBe(join(dir, '.bpmnlintrc'));
        expect(await run(), sudo).toEqual([why('.git')]);
        expect(existsSync(marker), sudo).toBe(false);
      }
      vi.stubEnv('SUDO_UID', String(me));
      expect(await run()).toEqual([]);
      expect(existsSync(marker)).toBe(true);
    } finally {
      root.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('a .git link or .git file of one\'s own counts like a .git directory; a .git file whose gitdir is missing does not', () => {
    const store = join(top, 'git-store');
    mkdirSync(join(store, 'wt.git'), { recursive: true });
    const layouts: Array<[string, (git: string) => void, boolean]> = [
      ['own-symlink', (git) => symlinkSync(join(store, 'wt.git'), git), true],
      ['own-gitfile', (git) => writeFileSync(git, `gitdir: ${join(store, 'wt.git')}\n`), true],
      ['own-gitfile-relative', (git) => writeFileSync(git, 'gitdir: ../git-store/wt.git\n'), true],
      ['gitfile-missing', (git) => writeFileSync(git, 'gitdir: ../git-store/missing.git\n'), false],
      ['gitfile-garbage', (git) => writeFileSync(git, 'not a gitfile\n'), false],
    ];
    for (const [name, git, counts] of layouts) {
      const dir = join(top, name);
      mkdirSync(join(dir, 'models'), { recursive: true });
      git(join(dir, '.git'));
      writeFileSync(join(dir, '.bpmnlintrc'), '{}');
      expect(findBpmnlintConfig(join(dir, 'models')), name).toBe(counts ? join(dir, '.bpmnlintrc') : undefined);
    }
  });

  it('a .git file that names no git directory is no repository, and the message says so (not "another user")', async () => {
    const dir = join(top, 'stale-worktree');
    const marker = join(dir, 'RAN.txt');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, '.git'), 'gitdir: ../missing/worktrees/x\n');
    writeFileSync(join(dir, '.bpmnlintrc'), JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:local/recommended'] }));
    plugin(dir, 'bpmnlint-plugin-local', { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const xml = await model(LINE);
    writeFileSync(join(dir, 'x.bpmn'), xml);
    writeFileSync(join(dir, 'sub', 'y.bpmn'), xml);
    const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(checked.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => `${w.message}  (${w.hint})`)).toEqual([
      'plugin:local/recommended left out: bpmnlint-plugin-local is not bundled with bpmn-cli, and bpmn-cli runs project plugins only inside a git repository (.git is a file that names no git directory, so git takes it for no repository either)  (Fix or remove that .git file (a worktree or submodule whose git directory moved), or remove the plugin from the configuration; --no-lint-config skips bpmnlint.)',
    ]);
    expect(findBpmnlintConfig(join(dir, 'sub'))).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
  });

  // simulated on POSIX: no process.getuid, HOME as the home directory
  it.skipIf(process.platform === 'win32')('where there are no uids (Windows), only a repository inside the home directory runs project plugins: a .git and a plugin planted at the drive root run nothing; a repository outside it (C:\\dev) gets its .bpmnlintrc with bpmn-cli\'s rules', async () => {
    const drive = join(top, 'win-drive');
    const home = join(drive, 'Users', 'me');
    const marker = join(drive, 'RAN.txt');
    const evil = (path: string) => ({ main: `require('fs').writeFileSync(${JSON.stringify(path)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    // C:\.git and C:\node_modules, which any user can create
    mkdirSync(join(drive, '.git'), { recursive: true });
    plugin(drive, 'bpmnlint-plugin-evil', evil(marker));
    const xml = await model(LINE);
    for (const name of ['Downloads/m/y.bpmn', 'Desktop/proj/x.bpmn']) {
      mkdirSync(dirname(join(home, name)), { recursive: true });
      writeFileSync(join(home, name), xml);
    }
    // the user's own ~/.bpmnlintrc, and a project folder without a repository of its own that names a plugin it did not install
    writeFileSync(join(home, '.bpmnlintrc'), JSON.stringify({ extends: 'bpmnlint:recommended' }));
    const proj = join(home, 'Desktop', 'proj');
    writeFileSync(join(proj, '.bpmnlintrc'), JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }));
    // a repository of the user's inside the home directory, with the plugin installed, and one whose .git file names no git directory
    const own = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'models/z.bpmn': xml }, home);
    const ownMarker = join(own, 'RAN.txt');
    plugin(own, 'bpmnlint-plugin-evil', evil(ownMarker));
    const stale = join(home, 'stale');
    mkdirSync(join(stale, 'models'), { recursive: true });
    writeFileSync(join(stale, '.git'), 'gitdir: ../missing.git\n');
    writeFileSync(join(stale, '.bpmnlintrc'), '{}');
    // a repository outside the home directory (C:\dev\proj), with the plugin installed
    const dev = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'models/z.bpmn': await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]) }, join(drive, 'dev'));
    const devMarker = join(dev, 'RAN.txt');
    plugin(dev, 'bpmnlint-plugin-evil', evil(devMarker));
    const homeOff = (git: string) => `plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only in a repository of the user running it, and where it cannot read file owners (Windows) only in one inside the home directory (${git} is outside it)  (Keep the repository inside your home directory, or remove the plugin from the configuration; --no-lint-config skips bpmnlint.)`;
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(undefined as unknown as number);
    vi.stubEnv('HOME', home);
    try {
      // the planted C:\.git makes C:\ a repository: the lookup goes up to it (the user's own ~/.bpmnlintrc here); only bundled rules run
      expect(findBpmnlintConfig(join(home, 'Downloads', 'm'))).toBe(join(home, '.bpmnlintrc'));
      const checked = await checkFile(join(proj, 'x.bpmn'), { lintProjectCode: true, lintFrom: proj });
      expect(checked.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => `${w.message}  (${w.hint})`)).toEqual([homeOff('../../../../.git')]);
      expect(existsSync(marker)).toBe(false);
      expect(findBpmnlintConfig(join(stale, 'models'))).toBeUndefined();
      // outside the home directory: the repository's .bpmnlintrc applies with bpmn-cli's rules, the plugin is left out and named
      expect(findBpmnlintConfig(join(dev, 'models'))).toBe(join(dev, '.bpmnlintrc'));
      const outside = await checkFile(join(dev, 'models', 'z.bpmn'), { lintProjectCode: true, lintFrom: join(dev, 'models') });
      expect(codes(lintOf(outside.validation.errors))).toContain('label-required Activity_AfterCheck');
      expect(outside.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => `${w.message}  (${w.hint})`)).toEqual([homeOff('../.git')]);
      expect(existsSync(devMarker)).toBe(false);
      // inside the home directory: the parent .bpmnlintrc counts and the plugin runs
      expect(findBpmnlintConfig(join(own, 'models'))).toBe(join(own, '.bpmnlintrc'));
      await checkFile(join(own, 'models', 'z.bpmn'), { lintProjectCode: true, lintFrom: own });
      expect(existsSync(ownMarker)).toBe(true);
    } finally {
      uid.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  // symbolic links to directories need rights on Windows
  it.skipIf(process.platform === 'win32')('a model reached through a linked directory: the path as given first, then the physical directory (as git finds the repository)', async () => {
    // physical paths, like the CLI's working directory (the temporary directory itself may be reached through a link)
    const base = join(realpathSync(top), 'links');
    mkdirSync(base, { recursive: true });
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'models/x.bpmn': xml }, base);
    // outside/mlink -> repo/models: as given, outside lies in no repository and has no .bpmnlintrc; the physical directory is the repository's
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(join(dir, 'models'), join(outside, 'mlink'), 'dir');
    expect(findBpmnlintConfig(join(outside, 'mlink'))).toBe(join(dir, '.bpmnlintrc'));
    // a subdirectory a write is about to create: from its deepest existing ancestor
    expect(findBpmnlintConfig(join(outside, 'mlink', 'new', 'deeper'))).toBe(join(dir, '.bpmnlintrc'));
    // a linked model file counts by the directory of the link (outside: nothing)
    symlinkSync(join(dir, 'models', 'x.bpmn'), join(outside, 'flink.bpmn'), 'file');
    expect((await checkFile(join(outside, 'flink.bpmn'), { lintFrom: outside })).validation.validators ?? []).toEqual([]);
    const linked = await checkFile(join(outside, 'mlink', 'x.bpmn'), { lintProjectCode: true, lintFrom: outside });
    expect(linked.validation.validators?.[0]).toMatchObject({ name: 'bpmnlint', detail: `.bpmnlintrc in ../${basename(dir)}` });
    expect(codes(lintOf(linked.validation.errors))).toContain('label-required Activity_AfterCheck');
    // stdin from the linked directory: the same lookup from lintFrom; the path as `..` resolves there
    expect(await projectBpmnlint(undefined, { lintFrom: join(outside, 'mlink') })).toMatchObject({ name: 'bpmnlint', detail: '.bpmnlintrc in ..' });
    // the opposite: repo/extlink -> a directory of another repository; as given the walk finds this repository's .bpmnlintrc, which stays
    const other = repo({ extends: 'bpmnlint:all' }, { 'models/y.bpmn': xml }, base);
    symlinkSync(join(other, 'models'), join(dir, 'extlink'), 'dir');
    expect(findBpmnlintConfig(join(dir, 'extlink'))).toBe(join(dir, '.bpmnlintrc'));
    expect(findBpmnlintConfig(join(other, 'models'))).toBe(join(other, '.bpmnlintrc'));
    // nothing either way (no repository as given, none physically): nothing runs
    const loose = join(base, 'loose');
    mkdirSync(join(loose, 'models'), { recursive: true });
    writeFileSync(join(base, '.bpmnlintrc'), '{}');
    symlinkSync(join(loose, 'models'), join(outside, 'llink'), 'dir');
    expect(findBpmnlintConfig(join(outside, 'llink'))).toBeUndefined();
  });

  it('lintConfig false runs nothing; a document without a file looks up from lintFrom only', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': await model(LINE) });
    expect(await projectBpmnlint(join(dir, 'x.bpmnl'), { lintConfig: false })).toBeUndefined();
    expect(await projectBpmnlint(join(dir, 'x.bpmn'))).toMatchObject({ name: 'bpmnlint', blocks: false });
    expect(await projectBpmnlint(undefined, {})).toBeUndefined();
    expect(await projectBpmnlint(undefined, { lintFrom: dir })).toMatchObject({ name: 'bpmnlint', detail: '.bpmnlintrc in .' });
    // stdin (`validate -`): checkLoadedDoc
    const doc = await Doc.fromXml(await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]));
    const checked = await checkLoadedDoc(doc, { lintFrom: dir });
    expect(codes(lintOf(checked.validation.errors))).toContain('label-required Activity_AfterCheck');
    // a host's own validator named bpmnlint: the .bpmnlintrc's does not run as well
    expect(await projectBpmnlint(join(dir, 'x.bpmn'), { validators: [{ name: 'bpmnlint', validate: () => [] }] })).toBeUndefined();
  });

  it('--lint-config: a file that cannot be read or is not strict JSON is E_LINT_CONFIG; a broken discovered one is W_LINT_UNAVAILABLE and bpmnlint does not run', async () => {
    const dir = repo('{ // a comment\n "extends": "bpmnlint:recommended", }', { 'x.bpmn': await model(LINE), 'other.json': '{ "extends": "bpmnlint:recommended" }' });
    const file = join(dir, 'x.bpmn');
    for (const lintConfig of ['missing.json', '.bpmnlintrc']) {
      const err = await checkFile(file, { lintConfig, lintFrom: dir }).then(() => undefined, (e: CliError) => e);
      expect(err, lintConfig).toMatchObject({ code: 'E_LINT_CONFIG', category: 'io' });
    }
    const other = await checkFile(file, { lintConfig: 'other.json', lintFrom: dir });
    expect(other.validation.validators?.[0]).toMatchObject({ name: 'bpmnlint', detail: '--lint-config other.json' });
    const broken = await checkFile(file, { lintFrom: dir });
    expect(broken.validation.validators?.[0]).toMatchObject({ detail: '.bpmnlintrc in .; bpmnlint did not run (bpmn validate lists why)', counts: { errors: 0, warnings: 1 } });
    expect(broken.validation.warnings.find((w) => w.code === 'W_LINT_UNAVAILABLE')?.message).toMatch(/^\.bpmnlintrc is not JSON \(.*; bpmnlint reads it with JSON\.parse: no comments, no trailing commas\); bpmnlint did not run$/);
  });

  it('the settings (projectBpmnlintSettings): same lookup, normalised names, off included, a later bare flag drops options, unresolvable rules left out', async () => {
    const dir = repo({
      extends: ['bpmnlint:recommended', 'plugin:local/base'],
      rules: { '@miragon/bpmnlint-plugin-rules/element-id-naming': ['error', { case: 'PascalCase' }], 'label-required': 'off', 'local/r': 'warn', 'missing/x': 'warn' },
    });
    plugin(dir, 'bpmnlint-plugin-local', { configs: { base: { rules: { r: ['error', { a: 1 }] } } }, rules: { r: 'module.exports = () => ({ check() {} });' } });
    const s = await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(s?.path).toBe(join(dir, '.bpmnlintrc'));
    expect(s?.rules['@miragon/rules/element-id-naming']).toEqual({ severity: 'error', config: { case: 'PascalCase' } });
    expect(s?.rules['label-required']).toEqual({ severity: 'off', config: {} });
    expect(s?.rules['local/r']).toEqual({ severity: 'warn', config: {} });
    expect(s?.rules['missing/x']).toBeUndefined();
    expect(s?.unavailable.map((u) => u.name)).toEqual(['missing/x']);
    expect(await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintConfig: false })).toBeUndefined();
    const jsonc = repo('{ "extends": "bpmnlint:recommended", }');
    const broken = await projectBpmnlintSettings(join(jsonc, 'x.bpmn'));
    expect(broken).toMatchObject({ rules: {}, unavailable: [{ kind: 'file' }] });
  });
});

describe('the resolver chain: bundled, shipped, project', () => {
  const chainOf = async (dir: string, projectCode = true) => {
    const loaded = await loadBpmnlint(join(dir, '.bpmnlintrc'), { projectCode, from: dir });
    if (!loaded.ok) throw new Error(loaded.detail);
    return { loaded, used: loaded.engine.resolver.used };
  };

  it('offline: the bundle answers recommended, @miragon/rules and camunda-compat 7-24; the moddle path maps to the plugin\'s descriptor', async () => {
    const xml = await (async () => {
      const created = (await newXml({ processName: 'Order', target: 'camunda7' })).xml;
      return (await applyToXml(created, LINE)).xml;
    })();
    for (const spelling of ['camunda-bpmn-moddle/resources/camunda.json', 'camunda-bpmn-moddle/resources/camunda']) {
      const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation', 'plugin:camunda-compat/camunda-platform-7-24'], moddleExtensions: { camunda: spelling } }, { 'x.bpmn': xml });
      const { loaded, used } = await chainOf(dir);
      expect(new Set(used.values()), spelling).toEqual(new Set(['bundled']));
      expect(loaded.resolved.unavailable, spelling).toEqual([]);
      expect(Object.keys(loaded.resolved.moddleExtensions), spelling).toEqual(['camunda']);
      const found = lintOf((await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true })).validation.warnings);
      // historyTimeToLive is read as camunda:historyTimeToLive (no false finding)
      expect(codes(found), spelling).not.toContain('camunda-compat/history-time-to-live Process_Order');
    }
    // without the moddle extension the attribute is unknown, as bpmnlint in CI would see it
    const bare = repo({ extends: ['plugin:camunda-compat/camunda-platform-7-24'] }, { 'x.bpmn': xml });
    const found = lintOf((await checkFile(join(bare, 'x.bpmn'))).validation.warnings);
    expect(codes(found)).toContain('camunda-compat/history-time-to-live Process_Order');
  });

  it('camunda-compat configs the bundle lacks come from the camunda-compat bpmn-cli ships (offline, no project code)', async () => {
    for (const config of ['camunda-platform-7-19', 'camunda-cloud-8-6']) {
      const dir = repo({ extends: [`plugin:camunda-compat/${config}`] });
      const { loaded, used } = await chainOf(dir, false);
      expect(used.get(`config:bpmnlint-plugin-camunda-compat/${config}`), config).toBe('shipped');
      expect(loaded.resolved.unavailable, config).toEqual([]);
      expect(Object.keys(loaded.resolved.rules).length, config).toBeGreaterThan(0);
      expect(loaded.project).toEqual([]);
    }
  });

  it('bpmnlintEngine() for library hosts resolves the same offline: camunda-compat configs the bundle lacks, synchronously; what neither tier knows keeps the bundled resolver\'s error', async () => {
    const engine = bpmnlintEngine();
    const xml = (await applyToXml((await newXml({ processName: 'Order', target: 'camunda8' })).xml, LINE)).xml;
    for (const config of ['camunda-cloud-8-5', 'camunda-platform-7-20']) {
      const rc = { extends: [`plugin:camunda-compat/${config}`] };
      const resolved = await resolveBpmnlintConfig(engine, rc);
      expect(resolved.unavailable, config).toEqual([]);
      // the rules a .bpmnlintrc with the same configuration gets through the chain, and the same findings
      const dir = repo(rc, { 'x.bpmn': xml });
      const { loaded } = await chainOf(dir, false);
      expect(resolved.rules, config).toEqual(loaded.resolved.rules);
      expect(Object.keys(resolved.rules).length, config).toBeGreaterThan(0);
      const library = (await checkDoc(await Doc.fromXml(xml), { validators: [bpmnlintValidator(engine, resolved)] })).validation;
      const file = (await checkFile(join(dir, 'x.bpmn'))).validation;
      expect(codes(lintOf([...library.errors, ...library.warnings])), config).toEqual(codes(lintOf([...file.errors, ...file.warnings])));
    }
    expect(engine.resolver.resolveConfig('bpmnlint-plugin-camunda-compat', 'camunda-cloud-8-5')).toMatchObject({ rules: expect.any(Object) });
    expect(() => engine.resolver.resolveConfig('bpmnlint-plugin-camunda-compat', 'camunda-cloud-99-0')).toThrow('unknown config <bpmnlint-plugin-camunda-compat/camunda-cloud-99-0>');
    expect(() => engine.resolver.resolveRule('bpmnlint-plugin-acme', 'topic')).toThrow('unknown rule <bpmnlint-plugin-acme/topic>');
  });

  it('a project plugin runs from the repository\'s node_modules (named in the detail); a config the project answers pins its package', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:local/recommended', 'plugin:camunda-compat/camunda-cloud-99-0'], rules: { 'local/topic': ['info', { attr: 'topic' }] } }, { 'x.bpmn': await model([...LINE, { op: 'add', kind: 'serviceTask', name: 'Book', after: 'Activity_Check' }]) });
    plugin(dir, 'bpmnlint-plugin-local', {
      configs: { recommended: { rules: { topic: 'error' } } },
      rules: { topic: "module.exports = (o = {}) => ({ check(node, reporter) { if (node.$type === 'bpmn:ServiceTask') reporter.report(node.id, `Service task has no ${o.attr ?? 'camunda:topic'}`); } });" },
    });
    plugin(dir, 'bpmnlint-plugin-camunda-compat', {
      version: '9.9.9',
      configs: { 'camunda-cloud-99-0': { rules: { 'history-time-to-live': 'warn' } } },
      rules: { 'history-time-to-live': "module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') reporter.report(node.id, 'from the project'); } });" },
    });
    const { loaded, used } = await chainOf(dir);
    expect(loaded.project).toEqual(['bpmnlint-plugin-local@1.2.0', 'bpmnlint-plugin-camunda-compat@9.9.9']);
    expect(loaded.detail).toBe('.bpmnlintrc in .; project plugins: bpmnlint-plugin-local@1.2.0, bpmnlint-plugin-camunda-compat@9.9.9');
    expect(used.get('rule:bpmnlint-plugin-camunda-compat/history-time-to-live')).toBe('project');
    expect(used.get('rule:bpmnlint/label-required')).toBe('bundled');
    const found = lintOf((await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir })).validation.warnings);
    // info -> warning, options from the .bpmnlintrc
    expect(found.map((f) => `${f.code} ${f.element}: ${f.message}`)).toEqual(['local/topic Activity_Book: Service task has no topic', 'camunda-compat/history-time-to-live Process_Order: from the project']);
    // a host that does not run project code (the library default)
    const nocode = await chainOf(dir, false);
    expect(nocode.loaded.resolved.unavailable.map((u) => `${u.name}: ${u.reason}`)).toEqual([
      'plugin:local/recommended: bpmnlint-plugin-local is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)',
      'plugin:camunda-compat/camunda-cloud-99-0: bpmnlint-plugin-camunda-compat 2.61.1 (bundled with bpmn-cli) has no config camunda-cloud-99-0, and this host does not run project plugins (lintProjectCode)',
      'local/topic: bpmnlint-plugin-local is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)',
    ]);
  });

  it('project code only from inside the repository: a plugin above the .git root and a moddle module do not run; a JSON descriptor loads', async () => {
    const outer = join(top, 'outer-bounds');
    const marker = join(outer, 'RAN.txt');
    plugin(outer, 'bpmnlint-plugin-up', { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const dir = repo({ extends: 'plugin:up/recommended', moddleExtensions: { x: './tools/x.cjs', y: './tools/y.json' } }, {
      'x.bpmn': await model(LINE),
      'tools/x.cjs': `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { name: 'X', prefix: 'x', uri: 'http://x', types: [] };`,
      'tools/y.json': JSON.stringify({ name: 'Y', prefix: 'y', uri: 'http://y', types: [] }),
    }, outer);
    const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(existsSync(marker)).toBe(false);
    const messages = checked.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => w.message);
    expect(messages).toEqual([
      expect.stringMatching(/^plugin:up\/recommended left out: bpmnlint-plugin-up resolves outside the repository \(.*bpmnlint-plugin-up.index\.js\); bpmn-cli loads project plugins only from inside .*repo\d+$/),
      'moddle extension x (./tools/x.cjs) left out: only JSON descriptors are loaded (tools/x.cjs); rules reading x: properties may report findings that are not there',
    ]);
    const loaded = await loadBpmnlint(join(dir, '.bpmnlintrc'), { projectCode: true });
    expect(loaded.ok && Object.keys(loaded.resolved.moddleExtensions)).toEqual(['y']);
  });

  it('what cannot be resolved is named once per package and reason, with a hint; the rest runs', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:missing/recommended'], rules: { 'missing/foo': 'error', 'nope-rule': 'warn', 'miragon/element-id-naming': 'warn' } }, { 'x.bpmn': await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]) });
    const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    const unavailable = checked.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => `${w.message}  (${w.hint})`);
    expect(unavailable).toEqual([
      'plugin:missing/recommended, missing/foo left out: bpmnlint-plugin-missing is not installed (looked up from .)  (Install it next to the .bpmnlintrc (npm i -D bpmnlint-plugin-missing) or remove it from the configuration; --no-lint-config skips bpmnlint.)',
      'nope-rule left out: bpmnlint 11.15.0 has no rule nope-rule  (bpmn-cli runs bpmnlint 11.15.0; update bpmn-cli or remove the rule.)',
      'miragon/element-id-naming left out: bpmnlint-plugin-miragon is not installed (looked up from .)  (Did you mean @miragon/rules/element-id-naming? bpmn-cli bundles that rule.)',
    ]);
    expect(codes(lintOf(checked.validation.errors))).toContain('label-required Activity_AfterCheck');
    // no rule: validate's text never folds them, each keeps its hint
    const text = renderValidation(validationReport(checked)).split('\n');
    expect(text.filter((l) => l.startsWith('[bpmnlint] W_LINT_UNAVAILABLE'))).toEqual(unavailable.map((u) => `[bpmnlint] W_LINT_UNAVAILABLE: ${u}`));
    // a write counts them, and its validator line says they are there
    expect(checked.validation.validators?.[0]?.detail).toBe('.bpmnlintrc in .; 3 left out (W_LINT_UNAVAILABLE; bpmn validate lists them)');
  });

  it('a library host without lintProjectCode is not told to install a package it would not run (in a repository of its user, outside one)', async () => {
    const rc = { rules: { 'camunda-compat/no-such-rule': 'warn', 'missing/foo': 'warn' } };
    const inRepo = repo(rc);
    const outside = join(top, 'outside-hints');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, '.bpmnlintrc'), JSON.stringify(rc));
    const hints = async (dir: string) => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintFrom: dir }))?.unavailable.map((u) => `${u.name}: ${u.hint}`);
    expect(await hints(inRepo)).toEqual([
      'camunda-compat/no-such-rule: Check the name; a newer bpmnlint-plugin-camunda-compat installed in the repository next to the .bpmnlintrc is used only when the host passes lintProjectCode: true.',
      'missing/foo: Remove it from the configuration, or install it next to the .bpmnlintrc (npm i -D bpmnlint-plugin-missing) and let the host pass lintProjectCode: true.',
    ]);
    expect(await hints(outside)).toEqual([
      'camunda-compat/no-such-rule: Check the name; a newer bpmnlint-plugin-camunda-compat installed next to the .bpmnlintrc would not be used either: this host does not run project plugins (lintProjectCode), and bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in . is in none).',
      'missing/foo: Remove it from the configuration; installing it would not help: this host does not run project plugins (lintProjectCode), and bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in . is in none).',
    ]);
  });

  it('a project plugin that fails to load is named with its error', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:bad/recommended'] }, { 'x.bpmn': await model(LINE) });
    plugin(dir, 'bpmnlint-plugin-bad', { main: "throw new Error('cannot start');" });
    const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(checked.validation.warnings.filter((w) => w.code === 'W_LINT_UNAVAILABLE').map((w) => `${w.message}  (${w.hint})`)).toEqual([
      'plugin:bad/recommended left out: bpmnlint-plugin-bad fails to load: cannot start  (Fix or reinstall bpmnlint-plugin-bad; --no-lint-config skips bpmnlint.)',
    ]);
  });
});

describe('a long-running host: the load cache follows what the .bpmnlintrc left out or read from the project', () => {
  const ALWAYS = "module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') reporter.report(node.id, 'always'); } });";
  const descriptor = (prefix: string, uri = `http://${prefix}`) => JSON.stringify({ name: prefix.toUpperCase(), prefix, uri, types: [] });

  it('a plugin or moddle package installed after the hint, and a descriptor fixed or edited, are picked up by the next call in the same process', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:local/recommended'], moddleExtensions: { y: './tools/y.json', z: 'z-moddle/resources/z' } }, { 'x.bpmn': await model(LINE), 'tools/y.json': '{ broken' });
    const opts = { lintProjectCode: true, lintFrom: dir };
    const left = async () => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), opts))!.unavailable.map((u) => `${u.name}: ${u.reason}`);
    expect(await left()).toEqual([
      'plugin:local/recommended: bpmnlint-plugin-local is not installed (looked up from .)',
      expect.stringMatching(/^y: cannot be read \(/),
      'z: not installed (looked up from .); bpmn-cli brings camunda-bpmn-moddle/resources/camunda.json and zeebe-bpmn-moddle/resources/zeebe.json only',
    ]);
    // the hint's npm i -D: the plugin runs from the next call on
    plugin(dir, 'bpmnlint-plugin-local', { configs: { recommended: { rules: { always: 'warn' } } }, rules: { always: ALWAYS } });
    expect(await left()).toEqual([expect.stringMatching(/^y: cannot be read/), expect.stringMatching(/^z: not installed/)]);
    expect(codes(lintOf((await checkFile(join(dir, 'x.bpmn'), opts)).validation.warnings))).toContain('local/always Process_Order');
    // the descriptor fixed, the moddle package installed
    writeFileSync(join(dir, 'tools', 'y.json'), descriptor('y'));
    expect(await left()).toEqual([expect.stringMatching(/^z: not installed/)]);
    mkdirSync(join(dir, 'node_modules', 'z-moddle', 'resources'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'z-moddle', 'resources', 'z.json'), descriptor('z'));
    expect(await left()).toEqual([]);
    // nothing changed: the same load; an edited descriptor of the project: a new load with it
    const rc = join(dir, '.bpmnlintrc');
    const before = await loadBpmnlint(rc, { projectCode: true, from: dir });
    expect(await loadBpmnlint(rc, { projectCode: true, from: dir })).toBe(before);
    expect(before.ok && Object.keys(before.resolved.moddleExtensions)).toEqual(['y', 'z']);
    writeFileSync(join(dir, 'tools', 'y.json'), descriptor('y', 'http://example.com/y/2'));
    const edited = await loadBpmnlint(rc, { projectCode: true, from: dir });
    expect(edited).not.toBe(before);
    expect(edited.ok && edited.resolved.moddleExtensions['y']).toMatchObject({ uri: 'http://example.com/y/2' });
    expect(await loadBpmnlint(rc, { projectCode: true, from: dir })).toBe(edited);
  });

  it('a project plugin that failed to load is loaded again once it is fixed; a library host without lintProjectCode gets the hint for the installed package', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:bad/recommended'] }, { 'x.bpmn': await model(LINE) });
    const pkg = plugin(dir, 'bpmnlint-plugin-bad', { main: "throw new Error('cannot start');" });
    const left = async (lintProjectCode: boolean) => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintProjectCode, lintFrom: dir }))!.unavailable.map((u) => `${u.name}: ${u.reason}`);
    expect(await left(true)).toEqual(['plugin:bad/recommended: bpmnlint-plugin-bad fails to load: cannot start']);
    writeFileSync(join(pkg, 'index.js'), `module.exports = { configs: { recommended: { rules: { always: 'error' } } } };`);
    writeFileSync(join(pkg, 'rules', 'always.js'), ALWAYS);
    expect(await left(true)).toEqual([]);
    // the host that does not run project code: not installed -> installed changes the reason
    const other = repo({ extends: ['plugin:later/recommended'] });
    const hostLeft = async () => (await projectBpmnlintSettings(join(other, 'x.bpmn'), { lintFrom: other }))!.unavailable.map((u) => `${u.name}: ${u.reason}`);
    expect(await hostLeft()).toEqual(['plugin:later/recommended: bpmnlint-plugin-later is not installed (looked up from .)']);
    plugin(other, 'bpmnlint-plugin-later', { configs: { recommended: { rules: {} } } });
    expect(await hostLeft()).toEqual(['plugin:later/recommended: bpmnlint-plugin-later is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)']);
  });

  it('a plugin and a moddle package found above the repository, then installed inside it as the hint says, are used from the next call (Node remembers where it found a package)', async () => {
    // a monorepo parent or ~ with its own node_modules
    const parent = join(top, 'above');
    const moddle = (base: string) => {
      mkdirSync(join(base, 'node_modules', 'z-moddle', 'resources'), { recursive: true });
      writeFileSync(join(base, 'node_modules', 'z-moddle', 'resources', 'z.json'), descriptor('z'));
    };
    plugin(parent, 'bpmnlint-plugin-outer', { configs: { recommended: { rules: { always: 'warn' } } }, rules: { always: ALWAYS } });
    moddle(parent);
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:outer/recommended'], moddleExtensions: { z: 'z-moddle/resources/z' } }, { 'x.bpmn': await model(LINE) }, parent);
    const opts = { lintProjectCode: true, lintFrom: dir };
    const left = async () => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), opts))!.unavailable.map((u) => `${u.name}: ${u.reason} (${u.hint})`);
    expect(await left()).toEqual([
      expect.stringMatching(/^plugin:outer\/recommended: bpmnlint-plugin-outer resolves outside the repository \(.*\(Install it inside the repository \(npm i -D bpmnlint-plugin-outer\)\.\)$/),
      expect.stringMatching(/^z: not installed \(looked up from \.\);.*\(Install its package next to the \.bpmnlintrc/),
    ]);
    // nothing changed: the same answer
    expect(await left()).toHaveLength(2);
    plugin(dir, 'bpmnlint-plugin-outer', { configs: { recommended: { rules: { always: 'error' } } }, rules: { always: ALWAYS } });
    expect(await left()).toEqual([expect.stringMatching(/^z: not installed/)]);
    const loaded = await loadBpmnlint(join(dir, '.bpmnlintrc'), { projectCode: true, from: dir });
    expect(loaded.ok && loaded.project).toEqual(['bpmnlint-plugin-outer@1.2.0']);
    expect(loaded.ok && loaded.resolved.rules['outer/always']).toMatchObject({ severity: 'error' });
    moddle(dir);
    expect(await left()).toEqual([]);
    const checked = (await checkFile(join(dir, 'x.bpmn'), opts)).validation;
    expect(codes(lintOf(checked.errors))).toContain('outer/always Process_Order');
  });

  it('a package or descriptor that appears while the load runs is seen by the next call (the state is taken before the load looks)', async () => {
    // a project plugin that writes the moddle descriptor when it is required: npm i finishing while the host lints
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:setup/recommended'], moddleExtensions: { z: 'z-moddle/resources/z' } }, { 'x.bpmn': await model(LINE) });
    const z = join(dir, 'node_modules', 'z-moddle', 'resources');
    plugin(dir, 'bpmnlint-plugin-setup', { main: `require('fs').mkdirSync(${JSON.stringify(z)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(join(z, 'z.json'))}, ${JSON.stringify(descriptor('z'))});\nmodule.exports = { configs: { recommended: { rules: {} } } };` });
    const left = async () => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir }))!.unavailable.map((u) => u.name);
    expect(await left()).toEqual(['z']);
    expect(await left()).toEqual([]);
    expect(await left()).toEqual([]);
  });
});

describe('writes and validate with a .bpmnlintrc (in process)', () => {
  const RC = { extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation'], rules: { 'no-overlapping-elements': 'off', 'missing/x': 'warn' } };

  it('a write lists the findings it added ([bpmnlint error] in text), never refuses for them, and counts the rest; the bytes differ from those without bpmnlint only in the ids element-id-naming declares', async () => {
    const dir = repo(RC, { 'x.bpmn': await model(LINE) });
    const file = join(dir, 'x.bpmn');
    const ops: Op[] = [{ op: 'add', kind: 'task', after: 'Activity_Check' }];
    const plain = await mutateFile(file, ops, { dryRun: true, lintConfig: false });
    const r = await mutateFile(file, ops, { dryRun: true, lintFrom: dir });
    // recommended-for-automation turns element-id-naming on: the new task and the flows bpmn-cli names take its prefixes and case (#34)
    const ids: Array<[string, string]> = [
      ['Activity_AfterCheck', 'task_afterCheck'],
      ['Flow_CheckToAfterCheck', 'flow_checkToAfterCheck'],
      ['Flow_AfterCheckToDone', 'flow_afterCheckToDone'],
    ];
    expect(r.xml).toBe(ids.reduce((xml, [a, b]) => xml.replaceAll(a, b), plain.xml));
    expect(r.conventions).toEqual({ ids: ['task_afterCheck', 'flow_checkToAfterCheck', 'flow_afterCheckToDone'], source: '.bpmnlintrc in .' });
    const report = mutationReport(r);
    // no element-id-naming finding is added; the spliced flow's old one (Flow_CheckToDone) is resolved by its rename
    expect(codes(lintOf(report.warnings.added))).toEqual(['label-required task_afterCheck']);
    expect(codes(lintOf(report.warnings.resolved))).toEqual(['@miragon/rules/element-id-naming Flow_CheckToDone']);
    expect(lintOf(report.warnings.added)[0]).toMatchObject({ severity: 'error' });
    // W_LINT_UNAVAILABLE is the same before and after: counted, not added
    expect(codes(report.warnings.added)).not.toContain('W_LINT_UNAVAILABLE');
    const v = report.validation.validators?.find((x) => x.name === 'bpmnlint');
    expect(v).toMatchObject({ blocks: false, errors: [], preexisting: [] });
    const text = renderMutation(report);
    expect(text).toContain('warning [bpmnlint error] label-required task_afterCheck: Element is missing label/name\n');
    const kept = v!.counts.errors + v!.counts.warnings - 1;
    expect(text).toContain(`\nvalidator bpmnlint (.bpmnlintrc in .; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)): ${v!.counts.errors} error(s), ${v!.counts.warnings} warning(s) in the result (1 added, ${v!.resolved.length} resolved, ${kept} already in the file)\n`);
    expect(text).toContain("\nconventions: task_afterCheck, flow_checkToAfterCheck, flow_afterCheckToDone follow element-id-naming (.bpmnlintrc in .), not the file's own id style  (`bpmn show <file> --conventions`)\n");
    // --summary has no validator line: its count line counts the old findings (the library form of the CLI's --summary)
    const summary = renderSummary(mutationSummary(report), { advisory: advisoryValidators(report) });
    expect(summary).toContain(`\nwarnings: ${report.warnings.added.length} added, ${report.warnings.resolved.length} resolved, ${report.warnings.preexistingCount + kept} already in the file\n`);
    expect(kept).toBeGreaterThan(0);
    // what a removal fixes is resolved, a renamed element keeps its findings
    const renamed = mutationReport(await mutateFile(file, [{ op: 'set', id: 'Activity_Check', values: { id: 'userTask_check' } }], { dryRun: true, lintFrom: dir }));
    expect(codes(lintOf(renamed.warnings.added))).toEqual([]);
    expect(codes(lintOf(renamed.warnings.resolved))).toEqual(['@miragon/rules/element-id-naming Activity_Check']);
  });

  it('a moddle descriptor on disk BpmnModdle rejects is left out and counted, the rules run in validate and writes; with one it cannot parse with, a write says that no rule ran', async () => {
    const loose = await model([...LINE, { op: 'add', kind: 'task', in: 'Process_Order' }]);
    const dup = { name: 'Dup', prefix: 'bpmn', uri: 'http://example.org/dup', types: [] };
    const dir = repo({ extends: 'bpmnlint:recommended', moddleExtensions: { dup: './moddle/dup.json' } }, { 'moddle/dup.json': JSON.stringify(dup), 'x.bpmn': loose });
    const file = join(dir, 'x.bpmn');
    const report = validationReport(await checkFile(file, { lintFrom: dir }));
    expect(codes(lintOf(report.errors))).toEqual(['label-required Activity_Task', 'no-disconnected Activity_Task', 'no-implicit-end Activity_Task', 'no-implicit-start Activity_Task']);
    const text = renderValidation(report);
    expect(text).toContain('\n[bpmnlint] W_LINT_UNAVAILABLE: moddle extension dup (./moddle/dup.json) left out: BpmnModdle rejects it (package with prefix <bpmn> already defined); rules reading dup: properties may report findings that are not there  (Fix the descriptor, or remove the moddleExtensions entry; bpmnlint in CI fails on the whole file with it.)\n');
    expect(text).toContain('\nvalidator bpmnlint (.bpmnlintrc in .; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)): 4 error(s), 1 warning(s) in the file\n');
    const named = mutationReport(await mutateFile(file, [{ op: 'set', id: 'Activity_Task', values: { name: 'Loose' } }], { dryRun: true, lintFrom: dir }));
    expect(codes(lintOf(named.warnings.resolved))).toEqual(['label-required Activity_Task']);
    expect(renderMutation(named)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)): 3 error(s), 1 warning(s) in the result (0 added, 1 resolved, 4 already in the file)\n');

    const broken = repo({ extends: 'bpmnlint:recommended', moddleExtensions: { x: './x.json' } }, { 'x.json': JSON.stringify(REDEFINES_NOTHING), 'x.bpmn': loose });
    expect(codes((await checkFile(join(broken, 'x.bpmn'), { lintFrom: broken })).validation.warnings)).toContain('W_LINT_FAILED');
    const failed = mutationReport(await mutateFile(join(broken, 'x.bpmn'), [{ op: 'set', id: 'Activity_Task', values: { name: 'Loose' } }], { dryRun: true, lintFrom: broken }));
    expect(failed.validation.validators![0]).toMatchObject({ resolved: [], counts: { errors: 0, warnings: 1 }, leftOut: [{ reason: 'W_LINT_FAILED, no rule ran', count: 1 }] });
    expect(renderMutation(failed)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 0 error(s), 1 warning(s) in the result (0 added, 0 resolved, 0 already in the file, 1 left out (W_LINT_FAILED, no rule ran; `bpmn validate <file>` lists it))\n');
    // --summary says that no rule ran
    expect(mutationSummary(failed).leftOut).toEqual([{ validator: 'bpmnlint', reason: 'W_LINT_FAILED, no rule ran', count: 1 }]);
    expect(renderSummary(mutationSummary(failed), { dryRun: true }).split('\n')).toContain('validator bpmnlint: 1 left out (W_LINT_FAILED, no rule ran; `bpmn validate <file>` lists it)');
    // a new file has nothing to compare: it lists the W_LINT_FAILED with its cause and hint
    const { mutateDocToFile } = await import('../src/node/files.js');
    const created = mutationReport(await mutateDocToFile(Doc.create({ processName: 'Order' }, join(broken, 'new.bpmn')), [], { mustNotExist: true, dryRun: true, lintFrom: broken }));
    expect(codes(lintOf(created.warnings.added))).toEqual(['W_LINT_FAILED']);
    expect(created.validation.validators![0]).not.toHaveProperty('leftOut');
    const createdText = renderMutation(created, { dryRun: true });
    expect(createdText).toContain("\nwarning [bpmnlint] W_LINT_FAILED: bpmnlint could not lint the model: refined property <bpmn:x> not found  (No rule ran. Check the .bpmnlintrc's moddleExtensions");
    expect(createdText).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 0 error(s), 1 warning(s) in the result (1 added, 0 resolved, 0 already in the file)\n');
  });

  it('a lint warning the change resolved that a bpmnlint finding covers is listed once, as that finding', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': (await newXml({ processName: 'Order' })).xml });
    const r = mutationReport(await mutateFile(join(dir, 'x.bpmn'), [{ op: 'add', kind: 'start', name: 'Received' }], { dryRun: true }));
    expect(codes(r.warnings.resolved)).toEqual(['start-event-required Process_Order']);
  });

  it('`new` lists the findings of the new model; lintBlocks makes bpmnlint block a write like a validator, old errors do not', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' });
    const doc = Doc.create({ processName: 'Order' }, join(dir, 'new.bpmn'));
    const { mutateDocToFile } = await import('../src/node/files.js');
    const created = await mutateDocToFile(doc, [], { mustNotExist: true });
    expect(codes(lintOf(mutationReport(created).warnings.added))).toEqual(['end-event-required Process_Order', 'start-event-required Process_Order']);
    expect(created.validation.validators?.[0]?.counts).toEqual({ errors: 2, warnings: 0 });
    // and validate fails on them (exit 2 in the CLI)
    expect((await checkFile(join(dir, 'new.bpmn'))).validation.errors.length).toBe(2);
    const err = await mutateFile(join(dir, 'new.bpmn'), [{ op: 'add', kind: 'task', in: 'Process_Order' }], { lintBlocks: true }).then(() => undefined, (e: CliError) => e);
    expect(err).toMatchObject({ code: 'E_VALIDATION' });
    expect(String(err?.details.hint)).toContain("The project's bpmnlint blocks here because the host asked for it (lintBlocks).");
    const fine = await mutateFile(join(dir, 'new.bpmn'), [{ op: 'set', id: 'Process_Order', values: { name: 'Orders' } }], { lintBlocks: true, dryRun: true });
    expect(fine.validation.validators?.[0]).toMatchObject({ errors: [], preexisting: [expect.objectContaining({ code: 'end-event-required' }), expect.objectContaining({ code: 'start-event-required' })] });
  });

  it('validate folds an advisory rule with three or more findings into one line; --json keeps every finding; a write groups by rule and message', async () => {
    const dir = repo(RC, { 'gallery.bpmn': fixture('render/gallery.bpmn') });
    const report = validationReport(await checkFile(join(dir, 'gallery.bpmn'), { lintFrom: dir }));
    const all = lintOf([...report.errors, ...report.warnings]);
    const text = renderValidation(report);
    const lines = text.split('\n').filter((l) => /^\[bpmnlint( error)?\] /.test(l));
    // one line per rule and hint (W_LINT_* is no rule: one line each)
    const byRule = new Map<string, number>();
    for (const f of all) {
      const key = f.code.startsWith('W_LINT_') ? `${f.code}|${byRule.size}` : `${f.code}|${f.hint ?? ''}`;
      byRule.set(key, (byRule.get(key) ?? 0) + 1);
    }
    expect(lines.length).toBe([...byRule.values()].reduce((n, c) => n + (c >= 3 ? 1 : c), 0));
    expect(lines.length).toBeLessThan(all.length / 3);
    // an error reads [bpmnlint error], a warning [bpmnlint]
    for (const f of all) expect(lines.some((l) => l.startsWith(`[bpmnlint${f.severity === 'error' ? ' error' : ''}] ${f.code}`)), f.code).toBe(true);
    const naming = lines.find((l) => l.startsWith('[bpmnlint] @miragon/rules/element-id-naming x'))!;
    const [, listed, convention] = naming.match(/^\[bpmnlint\] @miragon\/rules\/element-id-naming x\d+ \[([^\]]+)\]: (Element id must match the naming convention <\w+>) \(\d+ of \d+; \d+ others with \d+ other messages, --json lists them\)$/)!;
    // the ids listed are those with the message shown
    const ids = listed!.split(', ').filter((id) => !id.startsWith('+'));
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) expect(all.find((f) => f.code === '@miragon/rules/element-id-naming' && f.element === id)?.message, id).toBe(convention);
    const loose = ['A', 'B', 'C'].map((name): Op => ({ op: 'add', kind: 'task', name, in: 'Process_RenderGallery' }));
    const write = renderMutation(mutationReport(await mutateFile(join(dir, 'gallery.bpmn'), loose, { dryRun: true, lintFrom: dir })));
    expect(write).toMatch(/^warning \[bpmnlint error\] no-disconnected x3 \[task_a, task_b, task_c\]: Element is not connected$/m);
  });
});

describe('the id conventions of the .bpmnlintrc (#34, in process)', () => {
  const AUTOMATION = { extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation'] };
  const ADD: Op[] = [{ op: 'add', kind: 'serviceTask', name: 'Ship', after: 'Activity_Check' }];

  it('element-id-naming of the .bpmnlintrc decides the new ids; lintConfig false, a host\'s own conventions or its own bpmnlint validator switch the lookup off', async () => {
    const dir = repo(AUTOMATION, { 'x.bpmn': await model(LINE) });
    const file = join(dir, 'x.bpmn');
    const ids = async (opts: Parameters<typeof mutateFile>[2]) => (await mutateFile(file, ADD, { dryRun: true, lintFrom: dir, ...opts })).changes.created.map((c) => c.id);
    expect(await ids({})).toEqual(['serviceTask_ship', 'flow_shipToDone']);
    expect(await ids({ lintConfig: false })).toEqual(['Activity_Ship', 'Flow_ShipToDone']);
    expect(await ids({ conventions: { prefixes: { 'bpmn:ServiceTask': 'svc_' }, case: 'PascalCase' } })).toEqual(['svc_Ship', 'Flow_ShipToDone']);
    const own = bpmnlintValidator(bpmnlintEngine(), await resolveBpmnlintConfig(bpmnlintEngine(), { extends: 'bpmnlint:recommended' }));
    expect(await ids({ validators: [own] })).toEqual(['Activity_Ship', 'Flow_ShipToDone']);
  });

  it('a value new ids cannot follow is one W_CONFIG_IGNORED of the validator: validate and `new` list it, a write only counts it', async () => {
    const rc = { extends: 'bpmnlint:recommended', rules: { '@miragon/rules/element-id-naming': ['warn', { case: 'camelcase', prefixes: { 'bpmn:UserTask': 'user task_' } }] } };
    const dir = repo(rc, { 'x.bpmn': await model(LINE) });
    const file = join(dir, 'x.bpmn');
    const notes = (issues: readonly unknown[]) => lintOf(issues).filter((i) => i.code === 'W_CONFIG_IGNORED');
    const checked = await checkFile(file, { lintFrom: dir });
    expect(notes(checked.validation.warnings).map((n) => n.message)).toEqual([
      '.bpmnlintrc in .: @miragon/rules/element-id-naming case "camelcase" is unknown: the rule checks PascalCase, and new ids take it',
      ".bpmnlintrc in .: @miragon/rules/element-id-naming prefix of bpmn:UserTask \"user task_\" cannot start an id (a letter or _ first, then letters, digits, _ . -, at most 56 characters): new ids of the type follow the learned id style, and the rule reports them",
    ]);
    expect(renderValidation(validationReport(checked))).toMatch(/^\[bpmnlint\] W_CONFIG_IGNORED: \.bpmnlintrc in \.: @miragon\/rules\/element-id-naming case "camelcase" is unknown: .* {2}\(Write one of camelCase, PascalCase, snake_case, any in the \.bpmnlintrc\. Did you mean camelCase\?\)$/m);
    const write = await mutateFile(file, [...ADD, { op: 'add', kind: 'userTask', name: 'Approve', after: 'Activity_Check' }], { dryRun: true, lintFrom: dir });
    // the user task's prefix is ignored: learned from the file's ids that do not follow the rule (Activity_Check)
    expect(write.changes.created.map((c) => c.id)).toEqual(['serviceTask_Ship', 'flow_ShipToDone', 'Activity_Approve', 'flow_ApproveToShip']);
    const report = mutationReport(write);
    expect(notes(report.warnings.added)).toEqual([]);
    expect(renderMutation(report)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .; 2 element-id-naming values ignored (W_CONFIG_IGNORED; bpmn validate lists them)): ');
    const { mutateDocToFile } = await import('../src/node/files.js');
    const created = await mutateDocToFile(Doc.create({ processName: 'Order' }, join(dir, 'new.bpmn')), [], { dryRun: true, lintFrom: dir });
    expect(notes(mutationReport(created).warnings.added)).toHaveLength(2);
    // stdin: looked up from lintFrom
    expect(notes((await checkLoadedDoc(await Doc.fromXml(readFileSync(file, 'utf8')), { lintFrom: dir })).validation.warnings)).toHaveLength(2);
  });

  it('projectIdConventions: the conventions, the notes, the setting; nothing without a .bpmnlintrc or with lintConfig false', async () => {
    const { projectIdConventions } = await import('../src/node/bpmnlint.js');
    const dir = repo(AUTOMATION, { 'x.bpmn': await model(LINE) });
    const found = await projectIdConventions(join(dir, 'x.bpmn'), { lintFrom: dir });
    expect(found).toMatchObject({ notes: [], where: '.bpmnlintrc in .', setting: { severity: 'warn', config: {} }, conventions: { case: 'camelCase', qualifier: 'optional', source: '.bpmnlintrc in .' } });
    expect(found!.conventions!.prefixes['bpmn:UserTask']).toBe('userTask_');
    expect(await projectIdConventions(join(dir, 'x.bpmn'), { lintConfig: false })).toBeUndefined();
    expect(await projectIdConventions(join(repo(undefined), 'x.bpmn'))).toBeUndefined();
    // the rule off (as in recommended-for-modeling): nothing declared
    const modeling = repo({ extends: 'plugin:@miragon/rules/recommended-for-modeling' });
    expect((await projectIdConventions(join(modeling, 'x.bpmn'), { lintFrom: modeling }))?.conventions).toBeUndefined();
  });

  it('a .bpmnlintrc without element-id-naming, or with it off, writes every byte as without a .bpmnlintrc (the fixtures)', async () => {
    const fixtures = readdirSync(join(ROOT, 'test', 'fixtures'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.bpmn'));
    expect(fixtures.length).toBeGreaterThan(40);
    const off = repo({ extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-modeling'], rules: { '@miragon/rules/element-id-naming': 'off' } });
    const absent = repo({ extends: 'bpmnlint:recommended' });
    const compared: string[] = [];
    for (const fixture of fixtures) {
      const text = readFileSync(join(ROOT, 'test', 'fixtures', fixture), 'utf8');
      const doc = await Doc.fromXml(text).catch(() => undefined);
      const process = doc?.processes()[0]?.get<string>('id');
      const flow = doc ? [...doc.byId().values()].find((el) => el.$type === 'bpmn:SequenceFlow')?.get<string>('id') : undefined;
      if (!doc || !process || doc.lossyImportWarnings.length) continue;
      const ops: Op[] = [
        { op: 'add', kind: 'serviceTask', name: 'Conventions probe', in: process },
        { op: 'add', kind: 'xor', in: process },
        { op: 'add', kind: 'startEvent:timer', name: '2 days', in: process, timer: 'P2D' },
        ...(flow ? [{ op: 'add', kind: 'task', name: 'Spliced probe', flow } as Op] : []),
      ];
      const results: string[] = [];
      for (const dir of [off, absent, undefined]) {
        const file = join(dir ?? top, `probe-${compared.length}.bpmn`);
        writeFileSync(file, text);
        const r = await mutateFile(file, ops, { dryRun: true, ...(dir ? { lintFrom: dir } : { lintConfig: false }) }).then(
          (m) => `${m.xml}\n${JSON.stringify(m.changes.created)}`,
          (e: CliError) => `${e.code} ${e.message}`,
        );
        results.push(r);
      }
      expect(results[0], fixture).toBe(results[2]);
      expect(results[1], fixture).toBe(results[2]);
      compared.push(fixture);
    }
    expect(compared.length).toBeGreaterThan(30);
  }, 120000);
});

/* ------------------------------------------------------------------ */
/* the CLI under plain node                                             */
/* ------------------------------------------------------------------ */

describe('the CLI under plain node (src/ built into a temporary directory)', () => {
  let cli: string;
  let build: string;
  beforeAll(() => {
    // tsc into a directory of its own (cli.test.ts rebuilds dist/ concurrently), next to package.json and node_modules like an install
    build = join(top, 'cli');
    mkdirSync(build, { recursive: true });
    execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ROOT, 'tsconfig.json'), '--outDir', join(build, 'dist'), '--declaration', 'false', '--sourceMap', 'false'], { cwd: ROOT, stdio: 'inherit' });
    writeFileSync(join(build, 'package.json'), readFileSync(join(ROOT, 'package.json')));
    symlinkSync(join(ROOT, 'node_modules'), join(build, 'node_modules'));
    cli = join(build, 'dist', 'cli.js');
  }, 120000);

  const bpmn = (cwd: string, args: string[], input?: string, bin = cli) => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', input: input ?? '' });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  };

  it('validate runs the .bpmnlintrc (exit 2 on its errors); --no-lint-config and --lint-config; stdin from the working directory; JSON', async () => {
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'models/x.bpmn': xml, 'lint/strict.json': JSON.stringify({ rules: { 'label-required': 'warn' } }) });
    const v = bpmn(dir, ['validate', 'models/x.bpmn']);
    expect(v.code, v.err).toBe(2);
    expect(v.out).toContain('[bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
    expect(v.out).toContain('validator bpmnlint (.bpmnlintrc in .): 1 error(s), 0 warning(s) in the file\n');
    const off = bpmn(dir, ['validate', 'models/x.bpmn', '--no-lint-config']);
    expect(off.code).toBe(0);
    expect(off.out).not.toContain('bpmnlint');
    const other = bpmn(join(dir, 'models'), ['validate', 'x.bpmn', '--lint-config', '../lint/strict.json']);
    expect(other.code).toBe(0);
    expect(other.out).toContain('validator bpmnlint (--lint-config ../lint/strict.json): 0 error(s), 1 warning(s) in the file\n');
    // a rule set to warn: no severity in the tag
    expect(other.out).toContain('[bpmnlint] label-required Activity_AfterCheck: Element is missing label/name\n');
    const stdin = bpmn(dir, ['validate', '-'], xml);
    expect(stdin.code).toBe(2);
    expect(stdin.out).toContain('[bpmnlint error] label-required Activity_AfterCheck');
    const json = JSON.parse(bpmn(dir, ['validate', 'models/x.bpmn', '--json']).out);
    expect(json.validators[0]).toMatchObject({ name: 'bpmnlint', detail: '.bpmnlintrc in .', blocks: false, counts: { errors: 1, warnings: 0 } });
    expect(json.errors).toContainEqual({ code: 'label-required', message: 'Element is missing label/name', element: 'Activity_AfterCheck', validator: 'bpmnlint', severity: 'error' });
    const missing = bpmn(dir, ['validate', 'models/x.bpmn', '--lint-config', 'nope.json']);
    expect(missing.code).toBe(4);
    expect(missing.err).toMatch(/^error E_LINT_CONFIG: /);
  });

  // a CI `container:` job, `docker run -v`: root over a checkout of another uid (simulated: a preload makes process.getuid() 0)
  it.skipIf(!process.getuid || process.getuid() === 0)('root over a checkout of another uid: the .bpmnlintrc at the repository root runs with bpmn-cli\'s rules (exit 2 on an error rule), the project plugin is left out and named', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'models/x.bpmn': await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]) });
    const marker = join(dir, 'RAN.txt');
    plugin(dir, 'bpmnlint-plugin-evil', { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const asRoot = join(top, 'as-root.cjs');
    writeFileSync(asRoot, 'process.getuid = () => 0; delete process.env.SUDO_UID;\n');
    const r = spawnSync(process.execPath, ['--require', asRoot, cli, 'validate', 'x.bpmn'], { cwd: join(dir, 'models'), encoding: 'utf8', input: '' });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stdout).toContain('[bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
    expect(r.stdout).toContain("[bpmnlint] W_LINT_UNAVAILABLE: plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only in a repository of the user running it (the repository of ../.git belongs to another user)  (Check who created that repository and its .git; run bpmn-cli as its owner (git's safe.directory does not change this), or remove the plugin from the configuration; --no-lint-config skips bpmnlint.)\n");
    expect(r.stdout).toContain('validator bpmnlint (.bpmnlintrc in ..; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)): 1 error(s), 1 warning(s) in the file\n');
    expect(existsSync(marker)).toBe(false);
    // as the checkout's owner the plugin runs
    const own = bpmn(join(dir, 'models'), ['validate', 'x.bpmn']);
    expect(own.code, own.err).toBe(2);
    expect(own.out).not.toContain('W_LINT_UNAVAILABLE');
    expect(existsSync(marker)).toBe(true);
  });

  it('a write exits 0 and lists the findings it added (5 with --strict); the hint and the validator line name the file relative to the working directory', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'models/x.bpmn': await model(LINE) });
    const add = bpmn(join(dir, 'models'), ['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run']);
    expect(add.code, add.err).toBe(0);
    expect(add.out).toContain('warning [bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
    expect(add.out).toContain('validator bpmnlint (.bpmnlintrc in ..): 1 error(s), 0 warning(s) in the result (1 added, 0 resolved, 0 already in the file)\n');
    expect(bpmn(join(dir, 'models'), ['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run', '--strict']).code).toBe(5);
    const summary = bpmn(dir, ['add', 'models/x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run', '--summary']);
    expect(summary.out).toContain('warning [bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
  });

  it('JSON beyond 64 KB reaches a pipe whole with exit 2 and 5 (validate, --strict, a write with --strict): the exit code does not cut it off', async () => {
    // a rule that reports 300 long findings on each task
    const many = `module.exports = () => ({ check(node, reporter) { if (/Task$/.test(node.$type)) for (let i = 0; i < 300; i++) reporter.report(node.id, 'a long finding ' + 'x'.repeat(200) + ' ' + i); } });`;
    const dir = repo({ rules: { 'big/many': 'error' } }, { 'x.bpmn': await model(LINE), 'lint/warn.json': JSON.stringify({ rules: { 'big/many': 'warn' } }) });
    plugin(dir, 'bpmnlint-plugin-big', { rules: { many } });
    const piped = (args: string[], code: number) => {
      const r = bpmn(dir, args);
      expect(r.code, r.err).toBe(code);
      expect(r.out.length, args.join(' ')).toBeGreaterThan(65536);
      return JSON.parse(r.out) as { errors?: unknown[]; warnings?: unknown };
    };
    expect(piped(['validate', 'x.bpmn', '--json'], 2).errors).toHaveLength(300);
    piped(['validate', 'x.bpmn', '--json', '--strict', '--lint-config', 'lint/warn.json'], 5);
    piped(['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run', '--json', '--strict'], 5);
    // a reader that closes after the first chunk (`| head`): the exit code stays, no EPIPE trace on stderr
    const early = (args: string[]) =>
      new Promise<{ code: number | null; err: string }>((done) => {
        const child = spawn(process.execPath, [cli, ...args], { cwd: dir });
        let err = '';
        child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
        child.stdout.once('data', () => child.stdout.destroy());
        child.on('close', (code) => done({ code, err }));
      });
    expect(await early(['validate', 'x.bpmn', '--json'])).toEqual({ code: 2, err: '' });
    expect(await early(['validate', 'x.bpmn'])).toEqual({ code: 2, err: '' });
    expect(await early(['validate', 'x.bpmn', '--strict', '--lint-config', 'lint/warn.json'])).toEqual({ code: 5, err: '' });
    expect(await early(['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run', '--json', '--strict'])).toEqual({ code: 5, err: '' });
  });

  it('a project plugin that leaves a timer running does not keep the command alive', async () => {
    const dir = repo({ extends: 'plugin:local/recommended' }, { 'x.bpmn': await model(LINE) });
    plugin(dir, 'bpmnlint-plugin-local', {
      main: "setInterval(() => {}, 1000); module.exports = { configs: { recommended: { rules: { slow: 'error' } } } };",
      rules: { slow: "module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') reporter.report(node.id, 'slow'); return new Promise((done) => setTimeout(done, 60000)); } });" },
    });
    for (const [args, code] of [[['validate', 'x.bpmn'], 2], [['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run'], 0]] as const) {
      const started = Date.now();
      const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', input: '', timeout: 20000 });
      expect(r.signal, args.join(' ')).toBeNull();
      expect(r.status, r.stderr).toBe(code);
      expect(Date.now() - started, args.join(' ')).toBeLessThan(15000);
    }
  }, 60000);

  it.skipIf(process.platform === 'win32')('a working directory that was removed: validate and a write on an absolute path still run, the lookup from the file', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]) });
    const gone = join(top, 'gone-cwd');
    const inGone = (args: string[]) => {
      mkdirSync(gone, { recursive: true });
      const r = spawnSync('/bin/sh', ['-c', 'cd "$1" && rmdir "$1" && shift && exec "$@"', 'sh', gone, process.execPath, cli, ...args], { encoding: 'utf8', input: '' });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    const v = inGone(['validate', join(dir, 'x.bpmn')]);
    expect(v.code, v.err).toBe(2);
    expect(v.out).toContain('[bpmnlint error] label-required Activity_AfterCheck');
    const off = inGone(['validate', join(dir, 'x.bpmn'), '--no-lint-config']);
    expect(off.code, off.err).toBe(0);
    const add = inGone(['add', join(dir, 'x.bpmn'), 'task', 'Ship', '--after', 'Activity_AfterCheck', '--dry-run']);
    expect(add.code, add.err).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('a model reached through a linked directory from outside its repository runs the repository\'s .bpmnlintrc; a link inside a repository keeps that repository\'s', async () => {
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'models/x.bpmn': xml });
    const outside = join(top, 'cli-links');
    mkdirSync(join(outside, 'ext'), { recursive: true });
    writeFileSync(join(outside, 'ext', 'y.bpmn'), xml);
    symlinkSync(join(dir, 'models'), join(outside, 'mlink'), 'dir');
    symlinkSync(join(outside, 'ext'), join(dir, 'extlink'), 'dir');
    const linked = bpmn(outside, ['validate', 'mlink/x.bpmn']);
    expect(linked.code, linked.err).toBe(2);
    expect(linked.out).toContain('[bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
    expect(linked.out).toContain(`validator bpmnlint (.bpmnlintrc in ../${basename(dir)}): 1 error(s), 0 warning(s) in the file\n`);
    // a new file in a subdirectory the write creates behind the link: the same .bpmnlintrc
    const created = bpmn(outside, ['new', 'mlink/sub/n.bpmn', '--name', 'Order']);
    expect(created.code, created.err).toBe(0);
    expect(created.out).toContain(`validator bpmnlint (.bpmnlintrc in ../${basename(dir)}): 2 error(s), 0 warning(s) in the result`);
    expect(existsSync(join(dir, 'models', 'sub', 'n.bpmn'))).toBe(true);
    const inRepo = bpmn(dir, ['validate', 'extlink/y.bpmn']);
    expect(inRepo.code, inRepo.err).toBe(2);
    expect(inRepo.out).toContain('validator bpmnlint (.bpmnlintrc in .): 1 error(s), 0 warning(s) in the file\n');
  });

  it('a write looks the .bpmnlintrc up from the file it writes (-o); a model from stdin without -o from the working directory', async () => {
    const xml = await model(LINE);
    const dir = repo(undefined, { 'plain/x.bpmn': xml, 'sub/.bpmnlintrc': JSON.stringify({ extends: 'bpmnlint:recommended' }) });
    const add = ['add', '-', 'task', '--after', 'Activity_Check'];
    expect(bpmn(dir, [...add, '-o', 'sub/out.bpmn'], xml).out).toContain('validator bpmnlint (.bpmnlintrc in sub): 1 error(s)');
    // the XML on stdout, the report on stderr
    const here = bpmn(dir, add, xml);
    expect(here.code, here.err).toBe(0);
    expect(here.err).not.toContain('bpmnlint');
    expect(bpmn(join(dir, 'sub'), add, xml).err).toContain('validator bpmnlint (.bpmnlintrc in .): 1 error(s)');
    // a file written elsewhere: the target's, not the input's
    expect(bpmn(dir, ['add', 'plain/x.bpmn', 'task', '--after', 'Activity_Check', '-o', 'sub/y.bpmn']).out).toContain('validator bpmnlint (.bpmnlintrc in sub): 1 error(s)');
    expect(bpmn(dir, ['add', 'sub/y.bpmn', 'task', 'Ship', '--after', 'Activity_AfterCheck', '-o', 'plain/z.bpmn']).out).not.toContain('bpmnlint');
  });

  it('without a .bpmnlintrc nothing of bpmnlint is loaded and the output is that of --no-lint-config', async () => {
    const dir = repo(undefined, { 'x.bpmn': await model(LINE) });
    const probe = `import { checkFile } from ${JSON.stringify(join(build, 'dist', 'node', 'index.js'))}; import { createRequire } from 'node:module';
      await checkFile(process.argv[1], { lintFrom: process.cwd(), lintProjectCode: true });
      console.log(Object.keys(createRequire(import.meta.url).cache).filter((k) => /bpmnlint/.test(k)).length);`;
    const run = (cwd: string) => spawnSync(process.execPath, ['--input-type=module', '-e', probe, join(cwd, 'x.bpmn')], { cwd, encoding: 'utf8' }).stdout.trim();
    expect(run(dir)).toBe('0');
    const withRc = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': await model(LINE) });
    expect(Number(run(withRc))).toBeGreaterThan(30);
    for (const args of [['validate', 'x.bpmn'], ['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run']]) {
      expect(bpmn(dir, args).out).toBe(bpmn(dir, [...args, '--no-lint-config']).out);
    }
  });

  it('a library host without a file and without lintFrom gets no lookup, also with a .bpmnlintrc in its working directory', () => {
    const dir = repo({ extends: 'bpmnlint:recommended' });
    const probe = `import { projectBpmnlint } from ${JSON.stringify(join(build, 'dist', 'node', 'index.js'))};
      console.log(String(await projectBpmnlint(undefined, {})), (await projectBpmnlint(undefined, { lintFrom: process.cwd() }))?.name);`;
    expect(spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: dir, encoding: 'utf8' }).stdout.trim()).toBe('undefined bpmnlint');
  });

  it('bpmnlint or the plugin cannot be loaded: one W_LINT_UNAVAILABLE, the write goes ahead', async () => {
    // an install whose plugin throws on load
    const broken = join(top, 'broken');
    mkdirSync(join(broken, 'node_modules', '@miragon', 'bpmnlint-plugin-rules'), { recursive: true });
    cpSync(join(build, 'dist'), join(broken, 'dist'), { recursive: true });
    writeFileSync(join(broken, 'package.json'), readFileSync(join(ROOT, 'package.json')));
    for (const name of readdirSync(join(ROOT, 'node_modules'))) if (name !== '@miragon') symlinkSync(join(ROOT, 'node_modules', name), join(broken, 'node_modules', name));
    const stub = join(broken, 'node_modules', '@miragon', 'bpmnlint-plugin-rules');
    writeFileSync(join(stub, 'package.json'), JSON.stringify({ name: '@miragon/bpmnlint-plugin-rules', version: '0.12.0', main: 'index.cjs' }));
    writeFileSync(join(stub, 'index.cjs'), "throw new Error('the plugin is broken');");
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': await model(LINE) });
    const bin = join(broken, 'dist', 'cli.js');
    const v = bpmn(dir, ['validate', 'x.bpmn'], undefined, bin);
    expect(v.code, v.err).toBe(0);
    expect(v.out).toContain('[bpmnlint] W_LINT_UNAVAILABLE: bpmnlint could not be loaded: the plugin is broken; the plugin found bpmnlint 11.15.0 in ');
    expect(v.out).toContain('validator bpmnlint (.bpmnlintrc in .; bpmnlint did not run (bpmn validate lists why)): 0 error(s), 1 warning(s) in the file\n');
    const add = bpmn(dir, ['add', 'x.bpmn', 'task', 'Ship', '--after', 'Activity_Check'], undefined, bin);
    expect(add.code, add.err).toBe(0);
    expect(add.out).toContain('written: x.bpmn');
    expect(readFileSync(join(dir, 'x.bpmn'), 'utf8')).toContain('Activity_Ship');
  });

  it('a project bpmnlint hoisted next to the plugin: an old one is named (the plugin cannot load), a loadable other version too', async () => {
    const project = (name: string, install: (dir: string) => void) => {
      const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': '' });
      const modules = join(dir, 'node_modules');
      const cliDir = join(modules, '@miragon', 'bpmn-cli');
      mkdirSync(join(cliDir, 'node_modules'), { recursive: true });
      cpSync(join(build, 'dist'), join(cliDir, 'dist'), { recursive: true });
      writeFileSync(join(cliDir, 'package.json'), readFileSync(join(ROOT, 'package.json')));
      // bpmn-cli's own bpmnlint (the pinned one) is nested; the plugin and the rest are hoisted
      symlinkSync(join(ROOT, 'node_modules', 'bpmnlint'), join(cliDir, 'node_modules', 'bpmnlint'));
      cpSync(join(ROOT, 'node_modules', '@miragon', 'bpmnlint-plugin-rules'), join(modules, '@miragon', 'bpmnlint-plugin-rules'), { recursive: true });
      for (const entry of readdirSync(join(ROOT, 'node_modules'))) if (entry !== '@miragon' && entry !== 'bpmnlint') symlinkSync(join(ROOT, 'node_modules', entry), join(modules, entry));
      install(join(modules, 'bpmnlint'));
      return { dir, bin: join(cliDir, 'dist', 'cli.js'), name };
    };
    const xml = await model(LINE);
    const old = project('old', (target) => {
      mkdirSync(target);
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'bpmnlint', version: '11.0.0', main: 'lib/index.js' }));
    });
    writeFileSync(join(old.dir, 'x.bpmn'), xml);
    const v = bpmn(old.dir, ['validate', 'x.bpmn'], undefined, old.bin);
    expect(v.code, v.err).toBe(0);
    expect(v.out).toMatch(/\[bpmnlint\] W_LINT_UNAVAILABLE: bpmnlint could not be loaded: Cannot find module 'bpmnlint\/[^']+'; the plugin found bpmnlint 11\.0\.0 in node_modules\/bpmnlint; bpmnlint did not run {2}\(bpmn-cli needs bpmnlint >= 11\.14 next to @miragon\/bpmnlint-plugin-rules \(it pins 11\.15\.0\): update the project's bpmnlint \(npm i -D bpmnlint@11\.15\.0\) or run bpmn-cli from its own install \(npx\); --no-lint-config skips bpmnlint\.\)\n/);
    const other = project('other', (target) => {
      cpSync(join(ROOT, 'node_modules', 'bpmnlint'), target, { recursive: true });
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
      writeFileSync(join(target, 'package.json'), JSON.stringify({ ...pkg, version: '11.14.0' }));
    });
    writeFileSync(join(other.dir, 'x.bpmn'), xml);
    const ok = bpmn(other.dir, ['validate', 'x.bpmn'], undefined, other.bin);
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).toContain('validator bpmnlint (.bpmnlintrc in .; bpmnlint 11.14.0 from node_modules/bpmnlint (bpmn-cli pins 11.15.0)): 0 error(s), 0 warning(s) in the file\n');
  }, 60000);

  it('the examples of docs/bpmnlint.md: validate and a write on a Camunda 7 project with camunda-compat, @miragon/rules and a project plugin', async () => {
    const doc = readFileSync(join(ROOT, 'docs', 'bpmnlint.md'), 'utf8');
    const blocks = [...doc.matchAll(/```\n(\$ bpmn [\s\S]*?)```/g)].map((m) => m[1]!.trimEnd().split('\n'));
    expect(blocks.map((b) => b[0])).toEqual(['$ bpmn validate models/order.bpmn', '$ bpmn add models/order.bpmn serviceTask "Book order" --after Activity_CheckOrder camunda:type=external', '$ bpmn show models/order.bpmn --conventions']);
    const dir = repo({
      extends: ['bpmnlint:recommended', 'plugin:camunda-compat/camunda-platform-7-24', 'plugin:@miragon/rules/recommended-for-automation', 'plugin:local/recommended'],
      moddleExtensions: { camunda: 'camunda-bpmn-moddle/resources/camunda.json' },
    });
    plugin(dir, 'bpmnlint-plugin-local', {
      version: '1.0.0',
      configs: { recommended: { rules: { 'external-task-topic': 'error' } } },
      rules: { 'external-task-topic': "module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:ServiceTask' && node.get('camunda:type') === 'external' && !node.get('camunda:topic')) reporter.report(node.id, 'External task has no topic', ['topic']); } });" },
    });
    const created = (await newXml({ processName: 'Order', target: 'camunda7' })).xml;
    mkdirSync(join(dir, 'models'));
    writeFileSync(join(dir, 'models', 'order.bpmn'), (await applyToXml(created, [
      { op: 'add', kind: 'start', name: 'Order received', id: 'Event_OrderReceived' },
      { op: 'add', kind: 'userTask', name: 'Check order', id: 'Activity_CheckOrder', after: 'Event_OrderReceived' },
      { op: 'add', kind: 'end', name: 'Order checked', id: 'Event_OrderChecked', after: 'Activity_CheckOrder' },
    ])).xml);
    const args = (line: string) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!).slice(2);
    const [validate, add, conventions] = blocks as [string[], string[], string[]];
    // the write first, then validate the result and show its id conventions
    const written = bpmn(dir, args(add[0]!));
    expect(written.code, written.err).toBe(0);
    for (const line of add.slice(1).filter((l) => l !== '...')) expect(written.out.split('\n'), line).toContain(line);
    const checked = bpmn(dir, args(validate[0]!));
    expect(checked.code).toBe(2);
    expect(checked.out.trimEnd()).toBe(validate.slice(1).join('\n'));
    const shown = bpmn(dir, args(conventions[0]!));
    expect(shown.code, shown.err).toBe(0);
    expect(shown.out.trimEnd()).toBe(conventions.slice(1).join('\n'));
  });

  it('id conventions (#34): `new` keeps the process id, show --conventions (a missing file, stdin, --json, --no-lint-config), validate - names W_CONFIG_IGNORED', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation'] });
    mkdirSync(join(dir, 'models'));
    // `new` in a repository whose .bpmnlintrc extends recommended-for-automation: the bytes of --no-lint-config
    expect(bpmn(dir, ['new', 'models/a.bpmn', '--name', 'Invoice handling']).code).toBe(0);
    expect(bpmn(dir, ['new', 'models/b.bpmn', '--name', 'Invoice handling', '--no-lint-config']).code).toBe(0);
    expect(readFileSync(join(dir, 'models', 'a.bpmn'), 'utf8')).toBe(readFileSync(join(dir, 'models', 'b.bpmn'), 'utf8'));
    expect(readFileSync(join(dir, 'models', 'a.bpmn'), 'utf8')).toContain('<bpmn:process id="Process_InvoiceHandling"');
    // what fails without a .bpmnlintrc fails first, also with a --lint-config that cannot be read
    const exists = bpmn(dir, ['new', 'models/a.bpmn', '--name', 'Other', '--lint-config', 'missing.json']);
    expect([exists.code, exists.err.split('\n')[0]]).toEqual([4, 'error E_FILE_EXISTS: models/a.bpmn already exists']);
    const badId = bpmn(dir, ['new', 'models/c.bpmn', '--id', '1bad', '--lint-config', 'missing.json']);
    expect([badId.code, badId.err.split('\n')[0]]).toEqual([2, 'error E_INVALID_ID: "1bad" is not a valid id (XML NCName)']);
    expect(bpmn(dir, ['new', 'models/c.bpmn', '--name', 'Other', '--lint-config', 'missing.json']).err).toContain('error E_LINT_CONFIG: ');
    // a file that does not exist yet: the conventions of a new model there
    const fresh = bpmn(dir, ['show', 'models/new.bpmn', '--conventions']);
    expect(fresh.code, fresh.err).toBe(0);
    expect(fresh.out.split('\n').slice(0, 3)).toEqual([
      'conventions of models/new.bpmn (no file yet: a new model)',
      'element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional',
      '  <kind>_{name:camel}               lint        task userTask serviceTask scriptTask sendTask receiveTask manualTask businessRuleTask subProcess callActivity startEvent endEvent',
    ]);
    const json = JSON.parse(bpmn(dir, ['show', 'models/a.bpmn', '--conventions', '--json']).out);
    expect(json).toMatchObject({ file: 'models/a.bpmn', exists: true, source: '.bpmnlintrc in .', rule: { severity: 'warn', case: 'camelCase', qualifier: 'optional' }, notes: [] });
    expect(bpmn(dir, ['show', 'models/a.bpmn', '--conventions', '--no-lint-config']).out.split('\n')[1]).toBe("no id conventions: --no-lint-config leaves the .bpmnlintrc out; new ids follow the file's id style");
    // the .bpmnlintrc only decides the conventions: without --conventions its options are an error
    for (const flag of [['--lint-config', 'nope.json'], ['--no-lint-config']]) {
      const plain = bpmn(dir, ['show', 'models/a.bpmn', ...flag]);
      expect(plain.code).toBe(1);
      expect(plain.err).toContain(`error E_USAGE: ${flag[0]} goes only with --conventions`);
    }
    expect(bpmn(dir, ['show', 'models/a.bpmn', '--conventions', '--lint-config', 'nope.json']).code).toBe(4);
    const stdin = bpmn(dir, ['show', '-', '--conventions'], readFileSync(join(dir, 'models', 'a.bpmn'), 'utf8'));
    expect(stdin.out.split('\n').slice(0, 2)).toEqual(['conventions of the model', 'element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional']);
    const usage = bpmn(dir, ['show', 'models/a.bpmn', 'Process_InvoiceHandling', '--conventions', '--layout']);
    expect(usage.code).toBe(1);
    expect(usage.err).toContain('error E_USAGE: --conventions shows the id conventions of the whole file; drop the element id and --layout');
    // a .bpmnlintrc that is not strict JSON, one that leaves the rule out (a typo): the reason and the W_LINT_UNAVAILABLE
    const broken = repo('{"extends":["plugin:@miragon/rules/recommended-for-automation"],}');
    const notJson = bpmn(broken, ['show', 'x.bpmn', '--conventions']);
    expect(notJson.code, notJson.err).toBe(0);
    expect(notJson.out.split('\n')[1]).toBe("no id conventions: the .bpmnlintrc in . could not be loaded (W_LINT_UNAVAILABLE below); new ids follow the file's id style");
    expect(notJson.out).toMatch(/^warning W_LINT_UNAVAILABLE: \.bpmnlintrc is not JSON /m);
    expect(JSON.parse(bpmn(broken, ['show', 'x.bpmn', '--conventions', '--json']).out)).toMatchObject({ source: '.bpmnlintrc in .', undeclared: 'not loaded', notes: [{ code: 'W_LINT_UNAVAILABLE' }] });
    const typo = repo({ rules: { 'miragon/element-id-naming': 'error' } });
    const left = bpmn(typo, ['show', 'x.bpmn', '--conventions']);
    expect(left.out.split('\n')[1]).toBe("no id conventions: element-id-naming is off or not configured in the .bpmnlintrc in .; new ids follow the file's id style");
    expect(left.out).toContain('warning W_LINT_UNAVAILABLE: miragon/element-id-naming left out: bpmnlint-plugin-miragon is not installed');
    // validate - (stdin) looks the .bpmnlintrc up from the working directory: its W_CONFIG_IGNORED too
    const odd = repo({ rules: { '@miragon/rules/element-id-naming': ['warn', { eventDefinitionQualifier: 'requried' }] } });
    const piped = bpmn(odd, ['validate', '-'], readFileSync(join(dir, 'models', 'a.bpmn'), 'utf8'));
    expect(piped.out).toContain('[bpmnlint] W_CONFIG_IGNORED: .bpmnlintrc in .: @miragon/rules/element-id-naming eventDefinitionQualifier "requried" is unknown: the rule and new ids take optional  (Write one of off, optional, required in the .bpmnlintrc. Did you mean required?)\n');
  });

  it('a prefix the .bpmnlintrc declares for a DI type: `new`, validate and show --conventions list one W_CONFIG_IGNORED each, a write counts them', async () => {
    const dir = repo({ rules: { '@miragon/rules/element-id-naming': ['warn', { prefixes: { 'bpmndi:BPMNShape': 'shape_', 'bpmndi:BPMNEdge': 'edge_' } }] } });
    const line = (type: string, prefix: string): string => `W_CONFIG_IGNORED: .bpmnlintrc in .: @miragon/rules/element-id-naming prefix of ${type} "${prefix}" is not followed: bpmn-cli names DI after its element (BPMNShape_<id>, <id>_di), and the rule reports new DI ids  (Set it to false or remove it; bpmn-js names DI <id>_di too.)`;
    const created = bpmn(dir, ['new', 'a.bpmn']);
    expect(created.code, created.err).toBe(0);
    expect(created.out).toContain(`warning [bpmnlint] ${line('bpmndi:BPMNShape', 'shape_')}\nwarning [bpmnlint] ${line('bpmndi:BPMNEdge', 'edge_')}\n`);
    // a write: the DI of the new element is reported (bpmn-cli names it after the element), the notes only counted
    const added = bpmn(dir, ['add', 'a.bpmn', 'startEvent', 'Order received']);
    expect(added.out).toContain('warning [bpmnlint] @miragon/rules/element-id-naming BPMNShape_startEvent_orderReceived: Element id must match the naming convention <shape_camelCase>');
    expect(added.out).toContain('validator bpmnlint (.bpmnlintrc in .; 2 element-id-naming values ignored (W_CONFIG_IGNORED; bpmn validate lists them)): ');
    expect(added.out).not.toContain('warning [bpmnlint] W_CONFIG_IGNORED');
    const checked = bpmn(dir, ['validate', 'a.bpmn']);
    expect(checked.out).toContain(`[bpmnlint] ${line('bpmndi:BPMNShape', 'shape_')}\n[bpmnlint] ${line('bpmndi:BPMNEdge', 'edge_')}\n`);
    const shown = bpmn(dir, ['show', 'a.bpmn', '--conventions']);
    expect(shown.out.split('\n').filter((l) => l.startsWith('warning '))).toEqual([`warning ${line('bpmndi:BPMNShape', 'shape_')}`, `warning ${line('bpmndi:BPMNEdge', 'edge_')}`]);
    // DI ids stay bpmn-cli's: no row of the view names them
    expect(shown.out.split('\n').filter((l) => l.startsWith('  ') && /shape_|edge_|BPMN/.test(l))).toEqual([]);
  });
});

describe('the library examples (docs/library.md, docs/validators.md)', () => {
  it('bpmnlintEngine + resolveBpmnlintConfig + bpmnlintValidator in applyToXml; the engine default of the plugin', async () => {
    const library = readFileSync(join(ROOT, 'docs', 'library.md'), 'utf8');
    for (const line of [
      'const engine = bpmnlintEngine();',
      "const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended' });",
      "const lint = bpmnlintValidator(engine, resolved, { detail: 'our rules' });",
      'const edit = await applyToXml(xml, ops, { validators: [lint] });',
    ]) expect(library).toContain(line);
    const engine = bpmnlintEngine();
    const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended' });
    const lint = bpmnlintValidator(engine, resolved, { detail: 'our rules' });
    const edit = await applyToXml(await model(LINE), [{ op: 'add', kind: 'task', after: 'Activity_Check' }], { validators: [lint] });
    expect(edit.result.warnings.added).toContainEqual(expect.objectContaining({ code: 'label-required', validator: 'bpmnlint', severity: 'error' }));
    // docs/validators.md: the plugin's default for an engine (a descriptor object as moddle extension), which turns element-id-naming on
    const validators = readFileSync(join(ROOT, 'docs', 'validators.md'), 'utf8');
    for (const line of [
      "const rc = engine.plugin.getDefaultLintConfig({ engine: 'c7' });",
      'const resolved = await resolveBpmnlintConfig(engine, rc);',
      'const { conventions, notes } = idConventionsFromLint(resolved.rules[ID_NAMING_RULE], engine.plugin.naming);',
      "const lint = bpmnlintValidator(engine, resolved, { detail: 'default rules', notes });",
      'await applyToXml(xml, ops, { validators: [lint], conventions });',
    ]) expect(validators).toContain(line);
    for (const target of ['c7', 'c8'] as const) {
      const rc = engine.plugin.getDefaultLintConfig({ engine: target });
      const resolved = await resolveBpmnlintConfig(engine, rc);
      expect(resolved.unavailable).toEqual([]);
      expect(resolved.rules[ID_NAMING_RULE]?.severity, target).toBe('warn');
      const { conventions, notes } = idConventionsFromLint(resolved.rules[ID_NAMING_RULE], engine.plugin.naming);
      const lint = bpmnlintValidator(engine, resolved, { detail: 'default rules', notes });
      const xml = (await newXml({ processName: 'Order', target: target === 'c7' ? 'camunda7' : 'camunda8' })).xml;
      const ops: Op[] = [
        { op: 'add', kind: 'start', name: 'Order received', as: '$s' },
        { op: 'add', kind: 'userTask', name: 'Check order', after: '$s', as: '$t' },
        { op: 'add', kind: 'end', name: 'Done', after: '$t' },
      ];
      const result = (await applyToXml(xml, ops, { validators: [lint], conventions })).result;
      expect(result.created.map((c) => c.id), target).toEqual(['startEvent_orderReceived', 'userTask_checkOrder', 'flow_orderReceivedToCheckOrder', 'endEvent_done', 'flow_checkOrderToDone']);
      expect(lintOf(result.warnings.added).filter((w) => w.code === ID_NAMING_RULE), target).toEqual([]);
    }
    const c7 = await resolveBpmnlintConfig(engine, engine.plugin.getDefaultLintConfig({ engine: 'c7' }));
    expect(Object.keys(c7.moddleExtensions)).toEqual(['camunda']);
    expect(Object.keys(c7.rules)).toContain('camunda-compat/history-time-to-live');
  });

  it('the declared id conventions of a configuration of the host (docs/library.md): new ids pass its element-id-naming', async () => {
    const library = readFileSync(join(ROOT, 'docs', 'library.md'), 'utf8');
    for (const line of [
      "const automation = await resolveBpmnlintConfig(engine, engine.plugin.getDefaultLintConfig({ preset: 'automation' }));",
      "const { conventions, notes } = idConventionsFromLint(automation.rules[ID_NAMING_RULE], engine.plugin.naming, { source: 'our rules' });",
      'const named = await applyToXml(xml, ops, { validators: [bpmnlintValidator(engine, automation, { notes })], conventions });',
      "await applyToXml(xml, ops, { conventions: { prefixes: { 'bpmn:ServiceTask': 'serviceTask_', 'bpmn:SequenceFlow': 'flow_' }, case: 'camelCase' } });",
    ]) expect(library).toContain(line);
    const engine = bpmnlintEngine();
    const automation = await resolveBpmnlintConfig(engine, engine.plugin.getDefaultLintConfig({ preset: 'automation' }));
    const { conventions, notes } = idConventionsFromLint(automation.rules[ID_NAMING_RULE], engine.plugin.naming, { source: 'our rules' });
    const ops: Op[] = [{ op: 'add', kind: 'serviceTask', name: 'Ship', after: 'Activity_Check' }];
    const named = await applyToXml(await model(LINE), ops, { validators: [bpmnlintValidator(engine, automation, { notes })], conventions });
    expect(named.result.created.map((c) => c.id)).toEqual(['serviceTask_ship', 'flow_shipToDone']);
    expect(named.result.conventions).toEqual({ ids: ['serviceTask_ship', 'flow_checkToShip', 'flow_shipToDone'], source: 'our rules' });
    expect(lintOf(named.result.warnings.added).filter((w) => w.code === ID_NAMING_RULE)).toEqual([]);
    const table = await applyToXml(await model(LINE), ops, { conventions: { prefixes: { 'bpmn:ServiceTask': 'serviceTask_', 'bpmn:SequenceFlow': 'flow_' }, case: 'camelCase' } });
    expect(table.result.created.map((c) => c.id)).toEqual(['serviceTask_ship', 'flow_shipToDone']);
  });
});
