/**
 * The core entry (src/index.ts, the package's "." export) runs in a browser:
 * it bundles for platform=browser without Node builtins or Node-only globals
 * (tools/iso/bundle.mjs, the same check `npm run gate` runs on dist/ with
 * tools/iso/check.mjs), and the bundle works in a vm context that has no
 * Node globals at all (no process, Buffer, require, setTimeout): the
 * in-memory API gives there exactly what it gives in Node.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import { CAMUNDA_DESCRIPTOR, CAMUNDA_DESCRIPTOR_VERSION } from '../src/platform/camunda-descriptor.js';
// @ts-expect-error plain ESM tooling without type declarations
import { bundleCore, NODE_GLOBALS } from '../tools/iso/bundle.mjs';

const ROOT = join(import.meta.dirname, '..');
const fixture = (name: string): string => readFileSync(join(ROOT, 'test', 'fixtures', 'incremental', name), 'utf8');

interface Violation {
  kind: string;
  what: string;
  file: string;
}

interface Bundle {
  code: string;
  bytes: number;
  inputs: string[];
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
    expect(there.result.created.map((c) => c.id)).toContain('Activity_ShipGoods');
    expect(there.unchanged).toBe(false);
    expect(there.xml).toBe(here.xml);
    expect(JSON.stringify(there.result)).toBe(JSON.stringify(here.result));
    // the debug hook works without process.env
    expect(lines.some((l) => l.startsWith('[route] '))).toBe(true);
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
    expect(await browser.findXml(edited.xml, 'demo')).toEqual(await core.findXml(edited.xml, 'demo'));
    expect(await browser.metricsXml(edited.xml)).toEqual(await core.metricsXml(edited.xml));
  });

  it('refuses like Node: CliError codes cross the realm boundary', async () => {
    await expect(browser.applyToXml(fixture('orders.bpmn'), [{ op: 'add', kind: 'userTask', after: 'Nope' }])).rejects.toMatchObject({ code: 'E_NOT_FOUND', name: 'CliError' });
    await expect(browser.applyToXml('<not-bpmn/>', [{ op: 'tidy' }])).rejects.toMatchObject({ code: 'E_PARSE' });
  });
});

describe('the inlined Camunda 7 descriptor', () => {
  it('equals the installed camunda-bpmn-moddle (run tools/gen-camunda-descriptor.mjs after an update)', () => {
    const require = createRequire(join(ROOT, 'package.json'));
    const dir = dirname(require.resolve('camunda-bpmn-moddle/package.json'));
    expect(CAMUNDA_DESCRIPTOR_VERSION).toBe(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version);
    expect(CAMUNDA_DESCRIPTOR).toEqual(JSON.parse(readFileSync(join(dir, 'resources', 'camunda.json'), 'utf8')));
  });
});
