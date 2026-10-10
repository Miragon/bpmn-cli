/**
 * The CLI side of step 3 (views and output): `show --around` / `--context`,
 * compact JSON with --pretty, `--summary`, `guide --short` / `guide <topic>`,
 * `kinds --section`, and stdin / stdout (`-` as the file, `-o -`). The CLI
 * runs from the sources (tsx). Synthetic models only.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { COMMANDS, GUIDE_TOPICS, guideTopic, KINDS_SECTION_NAMES } from '../src/guide.js';

const ROOT = join(import.meta.dirname, '..');
const CLAIMS = join(ROOT, 'test', 'fixtures', 'views', 'claims.bpmn');
let dir: string;

interface Run {
  code: number;
  out: string;
  err: string;
}

function cli(args: string[], input = ''): Run {
  // from the repository root (tsx resolves from there); every file argument is absolute
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT, input });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

function ok(args: string[], input = ''): Run {
  const r = cli(args, input);
  if (r.code !== 0) throw new Error(`bpmn ${args.join(' ')} failed (${r.code}):\n${r.err}\n${r.out}`);
  return r;
}

function copy(name: string): string {
  const file = join(dir, name);
  copyFileSync(CLAIMS, file);
  return file;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-views-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('show --around / --context on the command line', () => {
  it('prints the neighbourhood and the context; --json is one line, --pretty indents', () => {
    const around = ok(['show', CLAIMS, '--around', 'Activity_CheckPolicy', '--depth', '1']);
    expect(around.out).toMatch(/^around Activity_CheckPolicy \(depth 1\): 3 of 16 nodes/);
    const context = ok(['show', CLAIMS, 'Activity_CheckPolicy', '--context']);
    expect(context.out).toContain('caught by: boundaryEvent:error Event_FraudSuspected "Fraud suspected" on Activity_Assess');
    const json = ok(['show', CLAIMS, '--around', 'Activity_CheckPolicy', '--json']);
    expect(json.out.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(json.out)).toMatchObject({ around: 'Activity_CheckPolicy', depth: 2, shown: { nodes: 5 } });
    const pretty = ok(['show', CLAIMS, 'Activity_CheckPolicy', '--context', '--json', '--pretty']);
    expect(pretty.out.split('\n').length).toBeGreaterThan(10);
    expect(JSON.parse(pretty.out)).toMatchObject({ id: 'Activity_CheckPolicy', lane: { id: 'Lane_Office', via: 'Activity_Assess' } });
  }, 60000);

  it('refuses options that do not go together, and names (ids only)', () => {
    for (const args of [
      ['show', CLAIMS, 'Activity_Pay', '--around', 'Activity_Pay'],
      ['show', CLAIMS, '--depth', '2'],
      ['show', CLAIMS, '--around', 'Activity_Pay', '--depth', 'two'],
      ['show', CLAIMS, '--context'],
      ['show', CLAIMS, '--layout', '--around', 'Activity_Pay'],
    ]) {
      const r = cli(args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err).toMatch(/^error E_USAGE: /);
    }
    const byName = cli(['show', CLAIMS, '--around', 'Pay claim']);
    expect(byName.code).toBe(2);
    expect(byName.err).toMatch(/^error E_NOT_FOUND: /);
  }, 60000);
});

describe('mutation output on the command line', () => {
  it('--summary prints created ids by kind and one layout line; --json --summary the summary', () => {
    const file = copy('summary.bpmn');
    const r = ok(['add', file, 'userTask', 'Double-check', '--after', 'Activity_RateDamage', '--id', 'Activity_DoubleCheck', '--summary', '--no-layout']);
    const lines = r.out.trimEnd().split('\n');
    expect(lines[0]).toBe('created userTask: Activity_DoubleCheck');
    expect(lines[1]).toMatch(/^created sequenceFlow: \S+$/);
    expect(lines).toContain('warnings: 0 added, 0 resolved, 1 already in the file');
    expect(lines.at(-2)).toMatch(/^layout: skipped/);
    expect(lines.at(-1)).toBe(`written: ${file}`);
    const json = ok(['set', file, 'Activity_DoubleCheck', 'name=Check again', '--summary', '--json', '--no-layout']);
    expect(json.out.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(json.out)).toMatchObject({ ok: true, created: {}, changed: ['Activity_DoubleCheck'], removed: [], warnings: { added: [], resolvedCount: 0, preexistingCount: 1 }, layout: { status: 'skipped' }, written: true });
  }, 60000);

  it('a full result lists only the added warnings and counts the others; --json carries the delta', () => {
    const file = copy('delta.bpmn');
    const r = ok(['set', file, 'Activity_Pay', 'name=Pay the claim', '--no-layout']);
    expect(r.out).not.toContain('W_IMPLICIT_JOIN');
    expect(r.out).toContain('1 warning already in the file (not repeated: `bpmn validate <file>` lists them)');
    const json = JSON.parse(ok(['set', file, 'Activity_Pay', 'name=Pay', '--no-layout', '--json']).out);
    expect(json.warnings).toEqual({ added: [], resolved: [], preexistingCount: 1 });
    expect(json.validation).not.toHaveProperty('warnings');
    // bpmn validate still lists every warning
    expect(ok(['validate', file]).out).toContain('W_IMPLICIT_JOIN Activity_SendDecision');
  }, 60000);
});

describe('stdin and stdout', () => {
  const MODEL = readFileSync(CLAIMS, 'utf8');

  it('reading commands take `-` for stdin', () => {
    expect(ok(['show', '-', '--around', 'Activity_Pay', '--depth', '0'], MODEL).out).toMatch(/^around Activity_Pay \(depth 0\)/);
    expect(ok(['validate', '-'], MODEL).out).toContain('W_IMPLICIT_JOIN Activity_SendDecision');
    expect(ok(['find', '-', 'check-policy'], MODEL).out).toContain('serviceTask Activity_CheckPolicy');
    expect(ok(['metrics', '-'], MODEL).out).toMatch(/^score /);
    expect(ok(['ext', 'list', '-', 'Activity_CheckPolicy'], MODEL).out).toContain('camunda:inputOutput');
  }, 60000);

  it('a change to a model from stdin goes to stdout, the report to stderr', async () => {
    writeFileSync(join(dir, 'ops.json'), JSON.stringify([{ op: 'set', id: 'Activity_Pay', values: { name: 'Pay the claim' } }]));
    const r = ok(['apply', '-', join(dir, 'ops.json'), '--no-layout'], MODEL);
    expect(r.out).toContain('name="Pay the claim"');
    expect((await Doc.fromXml(r.out)).require('Activity_Pay').get('name')).toBe('Pay the claim');
    expect(r.err).toContain('changed serviceTask Activity_Pay "Pay the claim"');
    expect(r.err).toContain('written: -');
    // --json: the report as JSON on stderr
    const json = ok(['set', '-', 'Activity_Pay', 'name=X', '--no-layout', '--json'], MODEL);
    expect(JSON.parse(json.err)).toMatchObject({ ok: true, written: true, file: '-' });
    // stdin holds one input: the model and the ops cannot both come from it
    const both = cli(['apply', '-', '-'], MODEL);
    expect(both.code).toBe(1);
    expect(both.err).toMatch(/^error E_USAGE: the model and the ops cannot both come from stdin/);
  }, 60000);

  it('-o - writes the result to stdout and leaves the file as it was; new - prints a new model', async () => {
    const file = copy('stdout.bpmn');
    const before = readFileSync(file, 'utf8');
    const r = ok(['set', file, 'Activity_Pay', 'name=Pay out', '-o', '-', '--no-layout']);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(r.out).toContain('name="Pay out"');
    expect(r.err).toContain('written: -');
    const created = ok(['new', '-', '--name', 'Fresh']);
    expect((await Doc.fromXml(created.out)).processes().map((p) => p.get('id'))).toEqual(['Process_Fresh']);
    expect(created.err).toContain('created process Process_Fresh "Fresh"');
    // a dry run on stdin writes nothing: the report stays on stdout
    const dry = ok(['set', '-', 'Activity_Pay', 'name=Y', '--dry-run', '--no-layout'], MODEL);
    expect(dry.out).toContain('changed serviceTask Activity_Pay "Y"');
    expect(dry.out).not.toContain('<bpmn:definitions');
  }, 60000);
});

describe('guide --short, guide <topic>, kinds --section', () => {
  it('guide --short is the core in at most 5 KB', () => {
    const short = ok(['guide', '--short']).out;
    expect(Buffer.byteLength(short)).toBeLessThanOrEqual(5 * 1024);
    for (const heading of ['CONTRACT', 'READ', 'CHANGE', 'OPS JSON', 'PLACEMENT', 'TOP ERRORS']) expect(short).toMatch(new RegExp(`^${heading}`, 'm'));
    expect(short).toContain('by id only');
    // every op is listed with its keys
    expect(short).toMatch(/^ {2}add {6}kind\* name id as flowAs after before flow in on to lane/m);
    expect(Buffer.byteLength(ok(['guide']).out)).toBeGreaterThan(5 * Buffer.byteLength(short));
  }, 60000);

  it('every topic prints its sections; an unknown topic is a usage error', () => {
    for (const [topic, { sections }] of Object.entries(GUIDE_TOPICS)) {
      const text = guideTopic(topic);
      for (const s of sections) expect(text, topic).toContain(`${s}`);
      expect(text.length, topic).toBeGreaterThan(200);
    }
    expect(ok(['guide', 'camunda8']).out).toMatch(/^CAMUNDA 8/);
    const bad = cli(['guide', 'bogus']);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('candidates: contract, workflow, reading');
    expect(cli(['guide', 'layout', '--short']).code).toBe(1);
  }, 60000);

  it('kinds --section prints only the named parts, as text or JSON', () => {
    expect(Object.keys(JSON.parse(ok(['kinds', '--section', 'ops,errors', '--json']).out))).toEqual(['ops', 'opsExample', 'errors']);
    expect(ok(['kinds', '--section', 'set-keys']).out).toMatch(/^SET KEYS/);
    expect(ok(['kinds', '--section', 'exitCodes']).out).toMatch(/^EXIT CODES\n-+\n {2}0 +ok/);
    const bad = cli(['kinds', '--section', 'bogus']);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/^error E_USAGE: Unknown kinds section "bogus"/);
    // the kinds command documents the section names it accepts
    expect(COMMANDS.find((c) => c.name === 'kinds')?.summary).toContain(KINDS_SECTION_NAMES);
    // compact by default
    expect(ok(['kinds', '--json']).out.trimEnd().split('\n')).toHaveLength(1);
  }, 60000);

  it('the CAMUNDA 8 recipe of the guide runs', () => {
    const file = join(dir, 'c8.bpmn');
    ok(['new', file, '--name', 'Order', '--target', 'camunda8']);
    ok(['add', file, 'start', 'Received', '--id', 'Event_Received']);
    ok(['add', file, 'serviceTask', 'Charge', '--after', 'Event_Received', '--id', 'Activity_Charge']);
    ok(['add', file, 'callActivity', 'Bill', '--after', 'Activity_Charge', '--id', 'Activity_Bill']);
    ok(['add', file, 'userTask', 'Review', '--after', 'Activity_Bill', '--id', 'Activity_Review']);
    ok(['add', file, 'businessRuleTask', 'Rate', '--after', 'Activity_Review', '--id', 'Activity_Rate']);
    ok(['add', file, 'end', 'Done', '--after', 'Activity_Rate']);
    const recipe = guideTopic('camunda8')
      .split('\n')
      .map((l) => /^ {4}bpmn ((?:ext add|set) f\.bpmn .*?)(?: {2,}.*)?$/.exec(l)?.[1])
      .filter((c): c is string => !!c);
    expect(recipe.length).toBeGreaterThanOrEqual(6);
    for (const command of recipe) {
      // the shell's single quotes: `source='=order.total'` is one word
      const words = [...command.matchAll(/(?:[^\s']+|'[^']*')+/g)].map((m) => m[0].replace(/'/g, ''));
      ok(words.map((w) => (w === 'f.bpmn' ? file : w)));
    }
    const around = ok(['show', file, '--around', 'Activity_Charge', '--depth', '0']).out;
    expect(around).toContain('zeebe:taskDefinition type=charge-card retries=3, io: in amount; out receipt, zeebe:taskHeaders: channel');
  }, 120000);
});
