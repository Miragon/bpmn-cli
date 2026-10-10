import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPS_SCHEMA, OP_FIELDS, opsExample, parseOps } from '../src/batch.js';
import { Doc } from '../src/document.js';
import { isCliError } from '../src/errors.js';
import { renderView } from '../src/format.js';
import { COMMANDS, COMMON_OPTIONS, ERROR_CATALOGUE, PLACEMENT_NOTES, guideText, kindsJson, kindsText } from '../src/guide.js';
import { KINDS } from '../src/kinds.js';
import { OP_NAMES, type Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';

/** Runs parseOps and returns the thrown CliError. */
function failure(input: unknown): { code: string; message: string; op?: number; hint?: string; candidates?: string[] } {
  try {
    parseOps(input);
  } catch (err) {
    if (isCliError(err)) return { code: err.code, message: err.message, ...err.details } as ReturnType<typeof failure>;
    throw err;
  }
  throw new Error('expected parseOps to throw');
}

const SRC_DIR = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Every E_/W_ code mentioned anywhere under src/ (code strings and contract
 * comments). A prefix used as a template (`W_LAYOUT_${code}`) is reported as
 * the family `W_LAYOUT_*`.
 */
function codesInSource(): string[] {
  const codes = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    if (file.endsWith('guide.ts')) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/\b[EW]_[A-Z][A-Z0-9_]*\b/g)) codes.add(m[0].endsWith('_') ? `${m[0]}*` : m[0]);
  }
  return [...codes].sort();
}

