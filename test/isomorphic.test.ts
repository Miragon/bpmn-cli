/**
 * The core entry (src/index.ts, the package's "." export) runs in a browser:
 * it bundles for platform=browser without Node builtins or Node-only globals
 * (tools/iso/bundle.mjs, the same check `npm run gate` runs on dist/ with
 * tools/iso/check.mjs), and the bundle works in a vm context that has no
 * Node globals at all (no process, Buffer, require, setTimeout): the
 * in-memory API gives there exactly what it gives in Node.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import { CAMUNDA_DESCRIPTOR, CAMUNDA_DESCRIPTOR_VERSION } from '../src/platform/camunda-descriptor.js';
import { ZEEBE_DESCRIPTOR, ZEEBE_DESCRIPTOR_VERSION } from '../src/platform/zeebe-descriptor.js';
// @ts-expect-error plain ESM tooling without type declarations
import { bundleCore, NODE_GLOBALS } from '../tools/iso/bundle.mjs';

const ROOT = join(import.meta.dirname, '..');
const fixture = (name: string): string => readFileSync(join(ROOT, 'test', 'fixtures', 'incremental', name), 'utf8');

interface Violation {
  kind: string;
  what: string;
  file: string;
}

interface Chunk {
  path: string;
  entry: boolean;
  entryPoint?: string;
  imports: string[];
  inputs: string[];
  text: string;
}

interface Bundle {
  code: string;
  bytes: number;
  inputs: string[];
  graph: Record<string, string[]>;
  chunks: Chunk[];
  entry: Chunk;
  violations: Violation[];
}

describe('the core bundles for the browser', () => {
  let bundle: Bundle;
  beforeAll(async () => {
    bundle = await bundleCore({ entry: join('src', 'index.ts'), minify: false });
  }, 60000);

  it('without Node builtins or Node-only globals', () => {
    expect(bundle.violations).toEqual([]);
    expect(bundle.bytes).toBeGreaterThan(100_000);
  });

  it('without the node layer or the CLI', () => {
    expect(bundle.inputs.some((f) => f.startsWith('src/'))).toBe(true);
    expect(bundle.inputs.filter((f) => /^src\/(node\/|cli\.ts$)/.test(f))).toEqual([]);
  });

  it('the check sees a builtin import and a process read (it is not vacuous)', async () => {
    const builtin: Bundle = await bundleCore({ stdin: { contents: "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;", sourcefile: 'probe.ts' } });
    expect(builtin.violations).toMatchObject([{ kind: 'builtin', what: 'node:fs', file: 'probe.ts' }]);
    const globals: Bundle = await bundleCore({
      stdin: { contents: "export * from './src/index.ts';\nexport const debug = () => process.env['X'] ?? Buffer.from('x');\nexport const local = (process: { a: number }) => process.a;", sourcefile: 'probe.ts' },
    });
    expect(globals.violations.map((v) => `${v.what} ${v.file}`).sort()).toEqual(['Buffer probe.ts', 'process probe.ts']);
  }, 60000);
});

describe('the browser bundle in a context without Node globals', () => {
  let browser: typeof core;
  let ctx: vm.Context;
  beforeAll(async () => {
    const bundle: Bundle = await bundleCore({ entry: join('src', 'index.ts'), format: 'iife', globalName: 'BpmnCore' });
    expect(bundle.violations).toEqual([]);
    ctx = vm.createContext({});
    vm.runInContext(bundle.code, ctx, { filename: 'bpmn-core.browser.js' });
    browser = (ctx as unknown as { BpmnCore: typeof core }).BpmnCore;
  }, 60000);

  it('has no Node globals', () => {
    for (const g of [...NODE_GLOBALS, 'setTimeout', 'module', 'exports']) expect(vm.runInContext(`typeof ${g}`, ctx), g).toBe('undefined');
  });

  it('applyToXml places an element on a hand-made drawing exactly like Node', async () => {
    const xml = fixture('orders.bpmn');
    const ops = [{ op: 'add', kind: 'userTask', name: 'Ship goods', after: 'Task_A' }];
    const lines: string[] = [];
    const there = await browser.applyToXml(xml, JSON.stringify(ops), { debug: (l) => lines.push(l) });
    const here = await core.applyToXml(xml, ops);
    expect(there.result.layout.mode).toBe('incremental');
    expect(there.result.created.map((c) => c.id)).toContain('Task_ShipGoods'); // the file's id style (Task_)
    expect(there.unchanged).toBe(false);
    expect(there.xml).toBe(here.xml);
    expect(JSON.stringify(there.result)).toBe(JSON.stringify(here.result));
    // the debug hook works without process.env
    expect(lines.some((l) => l.startsWith('[route] '))).toBe(true);
  });

  it('keeps flow ids (keepFlowIds) and reports the stale one like Node', async () => {
    const ops = [
      { op: 'add', kind: 'start', name: 'Received' },
      { op: 'add', kind: 'task', name: 'Check', after: 'Event_Received' },
      { op: 'add', kind: 'end', name: 'Done', after: 'Activity_Check' },
    ];
    const xml = (await core.applyToXml((await core.newXml({ processName: 'Order' })).xml, ops)).xml;
    const splice = [{ op: 'add', kind: 'task', name: 'Book', after: 'Activity_Check' }];
    const there = await browser.applyToXml(xml, splice, { keepFlowIds: true });
    expect(there.result.warnings.added.map((w) => `${w.code} ${w.element}`)).toEqual(['W_FLOW_ID_STALE Flow_CheckToDone']);
    expect(JSON.stringify(there.result)).toBe(JSON.stringify((await core.applyToXml(xml, splice, { keepFlowIds: true })).result));
  });

  it('redraws with both engines (bpmn-auto-layout loaded on demand) and formats', async () => {
    const xml = fixture('orders.bpmn');
    for (const opts of [{ engine: 'clean' as const }, { engine: 'auto' as const }, { tidy: true }]) {
      const there = await browser.layoutXml(xml, opts);
      expect(there.xml, JSON.stringify(opts)).toBe((await core.layoutXml(xml, opts)).xml);
    }
    const colored = await browser.applyToXml(xml, [{ op: 'color', ids: ['Task_A'], color: 'green' }]);
    expect(colored.result.layout.format?.[0]?.colored).toEqual(['Task_A']);
  });

  it('creates, validates (Camunda 7 profile), shows, finds and measures like Node', async () => {
    const created = await browser.newXml({ processName: 'Order', target: 'camunda7' });
    const edited = await browser.applyToXml(created.xml, [
      { op: 'add', kind: 'start', name: 'Received' },
      { op: 'add', kind: 'userTask', name: 'Check', after: 'Event_Received', set: { 'camunda:assignee': 'demo' } },
    ]);
    expect(edited.xml).toBe((await core.applyToXml((await core.newXml({ processName: 'Order', target: 'camunda7' })).xml, [
      { op: 'add', kind: 'start', name: 'Received' },
      { op: 'add', kind: 'userTask', name: 'Check', after: 'Event_Received', set: { 'camunda:assignee': 'demo' } },
    ])).xml);
    const report = await browser.validateXml(edited.xml);
    expect(report.platform?.platform).toBe('c7');
    expect(JSON.stringify(report)).toBe(JSON.stringify(await core.validateXml(edited.xml)));
    expect(await browser.showXml(edited.xml)).toBe(await core.showXml(edited.xml));
    expect(await browser.showXml(edited.xml, { id: 'Activity_Check' })).toContain('camunda:assignee');
    // the reading views of large models (step 3)
    expect(await browser.showXml(edited.xml, { around: 'Activity_Check', depth: 1 })).toBe(await core.showXml(edited.xml, { around: 'Activity_Check', depth: 1 }));
    expect(await browser.showXml(edited.xml, { id: 'Activity_Check', context: true })).toBe(await core.showXml(edited.xml, { id: 'Activity_Check', context: true }));
    expect(await browser.showXml(edited.xml, { around: 'Activity_Check' })).toContain('camunda:assignee=demo');
    expect(await browser.findXml(edited.xml, 'demo')).toEqual(await core.findXml(edited.xml, 'demo'));
    expect(await browser.metricsXml(edited.xml)).toEqual(await core.metricsXml(edited.xml));
  });

  it('renders a diagram as SVG exactly like Node (renderSvg), also one it lays out in memory', async () => {
    const xml = readFileSync(join(ROOT, 'test', 'fixtures', 'render', 'gallery.bpmn'), 'utf8');
    for (const opts of [{}, { plane: 'Activity_CollapsedSubProcess' }, { maxSize: 600 }]) {
      const there = await browser.renderSvg(xml, opts);
      expect(there.svg, JSON.stringify(opts)).toMatch(/^<svg [^>]+>\n<rect /);
      expect(JSON.stringify(there), JSON.stringify(opts)).toBe(JSON.stringify(await core.renderSvg(xml, opts)));
    }
    const undrawn = readFileSync(join(ROOT, 'tools', 'scenarios', 'collab__notes-on-collaboration.bpmn'), 'utf8');
    expect(JSON.stringify(await browser.renderSvg(undrawn))).toBe(JSON.stringify(await core.renderSvg(undrawn)));
  });

  it('creates and validates Camunda 8 files (zeebe descriptor, Camunda 8 profile) like Node', async () => {
    const ops = [
      { op: 'add', kind: 'start', name: 'Received' },
      { op: 'add', kind: 'serviceTask', name: 'Check', after: 'Event_Received' },
      { op: 'ext', id: 'Activity_Check', action: 'add', type: 'loop.zeebe:loopCharacteristics', attrs: { inputCollection: '=items' } },
      { op: 'add', kind: 'userTask', name: 'Approve', after: 'Activity_Check' },
      { op: 'ext', id: 'Activity_Approve', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'x' } },
    ];
    const edited = await browser.applyToXml((await browser.newXml({ processName: 'Order', target: 'camunda8' })).xml, ops);
    expect(edited.xml).toBe((await core.applyToXml((await core.newXml({ processName: 'Order', target: 'camunda8' })).xml, ops)).xml);
    expect(edited.xml).toContain('<zeebe:userTask />');
    const report = await browser.validateXml(edited.xml);
    expect(report.platform).toMatchObject({ platform: 'c8', counts: { deploy: 1, runtime: 1, practice: 0 } });
    expect(JSON.stringify(report)).toBe(JSON.stringify(await core.validateXml(edited.xml)));
  });

  it('keeps the text and runs host validators like Node (step 2 packages together)', async () => {
    const styled = readFileSync(join(ROOT, 'test', 'fixtures', 'roundtrip', 'styled.bpmn'), 'utf8');
    const same = await browser.applyToXml(styled, [{ op: 'set', id: 'Task_Check', values: { name: 'Check order' } }]);
    expect(same.unchanged).toBe(true);
    expect(same.xml).toBe(styled);
    const phases: string[] = [];
    const host = (xml: string, ctx: { phase: string }): Array<{ severity: string; ruleId: string; message: string }> => {
      phases.push(`${ctx.phase}:${xml.includes('<!-- the order starts here -->')}`);
      return [];
    };
    /** every task is reached by a sequence flow */
    const reached = (xml: string): Array<{ severity: string; ruleId: string; message: string; element: string }> =>
      [...xml.matchAll(/<bpmn:\w*[tT]ask id="([^"]+)"/g)].filter((m) => !xml.includes(`targetRef="${m[1]}"`)).map((m) => ({ severity: 'ERROR', ruleId: 'flow/unreachable', message: `${m[1]} is never reached`, element: m[1]! }));
    const ops = [{ op: 'add', kind: 'userTask', name: 'Audit order', after: 'Task_Check' }];
    const opts = { validators: [host, reached] };
    const there = await browser.applyToXml(styled, ops, opts);
    expect(phases).toEqual(['before:true', 'after:true']);
    expect(there.result.created.map((c) => c.id)).toEqual(['Task_AuditOrder', 'Flow_AuditOrderToOrderOk']);
    expect(there.result.validation.validators?.map((v) => v.name)).toEqual(['host', 'reached']);
    const here = await core.applyToXml(styled, ops, opts);
    expect(there.xml).toBe(here.xml);
    expect(JSON.stringify(there.result)).toBe(JSON.stringify(here.result));
    const report = await browser.validateXml(here.xml, { validators: [reached] });
    expect(report.validators?.map((v) => v.name)).toEqual(['reached']);
    expect(JSON.stringify(report)).toBe(JSON.stringify(await core.validateXml(here.xml, { validators: [reached] })));
    await expect(browser.applyToXml(styled, [{ op: 'add', kind: 'task', name: 'Loose', in: 'Process_Styled' }], { validators: [reached] })).rejects.toMatchObject({ code: 'E_VALIDATION', name: 'CliError' });
  });

  it("runs the project's bpmnlint with an injected engine (the host's bpmnlint and bundled resolver) like Node", async () => {
    const require = createRequire(join(ROOT, 'package.json'));
    const { Linter } = require('bpmnlint') as { Linter: core.BpmnlintLinterClass };
    const plugin = require('@miragon/bpmnlint-plugin-rules') as { createBundledResolver(): core.BpmnlintResolver };
    const rc = { extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-modeling'] };
    const validator = async (api: typeof core) => {
      const engine = { Linter, resolver: plugin.createBundledResolver() };
      return api.bpmnlintValidator(engine, await api.resolveBpmnlintConfig(engine, rc), { detail: 'host' });
    };
    const xml = fixture('orders.bpmn');
    const ops = [{ op: 'add', kind: 'task', after: 'Task_A' }];
    const there = await browser.applyToXml(xml, ops, { validators: [await validator(browser)] });
    const here = await core.applyToXml(xml, ops, { validators: [await validator(core)] });
    expect(there.result.warnings.added).toContainEqual(expect.objectContaining({ code: 'label-required', validator: 'bpmnlint', severity: 'error' }));
    expect(there.xml).toBe(here.xml);
    expect(JSON.stringify(there.result)).toBe(JSON.stringify(here.result));
    const report = await browser.validateXml(here.xml, { validators: [await validator(browser)] });
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).toBe(JSON.stringify(await core.validateXml(here.xml, { validators: [await validator(core)] })));
  });

  it('refuses like Node: CliError codes cross the realm boundary', async () => {
    await expect(browser.applyToXml(fixture('orders.bpmn'), [{ op: 'add', kind: 'userTask', after: 'Nope' }])).rejects.toMatchObject({ code: 'E_NOT_FOUND', name: 'CliError' });
    await expect(browser.applyToXml('<not-bpmn/>', [{ op: 'tidy' }])).rejects.toMatchObject({ code: 'E_PARSE' });
  });
});

