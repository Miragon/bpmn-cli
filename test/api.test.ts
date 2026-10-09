/**
 * The in-memory API (src/api.ts) is the CLI without files: for the same
 * input every function gives what the CLI command it names writes and
 * prints (`--json` without `file` / `written`; the text through
 * renderMutation / renderValidation / showXml), including the guards and
 * error codes. The CLI runs from the sources (tsx), so no build is needed.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyToXml,
  extensionsXml,
  findXml,
  layoutXml,
  metricsXml,
  mutateDoc,
  mutationReport,
  newXml,
  renderMutation,
  renderValidation,
  setLayoutDebug,
  showXml,
  validateXml,
  viewXml,
  Doc,
  type CliError,
} from '../src/index.js';
import { definitionsXml, LINEAR } from './helpers.js';

const ROOT = join(import.meta.dirname, '..');
const fixturePath = (name: string): string => join(ROOT, 'test', 'fixtures', 'incremental', name);
const fixture = (name: string): string => readFileSync(fixturePath(name), 'utf8');
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-api-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number;
  out: string;
  err: string;
}

function cli(...args: string[]): Run {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT, input: '' });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

/** A copy of a fixture (or of XML) in the temp directory, for the CLI to write. */
function copy(name: string, xml?: string): string {
  const file = join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
  if (xml !== undefined) writeFileSync(file, xml);
  else copyFileSync(fixturePath(name), file);
  return file;
}

/** The CLI's --json output of a mutation without file and written (what EditResult.result holds). */
function cliReport(r: Run): Record<string, unknown> {
  expect(r.code, r.err).toBe(0);
  const { file: _file, written: _written, ...rest } = JSON.parse(r.out) as Record<string, unknown>;
  return rest;
}

async function rejected(p: Promise<unknown>): Promise<CliError> {
  try {
    await p;
  } catch (err) {
    return err as CliError;
  }
  throw new Error('expected a rejection');
}

describe('the README example (Library use)', () => {
  it('does what its comments say', async () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const example = /## Library use[\s\S]*?```ts\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    expect(example).toContain("from '@miragon/bpmn-cli'");
    let { xml } = await newXml({ processName: 'Order handling' });
    const edit = await applyToXml(xml, [
      { op: 'add', kind: 'start', name: 'Order received' },
      { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'Event_OrderReceived' },
      { op: 'add', kind: 'end', name: 'Done', after: 'Activity_CheckInvoice' },
    ]);
    expect(example).toContain("{ op: 'add', kind: 'end', name: 'Done', after: 'Activity_CheckInvoice' },");
    if (!edit.unchanged) xml = edit.xml;
    const quote = (v: unknown): string => JSON.stringify(v).replaceAll('"', "'").replaceAll(',', ', ');
    expect(example).toContain(`// ${quote(edit.result.created.map((c) => c.id))}`);
    expect(example).toContain(`// '${edit.result.layout.mode}' (${edit.result.layout.reason})`);
    expect(renderMutation(edit.result)).toMatch(/^created startEvent [\s\S]*\nlayout: ok - full \(/m);
    const quickStart = /\$ bpmn show order\.bpmn\n([\s\S]*?)\n```/.exec(readme)?.[1];
    expect(await showXml(xml)).toBe(quickStart);
    const err = await rejected(applyToXml(xml, [{ op: 'add', kind: 'userTask', name: 'Ship', after: 'Activity_Check' }]));
    expect(example).toContain(`err.code;               // '${err.code}'`);
    expect(example).toContain(`err.details.candidates; // ${quote(err.details.candidates)}`);
  });
});