describe('parseOps: shapes', () => {
  it('accepts the example and returns typed ops in order', () => {
    const example = opsExample();
    const ops = parseOps(example);
    expect(ops.map((o) => o.op)).toEqual(['split', 'add', 'add', 'add', 'connect', 'set', 'ext']);
    expect(ops).toEqual(example.ops);
  });

  it('accepts a bare array and an object with $schema', () => {
    const op = { op: 'remove', ids: ['Task_A'] };
    expect(parseOps([op])).toEqual([op]);
    expect(parseOps({ $schema: 'x', ops: [op] })).toEqual([op]);
  });

  it('accepts every op shape with all of its keys', () => {
    const full: Op[] = [
      {
        op: 'add',
        kind: 'boundaryEvent:timer',
        name: 'Late',
        id: 'Event_Late',
        on: 'Task_A',
        lane: 'Lane_1',
        timer: 'PT2D',
        timerKind: 'duration',
        nonInterrupting: true,
        collapsed: false,
        ifAbsent: true,
        doc: 'docs',
        set: { 'camunda:asyncBefore': 'true' },
      },
      { op: 'add', kind: 'userTask', name: 'B', after: 'Task_A', to: 'End', flowName: 'go', flowId: 'Flow_go', condition: '${x}', language: 'feel' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', before: 'End', default: true },
      { op: 'add', kind: 'serviceTask', name: 'C', flow: 'F1' },
      { op: 'add', kind: 'participant', name: 'Customer', blackBox: true },
      { op: 'add', kind: 'participant', name: 'Shop', process: 'Process_1' },
      { op: 'add', kind: 'lane', name: 'Sales', in: 'Process_1', members: ['Task_A'] },
      { op: 'add', kind: 'textAnnotation', text: 'note', in: 'Process_1' },
      { op: 'add', kind: 'startEvent:message', message: 'Order', in: 'Process_1' },
      { op: 'add', kind: 'endEvent:error', error: 'Failed', errorCode: 'E1', in: 'Process_1' },
      { op: 'add', kind: 'endEvent:signal', signal: 'Sig', in: 'Process_1' },
      { op: 'add', kind: 'endEvent:escalation', escalation: 'Esc', escalationCode: 'X', in: 'Process_1' },
      { op: 'add', kind: 'intermediateCatchEvent:conditional', when: '${ready}', in: 'Process_1' },
      { op: 'add', kind: 'intermediateThrowEvent:link', link: 'L', in: 'Process_1' },
      { op: 'connect', source: 'Task_A', target: 'End', name: 'n', id: 'Flow_x', condition: '${a}', language: 'juel', message: 'M', ifAbsent: true },
      { op: 'connect', source: 'Task_A', target: 'End', default: true },
      { op: 'set', id: 'Task_A', values: { name: 'New', doc: '' }, unset: ['documentation'] },
      { op: 'set', id: 'Task_A', values: {}, unset: ['doc'] },
      { op: 'remove', ids: ['Task_A', 'Task_B'], bridge: false, ifExists: true },
      { op: 'retype', id: 'Start', kind: 'startEvent:timer', timer: 'R/PT1H', timerKind: 'cycle' },
      { op: 'move', ids: ['Task_A'], after: 'Start', before: 'End', lane: 'Lane_1', flowName: 'x', flowId: 'F9', condition: '${y}', language: 'feel' },
      { op: 'move', ids: ['Task_A'], in: 'Sub_1' },
      { op: 'move', ids: ['Task_A'], lane: 'Lane_2' },
      { op: 'order', id: 'Gateway_1', flows: ['F1', 'F2'] },
      { op: 'order', id: 'Participant_1', lanes: ['Lane_2', 'Lane_1'] },
      { op: 'place', ids: ['Task_A', 'End'], below: 'Task_B', after: 'Start' },
      { op: 'place', ids: ['Task_A'], rowOf: 'Task_B', columnOf: 'Start' },
      { op: 'place', ids: ['Task_A'], above: 'Task_B', before: 'End' },
      { op: 'align', ids: ['End', 'End_2'], axis: 'column', to: 'Task_A' },
      { op: 'color', ids: ['Task_A', 'F1'], color: 'red' },
      { op: 'label', id: 'Gateway_1', side: 'below' },
      { op: 'route', id: 'F1', exit: 'bottom', entry: 'top' },
      { op: 'space', after: 'Task_A', by: 'column' },
      { op: 'space', below: 'Lane_1', by: 80 },
      { op: 'tidy', ids: ['Task_A'] },
      { op: 'tidy' },
      { op: 'ext', id: 'Task_A', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'x' }, body: 'b', replace: true },
      { op: 'ext', id: 'Task_A', action: 'add', xml: '<zeebe:ioMapping/>' },
      { op: 'ext', id: 'Task_A', action: 'remove', type: 'zeebe:taskDefinition' },
      { op: 'ext', id: 'Task_A', action: 'remove', index: 0 },
      {
        op: 'split',
        after: 'Task_A',
        kind: 'parallelGateway',
        name: 'Both',
        id: 'Gateway_Both',
        join: true,
        joinId: 'Gateway_BothJoin',
        joinName: 'joined',
        branches: [
          { flowName: 'a', flowId: 'Fa', condition: '${a}', language: 'feel', nodes: [{ kind: 'userTask', name: 'A1' }, { kind: 'serviceTask', name: 'A2', doc: 'd' }] },
          { default: true, nodes: [] },
        ],
      },
    ];
    expect(parseOps(full)).toEqual(full);
    const used = new Set(full.map((o) => o.op));
    for (const name of OP_NAMES) expect(used.has(name), `no full-shape test for op ${name}`).toBe(true);
  });

  it('fills set.values when only unset is given and converts primitives in maps', () => {
    const [set] = parseOps([{ op: 'set', id: 'X', unset: ['doc'] }]);
    expect(set).toEqual({ op: 'set', id: 'X', unset: ['doc'], values: {} });
    const [add] = parseOps([{ op: 'add', kind: 'userTask', set: { isForCompensation: true, priority: 3 } }]);
    expect((add as { set?: Record<string, string> }).set).toEqual({ isForCompensation: 'true', priority: '3' });
  });

  it('ignores null values (treated as absent)', () => {
    expect(parseOps([{ op: 'add', kind: 'task', name: null, after: null }])).toEqual([{ op: 'add', kind: 'task' }]);
  });
});