describe('the engine rules load on demand, only for their platform (an ESM split bundle, as a host bundler splits it)', () => {
  /** the chunks of the bundle, renamed to .mjs (Node loads them natively), each recording its evaluation */
  let files: Array<{ name: string; text: string; profile?: 'c7' | 'c8' }>;
  let dir: string;
  let count = 0;
  const LOADS = '__bpmnChunkLoads';
  /** Node's own import() (one in the test is vitest's: it would transform the chunks and cache a failed load), from a CommonJS helper */
  let nativeImport: (url: string) => Promise<unknown>;
  const loads = (): string[] => ((globalThis as Record<string, unknown>)[LOADS] as string[] | undefined) ?? [];
  const plain = fixture('orders.bpmn');
  const rename = [{ op: 'set', id: 'Task_A', values: { name: 'Check the order' } }];
  const toC7 = [{ op: 'set', id: 'Task_A', values: { 'camunda:assignee': 'demo' } }];
  const toC8 = [{ op: 'ext', id: 'Task_A', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'check' } }];
  /** a host validator with an error the fixture already has (Task_Recv has no flow); it says W_DEAD_END again */
  const hosted = {
    validators: [{
      name: 'host',
      covers: { E_HOST_LOOSE: 'W_DEAD_END' },
      validate: (xml: string): Array<{ severity: string; code: string; message: string; element: string }> =>
        xml.includes('id="Task_Recv"') ? [{ severity: 'ERROR', code: 'E_HOST_LOOSE', message: 'Task_Recv has no sequence flow', element: 'Task_Recv' }] : [],
    }],
  };
  let c7: string;
  let c8: string;
  let bundle: Bundle;
  /** the chunks the entry loads statically (with it) */
  const initial = new Set<string>();

  beforeAll(async () => {
    bundle = await bundleCore({ entry: join('src', 'index.ts'), splitting: true, minify: false });
    expect(bundle.violations).toEqual([]);
    const profileOf = (c: Chunk): 'c7' | 'c8' | undefined => (c.inputs.includes('src/platform/profiles/C7Profile.ts') ? 'c7' : c.inputs.includes('src/platform/profiles/c8.ts') ? 'c8' : undefined);
    files = bundle.chunks.map((c) => {
      const text = c.text.replace(/(["'])\.\/([\w.-]+)\.js\1/g, (_m, q: string, name: string) => `${q}./${name}.mjs${q}`);
      return { name: basename(c.path).replace(/\.js$/, '.mjs'), text: `(globalThis.${LOADS} ??= []).push(import.meta.url);\n${text}`, profile: profileOf(c) };
    });
    // the rule modules are chunks of their own, apart from what the entry loads statically
    const visit = (c: Chunk | undefined): void => {
      if (!c || initial.has(c.path)) return;
      initial.add(c.path);
      for (const p of c.imports) visit(bundle.chunks.find((x) => x.path === p));
    };
    visit(bundle.entry);
    const initialInputs = bundle.chunks.filter((c) => initial.has(c.path)).flatMap((c) => c.inputs);
    expect(initialInputs.filter((f) => /^src\/platform\/(c7|c8|feel|schema-text)\.ts$/.test(f))).toEqual([]);
    expect(files.filter((f) => f.profile).map((f) => f.profile).sort()).toEqual(['c7', 'c8']);
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'bpmn-lazy-profiles-')));
    writeFileSync(join(dir, 'import.cjs'), 'module.exports = (url) => import(url);\n');
    nativeImport = createRequire(import.meta.url)(join(dir, 'import.cjs')) as typeof nativeImport;
    c7 = (await core.applyToXml(plain, toC7)).xml;
    c8 = (await core.applyToXml(plain, toC8)).xml;
  }, 60000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** A fresh instance of the bundle (a module graph of its own, nothing loaded) and the profile chunks it has evaluated so far. */
  async function fresh(): Promise<{ lib: typeof core; at: string; profiles: () => string[] }> {
    const at = join(dir, `i${count++}`);
    mkdirSync(at);
    for (const f of files) writeFileSync(join(at, f.name), f.text);
    const base = `${pathToFileURL(at).href}/`;
    const lib = (await nativeImport(`${base}index.mjs`)) as typeof core;
    const byName = new Map(files.map((f) => [f.name, f.profile]));
    const profiles = (): string[] => loads().filter((u) => u.startsWith(base)).flatMap((u) => byName.get(u.slice(base.length)) ?? []);
    return { lib, at, profiles };
  }

  it('the entry chunk is the one of the requested entry, though esbuild makes every import() target an entry point', () => {
    expect(bundle.chunks.filter((c) => c.entry).map((c) => c.entryPoint)).toEqual(['src/index.ts']);
    expect(bundle.entry.entryPoint).toBe('src/index.ts');
    expect(bundle.chunks.map((c) => c.entryPoint)).toEqual(expect.arrayContaining(['src/platform/profiles/C7Profile.ts', 'src/platform/profiles/c8.ts']));
  });

  it('the rule chunks import nothing the entry loads (a host whose entry module awaits a call at top level does not wait for itself)', () => {
    // Rollup / Vite put a module the entry and a rule chunk share into the
    // entry chunk, and the rule chunk would import the entry chunk back:
    // with a top-level await in the host's entry module that never settles.
    const reach = (start: string): Set<string> => {
      const seen = new Set<string>();
      const visit = (f: string): void => {
        if (seen.has(f) || !bundle.graph[f]) return;
        seen.add(f);
        for (const g of bundle.graph[f]) visit(g);
      };
      visit(start);
      return seen;
    };
    const core = reach('src/index.ts');
    expect(core.has('src/model/utils/moddle.ts') && core.has('src/platform/profiles/profile.ts')).toBe(true);
    for (const rules of ['src/platform/profiles/C7Profile.ts', 'src/platform/profiles/c8.ts']) {
      const own = [...reach(rules)];
      expect(own.filter((f) => core.has(f)), rules).toEqual([]);
      expect(own.flatMap((f) => bundle.graph[f] ?? []).filter((g) => core.has(g)), rules).toEqual([]);
      const chunk = bundle.chunks.find((c) => c.inputs.includes(rules))!;
      expect(chunk.imports.filter((p) => initial.has(p)), rules).toEqual([]);
    }
    expect(bundle.chunks.find((c) => c.inputs.includes('src/platform/profiles/c8.ts'))!.inputs).toEqual(expect.arrayContaining(['src/platform/profiles/feel.ts', 'src/platform/profiles/schema-text.ts']));
  });

  it('the instances load natively and record what they evaluate', async () => {
    const { lib, at } = await fresh();
    expect(loads()).toContain(`${pathToFileURL(at).href}/index.mjs`);
    expect(typeof lib.loadProfile).toBe('function');
  });

  it('a plain model loads no profile chunk', async () => {
    const { lib, profiles } = await fresh();
    const report = await lib.validateXml(plain);
    expect(report.platform?.platform).toBe('none');
    expect(JSON.stringify(report)).toBe(JSON.stringify(await core.validateXml(plain)));
    expect((await lib.applyToXml(plain, rename)).xml).toBe((await core.applyToXml(plain, rename)).xml);
    expect((await lib.newXml({ processName: 'Order' })).xml).toBe((await core.newXml({ processName: 'Order' })).xml);
    expect(profiles()).toEqual([]);
  });

  it('host validators on a plain model load no profile chunk and report like Node', async () => {
    const { lib, profiles } = await fresh();
    const report = await lib.validateXml(plain, hosted);
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual([expect.objectContaining({ code: 'E_HOST_LOOSE', validator: 'host', severity: 'error', element: 'Task_Recv' })]);
    expect(report.warnings.map((w) => w.code)).not.toContain('W_DEAD_END');
    expect(JSON.stringify(report)).toBe(JSON.stringify(await core.validateXml(plain, hosted)));
    const edited = await lib.applyToXml(plain, rename, hosted);
    expect(edited.result.validation.validators?.[0]?.preexisting.map((i) => i.code)).toEqual(['E_HOST_LOOSE']);
    expect(JSON.stringify(edited.result)).toBe(JSON.stringify((await core.applyToXml(plain, rename, hosted)).result));
    // the library's MutationResult keeps the pre-existing error among the warnings
    const mutated = await lib.mutateDoc(await lib.Doc.fromXml(plain), rename as core.Op[], hosted);
    expect(mutated.validation.warnings).toContainEqual(expect.objectContaining({ code: 'W_PREEXISTING_ERROR', validator: 'host', element: 'Task_Recv' }));
    expect(JSON.stringify(mutated.validation)).toBe(JSON.stringify((await core.mutateDoc(await core.Doc.fromXml(plain), rename as core.Op[], hosted)).validation));
    expect(profiles()).toEqual([]);
  });

  it("platform 'none' loads nothing, also for Camunda 7 and 8 files", async () => {
    const { lib, profiles } = await fresh();
    for (const xml of [c7, c8]) {
      expect((await lib.validateXml(xml, { platform: 'none' })).platform?.platform).toBe('none');
      expect((await lib.applyToXml(xml, rename, { platform: 'none' })).result.validation.platform?.platform).toBe('none');
    }
    expect(profiles()).toEqual([]);
  });

  it('a Camunda 7 file loads only the Camunda 7 rules, once', async () => {
    const { lib, profiles } = await fresh();
    const report = await lib.validateXml(c7);
    expect(report.platform).toMatchObject({ platform: 'c7', counts: { deploy: 4, runtime: 1 } });
    expect(JSON.stringify(report)).toBe(JSON.stringify(await core.validateXml(c7)));
    const edited = await lib.applyToXml(c7, rename);
    expect(JSON.stringify(edited.result)).toBe(JSON.stringify((await core.applyToXml(c7, rename)).result));
    expect(profiles()).toEqual(['c7']);
  });

  it('a Camunda 8 file loads only the Camunda 8 rules, once', async () => {
    const { lib, profiles } = await fresh();
    const report = await lib.validateXml(c8);
    expect(report.platform).toMatchObject({ platform: 'c8', counts: { deploy: 1, runtime: 3 } });
    expect(JSON.stringify(report)).toBe(JSON.stringify(await core.validateXml(c8)));
    const edited = await lib.applyToXml(c8, rename);
    expect(JSON.stringify(edited.result)).toBe(JSON.stringify((await core.applyToXml(c8, rename)).result));
    expect(profiles()).toEqual(['c8']);
  });

  it('a batch that turns a plain file into a Camunda 7 / 8 file loads the rules after the ops and reports the added findings like 0.4.0', async () => {
    const brief = (findings: Array<{ code: string; element?: string; related?: string[] }> | undefined): string[] => (findings ?? []).map((f) => [f.code, f.element, ...(f.related ?? [])].join(' '));
    const first = await fresh();
    const toSeven = await first.lib.applyToXml(plain, toC7);
    expect(first.profiles()).toEqual(['c7']);
    expect(toSeven.result.validation.platform).toMatchObject({ platform: 'c7', counts: { deploy: 4, runtime: 1, practice: 0 }, resolved: [] });
    expect(brief(toSeven.result.validation.platform?.added)).toEqual([
      'W_C7_DEPLOY_HISTORY_TTL Proc_A',
      'W_C7_MISPLACED_ATTRIBUTE Task_A',
      'W_C7_DEPLOY_EXCLUSIVE_GATEWAY Gw_Split F3',
      'W_C7_DEPLOY_EXCLUSIVE_GATEWAY Gw_Split F4',
      'W_C7_DEPLOY_EVENT_DEFINITION Timer_1',
    ]);
    expect(JSON.stringify(toSeven.result)).toBe(JSON.stringify((await core.applyToXml(plain, toC7)).result));
    const second = await fresh();
    const toEight = await second.lib.applyToXml(plain, toC8);
    expect(second.profiles()).toEqual(['c8']);
    expect(toEight.result.validation.platform).toMatchObject({ platform: 'c8', counts: { deploy: 1, runtime: 3, practice: 0 }, resolved: [] });
    expect(brief(toEight.result.validation.platform?.added)).toEqual([
      'W_C8_MISPLACED_EXTENSION Task_A',
      'W_C8_EXCLUSIVE_GATEWAY Gw_Split F3',
      'W_C8_EXCLUSIVE_GATEWAY Gw_Split F4',
      'W_C8_DEPLOY_TIMER Timer_1',
    ]);
    expect(JSON.stringify(toEight.result)).toBe(JSON.stringify((await core.applyToXml(plain, toC8)).result));
  });

  it('the synchronous building blocks need the rules loaded first (E_PROFILE_NOT_LOADED; loadProfile / loadProfiles)', async () => {
    const { lib, profiles } = await fresh();
    const doc = await lib.Doc.fromXml(c7);
    expect(() => lib.runProfile(doc)).toThrow(expect.objectContaining({ code: 'E_PROFILE_NOT_LOADED', category: 'usage' }));
    expect(() => lib.validateDoc(doc, { platform: 'auto' })).toThrow(expect.objectContaining({ code: 'E_PROFILE_NOT_LOADED' }));
    expect(() => lib.runProfile(doc, 'c8')).toThrow(expect.objectContaining({ code: 'E_PROFILE_NOT_LOADED', details: expect.objectContaining({ platform: 'c8' }) }));
    // no rules needed: plain BPMN, platform 'none', the structural validation
    expect(lib.runProfile(doc, 'none').findings).toEqual([]);
    expect(lib.runProfile(await lib.Doc.fromXml(plain)).platform).toBe('none');
    expect(lib.validateDoc(doc).errors).toEqual([]);
    await lib.loadProfile('none');
    expect(profiles()).toEqual([]);
    await Promise.all([lib.loadProfile('c7'), lib.loadProfile('c7')]);
    await lib.loadProfile('c7');
    expect(profiles()).toEqual(['c7']);
    expect(JSON.stringify(lib.runProfile(doc))).toBe(JSON.stringify(core.runProfile(await core.Doc.fromXml(c7))));
    await lib.loadProfiles();
    expect(profiles()).toEqual(['c7', 'c8']);
    expect(lib.runProfile(doc, 'c8').platform).toBe('c8');
    await expect(lib.loadProfile('camunda7' as never)).rejects.toMatchObject({ code: 'E_USAGE' });
  });

  it('a profile chunk that fails to load rejects with E_PROFILE_LOAD before a result exists; a later call imports it again (Node loads it)', async () => {
    const { lib, at, profiles } = await fresh();
    const chunk = join(at, files.find((f) => f.profile === 'c8')!.name);
    renameSync(chunk, `${chunk}.gone`);
    // a browser may keep the failed module fetch until the page reloads: the hint says so
    await expect(lib.validateXml(c8)).rejects.toMatchObject({ code: 'E_PROFILE_LOAD', category: 'io', details: { platform: 'c8', hint: expect.stringContaining('until the page reloads') } });
    await expect(lib.applyToXml(c8, rename)).rejects.toMatchObject({ code: 'E_PROFILE_LOAD', name: 'CliError' });
    await expect(lib.applyToXml(plain, toC8)).rejects.toMatchObject({ code: 'E_PROFILE_LOAD' });
    expect((await lib.applyToXml(c7, rename)).result.validation.platform?.platform).toBe('c7');
    renameSync(`${chunk}.gone`, chunk);
    expect(JSON.stringify(await lib.validateXml(c8))).toBe(JSON.stringify(await core.validateXml(c8)));
    expect(profiles()).toEqual(['c7', 'c8']);
  });
});

describe('the inlined Camunda 7 and Camunda 8 descriptors', () => {
  it('equal the installed camunda-bpmn-moddle and zeebe-bpmn-moddle (run tools/gen-camunda-descriptor.mjs after an update)', () => {
    const require = createRequire(join(ROOT, 'package.json'));
    const dir = dirname(require.resolve('camunda-bpmn-moddle/package.json'));
    expect(CAMUNDA_DESCRIPTOR_VERSION).toBe(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version);
    expect(CAMUNDA_DESCRIPTOR).toEqual(JSON.parse(readFileSync(join(dir, 'resources', 'camunda.json'), 'utf8')));
    const zeebe = dirname(require.resolve('zeebe-bpmn-moddle/package.json'));
    expect(ZEEBE_DESCRIPTOR_VERSION).toBe(JSON.parse(readFileSync(join(zeebe, 'package.json'), 'utf8')).version);
    expect(ZEEBE_DESCRIPTOR).toEqual(JSON.parse(readFileSync(join(zeebe, 'resources', 'zeebe.json'), 'utf8')));
  });
});