describe('applyToXml = bpmn apply', () => {
  const ops = [
    { op: 'add', kind: 'userTask', name: 'Ship goods', after: 'Task_A' },
    { op: 'color', ids: ['Task_B'], color: 'red' },
  ];

  it('writes the same XML and reports the same JSON as the CLI (incremental, format op)', async () => {
    const file = copy('orders.bpmn');
    const opsFile = copy('ops.json', JSON.stringify(ops));
    const report = cliReport(cli('apply', file, opsFile, '--json'));
    const api = await applyToXml(fixture('orders.bpmn'), ops);
    expect(api.xml).toBe(readFileSync(file, 'utf8'));
    expect(api.unchanged).toBe(false);
    expect(api.result).toEqual(report);
    expect((api.result.layout as { mode?: string }).mode).toBe('incremental');
    expect(api.result).not.toHaveProperty('xml');
  });

  it('renderMutation prints what the CLI prints (but the file line)', async () => {
    const file = copy('orders.bpmn');
    const r = cli('add', file, 'userTask', 'Ship goods', '--after', 'Task_A', '--show');
    expect(r.code, r.err).toBe(0);
    const api = await applyToXml(fixture('orders.bpmn'), [{ op: 'add', kind: 'userTask', name: 'Ship goods', after: 'Task_A' }], { show: true });
    expect(r.out.replace(/^written: .*\n/m, '')).toBe(`${renderMutation(api.result)}\n`);
    expect(api.result.view?.processes.length).toBe(2);
    // the in-memory pipeline renders the same (a document without a file has no file line)
    const doc = await Doc.fromXml(fixture('orders.bpmn'));
    const direct = await mutateDoc(doc, [{ op: 'add', kind: 'userTask', name: 'Ship goods', after: 'Task_A' }], { show: true });
    expect(renderMutation(mutationReport(direct))).toBe(renderMutation(api.result));
  });

  it('takes the layout, engine and show flags like the CLI', async () => {
    const cases: Array<[string[], Parameters<typeof applyToXml>[2]]> = [
      [['--no-layout', '--show'], { layout: false, show: true }],
      [['--layout', 'full', '--engine', 'auto'], { layout: 'full', engine: 'auto' }],
      [['--relayout'], { layout: 'full' }],
      [['--layout', 'incremental'], { layout: 'incremental' }],
    ];
    for (const [flags, opts] of cases) {
      const file = copy('sub.bpmn');
      const report = cliReport(cli('add', file, 'task', 'Next', '--after', 'T', '--json', ...flags));
      // the model view names the CLI's file; the in-memory document has none
      if (report['view']) delete (report['view'] as Record<string, unknown>)['file'];
      const api = await applyToXml(fixture('sub.bpmn'), [{ op: 'add', kind: 'task', name: 'Next', after: 'T' }], opts);
      expect(api.xml, flags.join(' ')).toBe(readFileSync(file, 'utf8'));
      expect(api.result, flags.join(' ')).toEqual(report);
    }
  });

  it('takes {ops} and JSON text, and checks ops like `bpmn apply` (E_USAGE naming the op)', async () => {
    const xml = fixture('sub.bpmn');
    const op = { op: 'set', id: 'T', values: { name: 'Later' } };
    const a = await applyToXml(xml, [op]);
    expect((await applyToXml(xml, { ops: [op] })).xml).toBe(a.xml);
    expect((await applyToXml(xml, JSON.stringify([op]))).xml).toBe(a.xml);
    const bad = await rejected(applyToXml(xml, [op, { op: 'space', after: 'T', by: 'lots' }]));
    expect(bad).toMatchObject({ code: 'E_USAGE', category: 'usage' });
    expect(bad.message).toContain('ops[1]');
    expect(await rejected(applyToXml(xml, '[{"op":'))).toMatchObject({ code: 'E_USAGE' });
    expect(await rejected(applyToXml(xml, []))).toMatchObject({ code: 'E_USAGE' });
    // the same refusal as the CLI
    const file = copy('sub.bpmn');
    const opsFile = copy('ops.json', JSON.stringify([op, { op: 'space', after: 'T', by: 'lots' }]));
    const r = cli('apply', file, opsFile, '--json');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error.message).toBe(bad.message);
  });

  it('normalises op values like `bpmn apply` (audit #49: a pixel count given as text moves by that many pixels)', async () => {
    const file = copy('sub.bpmn');
    const r = cli('space', file, '--after', 'SP', '--by', '80', '--json');
    expect(r.code, r.err).toBe(0);
    const api = await applyToXml(fixture('sub.bpmn'), [{ op: 'space', after: 'SP', by: '80' }]);
    expect(api.xml).toBe(readFileSync(file, 'utf8'));
    const x = (xml: string, id: string): number => Number(new RegExp(`bpmnElement="${id}"[^>]*>\\s*<dc:Bounds x="([\\d.]+)"`).exec(xml)![1]);
    expect(x(api.xml, 'T') - x(fixture('sub.bpmn'), 'T')).toBe(80);
  });

  it('refuses a lossy import (E_IMPORT_LOSSY) and new validation errors (E_VALIDATION) unless force', async () => {
    const lossy = definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_A"><bpmn:incoming>F1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Task_A" />
    <bpmn:fooBar id="Junk_1" />`);
    const set = [{ op: 'set', id: 'Task_A', values: { name: 'X' } }];
    expect(await rejected(applyToXml(lossy, set))).toMatchObject({ code: 'E_IMPORT_LOSSY', category: 'io' });
    expect((await applyToXml(lossy, set, { force: true })).xml).not.toContain('fooBar');
    const esp = [{ op: 'add', kind: 'subProcess', id: 'Esp2', in: 'Process_1', set: { triggeredByEvent: 'true' } }];
    const err = await rejected(applyToXml(LINEAR, esp));
    expect(err.code).toBe('E_VALIDATION');
    expect((await applyToXml(LINEAR, esp, { force: true })).result.validation.errors.map((e) => e.element)).toEqual(['Esp2']);
  });

  it('says unchanged (and returns the input itself) when the result is byte-identical', async () => {
    const drawn = (await applyToXml(LINEAR, [{ op: 'set', id: 'Task_A', values: { name: 'Check' } }])).xml;
    const again = await applyToXml(drawn, [{ op: 'set', id: 'Task_A', values: { name: 'Check' } }]);
    expect(again.unchanged).toBe(true);
    expect(again.xml).toBe(drawn);
    const renamed = await applyToXml(drawn, [{ op: 'set', id: 'Task_A', values: { name: 'Check twice' } }]);
    expect(renamed.unchanged).toBe(false);
  });
});

describe('the debug hook (BPMN_LAYOUT_DEBUG of the CLI)', () => {
  const add = [{ op: 'add', kind: 'userTask', name: 'Ship goods', after: 'Task_A' }];

  it('the debug option receives the lines of its call only', async () => {
    const lines: string[] = [];
    await applyToXml(fixture('orders.bpmn'), add, { debug: (l) => lines.push(l) });
    expect(lines.some((l) => l.startsWith('[route] F2'))).toBe(true);
    const count = lines.length;
    await applyToXml(fixture('orders.bpmn'), add);
    expect(lines.length).toBe(count);
  });

  it('setLayoutDebug sets one sink for the process; the CLI maps BPMN_LAYOUT_DEBUG to it (stderr)', async () => {
    const lines: string[] = [];
    setLayoutDebug((l) => lines.push(l));
    try {
      await applyToXml(fixture('orders.bpmn'), add);
    } finally {
      setLayoutDebug();
    }
    expect(lines.some((l) => l.startsWith('[route] F2'))).toBe(true);
    const file = copy('orders.bpmn');
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), 'add', file, 'userTask', 'Ship goods', '--after', 'Task_A', '--dry-run'], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, BPMN_LAYOUT_DEBUG: '1' },
    });
    expect(r.stderr.split('\n').filter((l) => l.startsWith('['))).toEqual(lines);
    expect(cli('add', copy('orders.bpmn'), 'userTask', 'Ship goods', '--after', 'Task_A', '--dry-run').err).toBe('');
  });
});

describe('newXml = bpmn new', () => {
  it('creates the same file and report', async () => {
    const file = join(dir, 'new-c7.bpmn');
    const report = cliReport(cli('new', file, '--name', 'Order handling', '--target', 'camunda7', '--json'));
    const api = await newXml({ processName: 'Order handling', target: 'camunda7' });
    expect(api.xml).toBe(readFileSync(file, 'utf8'));
    expect(api.result).toEqual(report);
    expect(api.unchanged).toBe(false);
  });
});

describe('layoutXml = bpmn layout', () => {
  it('redraws with expand / collapse and reports them as changes, like the CLI', async () => {
    const file = copy('sub.bpmn');
    const report = cliReport(cli('layout', file, '--collapse', 'SP', '--json'));
    const api = await layoutXml(fixture('sub.bpmn'), { collapse: ['SP'] });
    expect(api.xml).toBe(readFileSync(file, 'utf8'));
    expect(api.result).toEqual(report);
    expect(api.result.changed).toEqual([{ id: 'SP', kind: 'subProcess', name: 'Sub', detail: 'expanded=false' }]);
  });

  it('tidy keeps the drawing, like `layout --tidy`', async () => {
    const file = copy('orders.bpmn');
    const report = cliReport(cli('layout', file, '--tidy', '--json'));
    const api = await layoutXml(fixture('orders.bpmn'), { tidy: true });
    expect(api.xml).toBe(readFileSync(file, 'utf8'));
    expect(api.result).toEqual(report);
  });

  it('refuses contradicting or wrong ids like the CLI', async () => {
    const xml = fixture('sub.bpmn');
    expect(await rejected(layoutXml(xml, { tidy: true, expand: ['SP'] }))).toMatchObject({ code: 'E_USAGE' });
    expect(await rejected(layoutXml(xml, { expand: ['SP'], collapse: ['SP'] }))).toMatchObject({ code: 'E_USAGE' });
    const wrong = await rejected(layoutXml(xml, { expand: ['T'] }));
    const r = cli('layout', copy('sub.bpmn'), '--expand', 'T', '--json');
    expect(wrong.code).toBe(JSON.parse(r.err).error.code);
  });
});

describe('validateXml = bpmn validate', () => {
  it('reports what `validate --json` reports (without file), and renderValidation prints its text', async () => {
    for (const name of ['orders.bpmn', 'sub.bpmn']) {
      const file = copy(name);
      const r = cli('validate', file, '--json');
      const { file: _file, ...report } = JSON.parse(r.out) as Record<string, unknown>;
      const api = await validateXml(fixture(name));
      expect(api, name).toEqual(report);
      expect(`${renderValidation(api)}\n`, name).toBe(cli('validate', file).out);
    }
  });

  it('runs the platform profile (auto-detected, or as given)', async () => {
    const c7 = (await newXml({ processName: 'Order', target: 'camunda7' })).xml;
    expect((await validateXml(c7)).platform?.platform).toBe('c7');
    const none = await validateXml(c7, { platform: 'none' });
    expect(none.platform?.platform).toBe('none');
    expect(none.warnings.filter((w) => w.code.startsWith('W_C7_'))).toEqual([]);
  });
});

describe('viewXml / showXml = bpmn show', () => {
  it('the model, one scope, one element and the drawing, as JSON and as text', async () => {
    const file = copy('orders.bpmn');
    const xml = fixture('orders.bpmn');
    const cases: Array<[string[], Parameters<typeof viewXml>[1]]> = [
      [[], {}],
      [['--scope', 'Proc_B'], { scope: 'Proc_B' }],
      [['Task_A'], { id: 'Task_A' }],
      [['--layout'], { layout: true }],
    ];
    for (const [args, opts] of cases) {
      const json = JSON.parse(cli('show', file, ...args, '--json').out) as Record<string, unknown>;
      const view = (await viewXml(xml, opts)) as unknown as Record<string, unknown>;
      // the CLI names its file (the model view and the drawing carry it)
      const { file: _file, ...rest } = json;
      const { file: _none, ...mine } = view;
      expect(mine, args.join(' ')).toEqual(rest);
      expect(`${await showXml(xml, opts)}\n`, args.join(' ')).toBe(cli('show', file, ...args).out.replace(` ${file}`, ''));
    }
  });

  it('refuses --layout with an id, and unknown ids, like the CLI', async () => {
    const xml = fixture('orders.bpmn');
    expect(await rejected(viewXml(xml, { layout: true, id: 'Task_A' }))).toMatchObject({ code: 'E_USAGE' });
    expect(await rejected(showXml(xml, { id: 'Nope' }))).toMatchObject({ code: 'E_NOT_FOUND' });
    expect(await rejected(showXml(xml, { scope: 'Task_A' }))).toMatchObject({ code: JSON.parse(cli('show', copy('orders.bpmn'), '--scope', 'Task_A', '--json').err).error.code });
  });
});

describe('metricsXml / findXml / extensionsXml = bpmn metrics / find / ext list', () => {
  it('metrics', async () => {
    const file = copy('orders.bpmn');
    const { file: _file, ...report } = JSON.parse(cli('metrics', file, '--json').out) as Record<string, unknown>;
    expect(await metricsXml(fixture('orders.bpmn'))).toEqual(report);
  });

  it('find, with the kind checked like the CLI', async () => {
    const file = copy('orders.bpmn');
    expect(await findXml(fixture('orders.bpmn'), 'task', { kind: 'userTask' })).toEqual(JSON.parse(cli('find', file, 'task', '--kind', 'userTask', '--json').out));
    expect(await findXml(fixture('orders.bpmn'), 'notify')).toEqual(JSON.parse(cli('find', file, 'notify', '--json').out));
    const err = await rejected(findXml(fixture('orders.bpmn'), '', { kind: 'usertsk' }));
    expect(err).toMatchObject({ code: 'E_UNKNOWN_KIND', category: 'usage' });
    expect(JSON.parse(cli('find', file, '', '--kind', 'usertsk', '--json').err).error).toEqual(err.toJSON());
  });

  it('ext list', async () => {
    const xml = definitionsXml(
      `
    <bpmn:userTask id="Task_A" camunda:assignee="demo"><bpmn:extensionElements><camunda:properties><camunda:property name="a" value="1" /></camunda:properties></bpmn:extensionElements></bpmn:userTask>`,
      { nsDecl: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"' },
    );
    const file = copy('ext.bpmn', xml);
    const api = await extensionsXml(xml, 'Task_A');
    expect(api).toEqual(JSON.parse(cli('ext', 'list', file, 'Task_A', '--json').out));
    expect(api.map((e) => e.type)).toEqual(['camunda:properties']);
  });
});