describe('parseOps: rejections name the op index', () => {
  it('rejects non-batches', () => {
    expect(failure('x').message).toMatch(/Expected an array of ops/);
    expect(failure({ foo: [] }).message).toMatch(/Expected an array of ops/);
    expect(failure({ ops: [], extra: 1 }).message).toMatch(/Unknown top-level key "extra"/);
    expect(failure([]).message).toMatch(/empty/);
    expect(failure([]).code).toBe('E_USAGE');
  });

  it('rejects unknown and missing ops', () => {
    const e = failure([{ op: 'add', kind: 'task' }, { op: 'addd', kind: 'task' }]);
    expect(e.message).toMatch(/^ops\[1\]: unknown op "addd" \(did you mean "add"\?\)/);
    expect(e.op).toBe(1);
    expect(e.candidates).toEqual(['add']);
    expect(failure([{ kind: 'task' }]).message).toMatch(/^ops\[0\]: missing "op"; one of: add, connect/);
    expect(failure(['add']).message).toMatch(/^ops\[0\]: expected an op object, got string/);
  });

  it('rejects unknown keys with the allowed keys and a spelling hint', () => {
    const e = failure([{ op: 'remove', ids: ['a'] }, { op: 'add', kind: 'task', 'flow-name': 'x' }]);
    expect(e.message).toMatch(/^ops\[1\] \(add\): unknown key "flow-name" \(did you mean "flowName"\?\); allowed keys: kind, name, id, as, flowAs, after/);
    expect(e.op).toBe(1);
    expect(failure([{ op: 'connect', source: 'a', target: 'b', ifabsent: true }]).message).toMatch(/did you mean "ifAbsent"/);
    expect(failure([{ op: 'order', id: 'g', flows: ['f'], after: 'x' }]).message).toMatch(/^ops\[0\] \(order\): unknown key "after"; allowed keys: id, flows, lanes$/);
  });

  it('rejects missing required keys and wrong value types', () => {
    expect(failure([{ op: 'add' }]).message).toMatch(/^ops\[0\] \(add\): missing required key "kind"/);
    expect(failure([{ op: 'connect', source: 'a' }]).message).toMatch(/missing required key "target"/);
    expect(failure([{ op: 'add', kind: 42 }]).message).toMatch(/"kind" must be a string, got number 42/);
    expect(failure([{ op: 'add', kind: '' }]).message).toMatch(/"kind" must not be empty/);
    expect(failure([{ op: 'add', kind: 'task', collapsed: 'true' }]).hint).toMatch(/JSON literal true/);
    expect(failure([{ op: 'remove', ids: 'Task_A' }]).message).toMatch(/"ids" must be an array of strings, got string "Task_A"/);
    expect(failure([{ op: 'remove', ids: [] }]).message).toMatch(/"ids" needs at least 1 entry/);
    expect(failure([{ op: 'remove', ids: ['a', 3] }]).message).toMatch(/"ids\[1\]" must be a non-empty string/);
    expect(failure([{ op: 'set', id: 'a', values: 'name=x' }]).message).toMatch(/"values" must be an object of key\/value pairs/);
    expect(failure([{ op: 'set', id: 'a', values: { name: null } }]).message).toMatch(/"values.name" must be a string/);
    expect(failure([{ op: 'set', id: 'a', values: { name: ['x'] } }]).message).toMatch(/got an array/);
    expect(failure([{ op: 'ext', id: 'a', action: 'remove', index: -1 }]).message).toMatch(/"index" must be a non-negative integer/);
    expect(failure([{ op: 'ext', id: 'a', action: 'list' }]).message).toMatch(/"action" must be one of "add", "remove", got "list"/);
    expect(failure([{ op: 'retype', id: 'a', kind: 'startEvent:timer', timerKind: 'weekly' }]).message).toMatch(/"timerKind" must be one of "cycle", "duration", "date"/);
  });

  it('rejects conflicting placements', () => {
    expect(failure([{ op: 'add', kind: 'task', flow: 'F1', in: 'P' }]).message).toMatch(/^ops\[0\] \(add\): "flow" and "in" cannot be combined/);
    expect(failure([{ op: 'add', kind: 'task', after: 'A', flow: 'F1' }]).message).toMatch(/"after" and "flow" cannot be combined/);
    expect(failure([{ op: 'add', kind: 'boundaryEvent:timer', on: 'A', after: 'B', timer: 'PT1M' }]).message).toMatch(/"after" and "on" cannot be combined/);
    expect(failure([{ op: 'remove', ids: ['x'] }, { op: 'move', ids: ['a'], in: 'P', before: 'B' }]).message).toMatch(/^ops\[1\] \(move\): "before" and "in" cannot be combined/);
    // after + before is the allowed pair
    expect(parseOps([{ op: 'add', kind: 'task', after: 'A', before: 'B' }])).toHaveLength(1);
  });

  it('rejects flow options without a flow-creating placement and default + condition', () => {
    expect(failure([{ op: 'add', kind: 'task', in: 'P', flowName: 'x' }]).message).toMatch(/"flowName" describe the flow into the node and need "after", "before" or "flow"/);
    expect(failure([{ op: 'add', kind: 'task', condition: '${x}' }]).message).toMatch(/need "after", "before" or "flow"/);
    expect(failure([{ op: 'add', kind: 'task', after: 'A', condition: '${x}', default: true }]).message).toMatch(/"default" and "condition" are mutually exclusive/);
    expect(failure([{ op: 'connect', source: 'a', target: 'b', condition: '${x}', default: true }]).message).toMatch(/mutually exclusive/);
    expect(failure([{ op: 'move', ids: ['a'], lane: 'L', default: true }]).message).toMatch(/need "after", "before" or "flow"/);
    expect(failure([{ op: 'move', ids: ['a'] }]).message).toMatch(/nothing to do/);
  });

  it('validates kinds and trigger options early', () => {
    const e = failure([{ op: 'add', kind: 'usertask' }, { op: 'add', kind: 'userTsk' }]);
    expect(e.message).toMatch(/^ops\[1\] \(add\): Unknown kind "userTsk"/);
    expect(e.candidates).toContain('userTask');
    expect(failure([{ op: 'add', kind: 'complexGateway' }]).message).toMatch(/rejected/);
    expect(failure([{ op: 'add', kind: 'userTask:message' }]).message).toMatch(/not an event/);
    expect(failure([{ op: 'add', kind: 'userTask', timer: 'PT1M' }]).message).toMatch(/"timer" only apply to events, but "userTask" is a task/);
    expect(failure([{ op: 'retype', id: 'a', kind: 'serviceTask', message: 'M' }]).message).toMatch(/only apply to events/);
    expect(failure([{ op: 'split', after: 'a', kind: 'userTask', branches: [{ nodes: [] }] }]).message).toMatch(/"kind" must be a gateway kind, "userTask" is a task/);
  });

  it('validates the remaining per-op rules', () => {
    expect(failure([{ op: 'add', kind: 'task', ifAbsent: true }]).message).toMatch(/"ifAbsent" needs an explicit "id"/);
    expect(failure([{ op: 'set', id: 'a' }]).message).toMatch(/nothing to do/);
    expect(failure([{ op: 'set', id: 'a', values: {}, unset: [] }]).message).toMatch(/"unset" needs at least 1 entry/);
    expect(failure([{ op: 'ext', id: 'a', action: 'add' }]).message).toMatch(/ext add needs "type"/);
    expect(failure([{ op: 'ext', id: 'a', action: 'add', type: 't', index: 1 }]).message).toMatch(/"index" only applies to action "remove"/);
    expect(failure([{ op: 'ext', id: 'a', action: 'add', xml: '<x/>', body: 'b' }]).message).toMatch(/"xml" cannot be combined/);
    expect(failure([{ op: 'ext', id: 'a', action: 'remove' }]).message).toMatch(/exactly one of "type" or "index"/);
    expect(failure([{ op: 'ext', id: 'a', action: 'remove', type: 't', index: 0 }]).message).toMatch(/exactly one of "type" or "index"/);
    expect(failure([{ op: 'ext', id: 'a', action: 'remove', type: 't', replace: true }]).message).toMatch(/"replace" only apply to action "add"/);
    expect(failure([{ op: 'order', id: 'g', flows: [] }]).message).toMatch(/"flows" needs at least 1 entry/);
  });

  it('validates split branches and nodes with a nested path', () => {
    expect(failure([{ op: 'split', after: 'a' }]).message).toMatch(/missing required key "branches"/);
    expect(failure([{ op: 'split', after: 'a', branches: [] }]).message).toMatch(/"branches" needs at least 1 branch/);
    expect(failure([{ op: 'split', after: 'a', branches: 'x' }]).message).toMatch(/"branches" must be an array of branch objects/);
    expect(failure([{ op: 'split', after: 'a', branches: [{ nodes: [] }, { flowName: 'b' }] }]).message).toMatch(/^ops\[0\] \(split\) branches\[1\]: missing required key "nodes"/);
    expect(failure([{ op: 'split', after: 'a', branches: [{ nodes: [{ kind: 'task' }, { kind: 'task', after: 'x' }] }] }]).message).toMatch(
      /^ops\[0\] \(split\) branches\[0\].nodes\[1\]: unknown key "after"/,
    );
    const e = failure([{ op: 'remove', ids: ['x'] }, { op: 'split', after: 'a', branches: [{ nodes: [{ name: 'no kind' }] }] }]);
    expect(e.message).toMatch(/^ops\[1\] \(split\) branches\[0\].nodes\[0\]: missing required key "kind"/);
    expect(e.op).toBe(1);
    expect(failure([{ op: 'split', after: 'a', branches: [{ nodes: [{ kind: 'task', timer: 'PT1M' }] }] }]).message).toMatch(/nodes\[0\]: "timer" only apply to events/);
  });
});

describe('OPS_SCHEMA', () => {
  const defs = OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }>;

  it('is a draft 2020-12 schema with a definition per op, branch and node', () => {
    expect(OPS_SCHEMA['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    for (const name of [...OP_NAMES, 'branch', 'node', 'op']) expect(defs[name], name).toBeDefined();
  });

  it('lists exactly the keys the parser accepts, with op as a const', () => {
    for (const name of OP_NAMES) {
      const def = defs[name]!;
      expect(Object.keys(def.properties)).toEqual(['op', ...Object.keys(OP_FIELDS[name])]);
      expect(def.properties['op']).toEqual({ const: name });
      expect(def.additionalProperties).toBe(false);
      expect(def.required[0]).toBe('op');
    }
    expect(defs['add']!.required).toEqual(['op', 'kind']);
    expect(defs['split']!.required).toEqual(['op', 'after', 'branches']);
    expect(defs['ext']!.required).toEqual(['op', 'id', 'action']);
  });

  it('describes the example ops with known keys only', () => {
    for (const op of opsExample().ops) {
      const props = defs[op.op]!.properties;
      for (const key of Object.keys(op)) expect(props[key], `${op.op}.${key}`).toBeDefined();
    }
  });
});

describe('guide', () => {
  it('kindsJson has an entry for every kind, trigger, op and error', () => {
    const json = kindsJson();
    const kinds = json['kinds'] as Array<{ kind: string; aliases: string[]; prefix: string; description: string }>;
    expect(kinds.map((k) => k.kind)).toEqual(KINDS.map((k) => k.kind));
    for (const k of kinds) {
      expect(k.prefix).toBeTruthy();
      expect(k.description).toBeTruthy();
    }
    const triggers = json['triggers'] as Record<string, { kinds: string[]; option: string }>;
    expect(Object.keys(triggers)).toEqual(['none', 'message', 'timer', 'error', 'signal', 'escalation', 'conditional', 'link', 'compensate', 'terminate', 'cancel']);
    expect(triggers['timer']!.kinds).toContain('boundaryEvent');
    expect(triggers['terminate']!.kinds).toEqual(['endEvent']);
    expect(json['ops']).toBe(OPS_SCHEMA);
    expect(json['opsExample']).toEqual(opsExample());
    expect(json['errors']).toBe(ERROR_CATALOGUE);
    expect(Object.keys(json['exitCodes'] as object)).toEqual(['0', '1', '2', '3', '4', '5', '70']);
    expect(Array.isArray(json['setKeys'])).toBe(true);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('kindsText mentions every kind, alias, trigger option and error code', () => {
    const text = kindsText();
    for (const k of KINDS) {
      expect(text).toContain(k.kind);
      for (const a of k.aliases) expect(text).toContain(a);
    }
    for (const opt of ['--timer', '--message', '--error-code', '--signal', '--escalation-code', '--when', '--link', '--non-interrupting']) expect(text).toContain(opt);
    for (const opt of ['--after', '--before', '--flow', '--in', '--on', '--to']) expect(text).toContain(opt);
    for (const e of ERROR_CATALOGUE) expect(text).toContain(e.code);
  });

  it('guideText mentions every command with usage and an example', () => {
    const text = guideText();
    const names = ['new', 'show', 'find', 'add', 'connect', 'set', 'remove', 'retype', 'move', 'order', 'ext', 'apply', 'place', 'align', 'color', 'label', 'route', 'space', 'tidy', 'validate', 'layout', 'metrics', 'kinds', 'guide'];
    expect(COMMANDS.map((c) => c.name)).toEqual(names);
    for (const name of names) {
      expect(text).toContain(`bpmn ${name}`);
      expect(text).toContain(`$ bpmn ${name}`);
    }
    for (const opt of ['--json', '--out', '--dry-run', '--no-layout', '--force', '--backup', '--show', '--strict']) expect(text).toContain(opt);
    expect(text).toContain("'${");
    expect(text).toContain('"op": "split"');
    expect(text).toContain('70');
  });

  it('ERROR_CATALOGUE has unique codes and covers every code used under src/', () => {
    const codes = ERROR_CATALOGUE.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const e of ERROR_CATALOGUE) {
      expect(e.code).toMatch(/^[EW]_[A-Z][A-Z0-9_]*(\*)?$/);
      expect(e.meaning.length).toBeGreaterThan(10);
      expect(e.fix.length).toBeGreaterThan(10);
    }
    const missing = codesInSource().filter((c) => !codes.includes(c));
    expect(missing, `codes used in src/ but missing from ERROR_CATALOGUE: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('guide and README: documented syntax matches the CLI', () => {
  const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8');
  const texts: Record<string, string> = { guide: guideText(), kinds: kindsText(), README };
  const command = (name: string) => COMMANDS.find((c) => c.name === name)!;
  const catalogue = (code: string) => ERROR_CATALOGUE.find((e) => e.code === code)!;

  it('documents ext sub-command first (bpmn ext add|remove|list <file> <id> ...)', () => {
    for (const line of [command('ext').usage, ...command('ext').examples]) expect(line).toMatch(/^bpmn ext (add|remove|list) /);
    for (const [name, text] of Object.entries(texts)) {
      for (const m of text.matchAll(/bpmn ext (\S+) (\S+)/g)) {
        expect(['add', 'remove', 'list'], `${name}: ${m[0]}`).toContain(m[1]);
        expect(m[2], `${name}: ${m[0]}`).toMatch(/^(<file>|\w+\.bpmn)$/);
      }
    }
    expect(failure([{ op: 'ext', id: 'a', action: 'remove' }]).hint).toContain('`bpmn ext list <file> <id>`');
  });

  it('never tells the agent to run a `bpmn split` command', () => {
    for (const [name, text] of Object.entries(texts)) expect(text, name).not.toMatch(/bpmn split/);
    expect(catalogue('W_IMPLICIT_SPLIT').fix).toMatch(/`split` op in `bpmn apply`/);
    expect(guideText()).toMatch(/there is no split command/);
  });

  it('describes the layouter branch rule instead of "first flow on top"', () => {
    for (const [name, text] of Object.entries(texts)) expect(text, name).not.toMatch(/drawn on top/);
    expect(PLACEMENT_NOTES.join(' ')).toMatch(/default flow .* continues straight/);
    expect(command('order').summary).toMatch(/default flow/);
    expect(README).toMatch(/alternately below and above/);
  });

  it('keeps usages, options and the result description in sync with the CLI', () => {
    expect(command('validate').usage).toContain('[--strict]');
    expect(command('layout').summary).toMatch(/no --no-layout/);
    expect(COMMON_OPTIONS.find((o) => o.option === '--no-layout')!.description).toMatch(/pruned/);
    for (const key of ['written', 'importWarnings', 'written: <file>']) expect(guideText()).toContain(key);
    for (const key of ['"written": true', '"importWarnings": []']) expect(README).toContain(key);
    expect(README).toMatch(/`--target camunda7` the `camunda:` and `modeler:` namespaces/);
  });

  it('documents retype, event sub-processes, participants and scopes the way the ops behave', () => {
    expect(command('retype').summary).toMatch(/<kind>:none/);
    expect(command('retype').examples).toContain('bpmn retype order.bpmn Event_Start startEvent:none');
    expect(README).toMatch(/retype Event_X startEvent:none/);
    expect(catalogue('E_EVENT_SUBPROCESS_NO_START').fix).toMatch(/one `bpmn apply`/);
    expect(README).toMatch(/`eventSubProcess`.*one `bpmn apply`/);
    expect(catalogue('E_INVALID_SCOPE').meaning).not.toMatch(/collaboration/);
    const wrap = command('add').examples.findIndex((e) => e.includes('participant "Order handling"'));
    const blackBox = command('add').examples.findIndex((e) => e.includes('--black-box'));
    expect(wrap).toBeGreaterThanOrEqual(0);
    expect(blackBox).toBeGreaterThan(wrap);
    expect(README).toMatch(/\$ bpmn add order\.bpmn participant "Order handling"\n[\s\S]*\$ bpmn add order\.bpmn participant "Customer" --black-box/);
    expect(README).toMatch(/\| flow nodes \| `lane`.*`default`/);
  });

  it('README quick start shows exactly what `bpmn show` prints', async () => {
    const doc = Doc.create({ processName: 'Order handling' });
    const result = await mutateDoc(
      doc,
      [
        { op: 'add', kind: 'start', name: 'Order received' },
        { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'Event_OrderReceived' },
        { op: 'add', kind: 'end', name: 'Done', after: 'Activity_CheckInvoice' },
      ],
      { dryRun: true, layout: false, show: true },
    );
    const block = README.match(/\$ bpmn show order\.bpmn\n([\s\S]*?)\n```/)?.[1];
    expect(block).toBeDefined();
    expect(renderView(result.view!)).toBe(block);
  });
});
