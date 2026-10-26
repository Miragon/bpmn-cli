import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPS_SCHEMA } from '../src/domain/commands/OpsSchemaBuilder.js';
import { OP_FIELDS, opsExample } from '../src/domain/commands/utils/op-fields.js';
import { parseOps } from '../src/index.js';
import { Doc } from '../src/domain/document/Doc.js';
import { isCliError } from '../src/domain/document/utils/errors.js';
import { renderView, guideShort, guideText, kindsJson, kindsSectionText, kindsText } from '../src/index.js';
import { Cli } from '../src/adapters/in/cli/Cli.js';
import { FILE_USE_CASES } from './helpers.js';
import { COMMANDS, COMMON_OPTIONS } from '../src/adapters/in/report/CommandCatalogue.js';
import { ERROR_CATALOGUE, PLACEMENT_NOTES } from '../src/adapters/in/report/guide.js';
import { MAX_ID, MAX_SLUG } from '../src/domain/document/utils/slug.js';
import { KINDS } from '../src/domain/document/utils/kinds.js';
import { OP_NAMES } from '../src/domain/commands/utils/op-names.js';
import type { EditCommand } from '../src/domain/commands/types.js';
import { mutateDoc } from '../src/index.js';

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

const GUIDE_TEXT_FILES = ['report/guide.ts', 'report/CommandCatalogue.ts', 'report/AgentGuide.ts', 'report/KindsReference.ts'];

/**
 * Every E_/W_ code mentioned anywhere under src/ (code strings and contract
 * comments) but the guide's text, which documents them (and families such as
 * W_C7_DEPLOY_*) instead of emitting them. A prefix used as a template (`W_LAYOUT_${code}`)
 * is reported as the family `W_LAYOUT_*`.
 */
function codesInSource(): string[] {
  const codes = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    if (GUIDE_TEXT_FILES.some((guide) => file.endsWith(guide))) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/\b[EW]_[A-Z][A-Z0-9_]*\b/g)) codes.add(match[0].endsWith('_') ? `${match[0]}*` : match[0]);
  }
  return [...codes].sort();
}

/**
 * Every `bpmn <command> <arguments>` in backticks in `text` whose first
 * argument, the second for ext, is not the file: `<file>`, a *.bpmn name,
 * `-` (stdin) or `${quoted}` (MutationCommand withFile puts the file's name in). A
 * command named without arguments or with an option first (`bpmn ext add`,
 * `bpmn layout --tidy`, `bpmn validate --platform c7`) is a name, not a
 * command to paste.
 */
function commandsWithoutFile(text: string): string[] {
  const out: string[] = [];
  for (const [command, cmd, rest] of text.matchAll(/`bpmn ([a-z]+) ([^`]+)`/g)) {
    if (cmd === 'kinds' || cmd === 'guide' || cmd === 'help') continue;
    const first = rest!.split(' ').slice(cmd === 'ext' ? 1 : 0)[0];
    if (!first || (first.startsWith('-') && first !== '-')) continue;
    if (!['<file>', '-', '${quoted}'].includes(first) && !first.endsWith('.bpmn')) out.push(command);
  }
  return out;
}

/** Resolves the escapes of a string or template piece (`\n`, `\x41`, `\u{1F600}`, a line continuation, `\'`). */
function cooked(raw: string): string {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (unused, escape: string) => {
    if (escape[0] === 'u' || escape[0] === 'x') return String.fromCodePoint(parseInt(escape.replace(/[ux{}]/g, ''), 16));
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '', '\r\n': '', '\u2028': '', '\u2029': '' };
    return simple[escape] ?? escape;
  });
}

/** Words after which a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/**
 * The string literals and templates of TypeScript source as the program
 * sees them (escapes resolved, comments and regular expressions left out).
 * A template keeps its backticks, so one that is a command itself (`bpmn
 * space ${quoted}`) is checked too; its substitutions read `${name}` for a
 * plain name or property and `${…}` for anything else (a nested template is
 * checked on its own). A small scanner, not TypeScript's compiler API: that
 * API moves between majors (typescript 7 no longer exports it).
 */
function stringsIn(src: string): string[] {
  const out: string[] = [];
  let index = 0;
  // false after a value (a name, a number, a string, `)`, `]`, `}`): a `/` there divides
  let regexAllowed = true;
  /** Scans from `i` to the end, or (`inSubstitution`) to the `}` that closes a template's `${`, and returns its index. */
  const scan = (inSubstitution: boolean): number => {
    let depth = 0;
    while (index < src.length) {
      const character = src[index]!;
      const next = src[index + 1];
      if (character === '/' && next === '/') {
        const end = src.indexOf('\n', index);
        index = end === -1 ? src.length : end;
      } else if (character === '/' && next === '*') {
        const end = src.indexOf('*/', index + 2);
        index = end === -1 ? src.length : end + 2;
      } else if (character === "'" || character === '"') {
        let cursor = index + 1;
        while (cursor < src.length && src[cursor] !== character && src[cursor] !== '\n') cursor += src[cursor] === '\\' ? 2 : 1;
        out.push(cooked(src.slice(index + 1, cursor)));
        index = cursor + 1;
        regexAllowed = false;
      } else if (character === '`') {
        out.push(template());
        regexAllowed = false;
      } else if (character === '/' && regexAllowed) {
        let cursor = index + 1;
        let inClass = false;
        while (cursor < src.length && src[cursor] !== '\n' && (inClass || src[cursor] !== '/')) {
          if (src[cursor] === '\\') cursor++;
          else if (src[cursor] === '[') inClass = true;
          else if (src[cursor] === ']') inClass = false;
          cursor++;
        }
        index = cursor + 1;
        while (index < src.length && /[a-z]/.test(src[index]!)) index++;
        regexAllowed = false;
      } else if (/[A-Za-z_$#]/.test(character)) {
        const word = /^[#\w$]+/.exec(src.slice(index, index + 64))![0];
        index += word.length;
        regexAllowed = BEFORE_REGEX.has(word);
      } else if (/[0-9]/.test(character)) {
        index += /^[\w.]+/.exec(src.slice(index, index + 64))![0].length;
        regexAllowed = false;
      } else if (/\s/.test(character)) {
        index++;
      } else {
        if (character === '{') depth++;
        else if (character === '}') {
          if (depth === 0 && inSubstitution) return index;
          depth--;
        }
        regexAllowed = !')]}'.includes(character);
        index++;
      }
    }
    return index;
  };
  /** Reads the template at `i` (a backtick) up to its closing backtick. */
  const template = (): string => {
    let text = '`';
    let raw = '';
    index++;
    while (index < src.length && src[index] !== '`') {
      if (src[index] === '\\') {
        raw += src.slice(index, index + 2);
        index += 2;
      } else if (src[index] === '$' && src[index + 1] === '{') {
        text += cooked(raw);
        raw = '';
        index += 2;
        const start = index;
        regexAllowed = true;
        const end = scan(true);
        const expr = src.slice(start, end).trim();
        text += `\${${/^[\w.]+$/.test(expr) ? expr : '…'}}`;
        index = end + 1;
      } else {
        raw += src[index];
        index++;
      }
    }
    index++;
    return `${text}${cooked(raw)}\``;
  };
  scan(false);
  return out;
}

function stringsInSource(file: string): string[] {
  return stringsIn(readFileSync(file, 'utf8'));
}

describe('parseOps: shapes', () => {
  it('accepts the example and returns typed ops in order', () => {
    const example = opsExample();
    const ops = parseOps(example);
    expect(ops.map((operation) => operation.op)).toEqual(['split', 'add', 'add', 'add', 'connect', 'set', 'ext', 'ext']);
    expect(ops).toEqual(example.ops);
  });

  it('accepts a bare array and an object with $schema', () => {
    const op = { op: 'remove', ids: ['Task_A'] };
    expect(parseOps([op])).toEqual([op]);
    expect(parseOps({ $schema: 'x', ops: [op] })).toEqual([op]);
  });

  it('accepts every op shape with all of its keys', () => {
    const full: EditCommand[] = [
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
      { op: 'space', after: 'Task_A', by: '-column' },
      { op: 'space', below: 'Lane_1', by: -80 },
      { op: 'compact', ids: ['Participant_1', 'Lane_1'] },
      { op: 'color', ids: ['Task_A'], path: ['Start', 'End'], via: ['F1'], kind: 'endEvent', branch: 'F2', color: 'green' },
      { op: 'place', branch: 'F2', below: 'Task_B' },
      { op: 'align', kind: 'endEvent', axis: 'column' },
      { op: 'tidy', path: ['Start', 'End'] },
      { op: 'order', id: 'Collaboration_1', pools: ['Participant_2', 'Participant_1'] },
      { op: 'compact' },
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
    const used = new Set(full.map((operation) => operation.op));
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
    const error = failure([{ op: 'add', kind: 'task' }, { op: 'addd', kind: 'task' }]);
    expect(error.message).toMatch(/^ops\[1\]: unknown op "addd" \(did you mean "add"\?\)/);
    expect(error.op).toBe(1);
    expect(error.candidates).toEqual(['add']);
    expect(failure([{ kind: 'task' }]).message).toMatch(/^ops\[0\]: missing "op"; one of: add, connect/);
    expect(failure(['add']).message).toMatch(/^ops\[0\]: expected an op object, got string/);
  });

  it('rejects unknown keys with the allowed keys and a spelling hint', () => {
    const error = failure([{ op: 'remove', ids: ['a'] }, { op: 'add', kind: 'task', 'flow-name': 'x' }]);
    expect(error.message).toMatch(/^ops\[1\] \(add\): unknown key "flow-name" \(did you mean "flowName"\?\); allowed keys: kind, name, id, as, flowAs, outAs, refAs, after/);
    expect(error.op).toBe(1);
    expect(failure([{ op: 'connect', source: 'a', target: 'b', ifabsent: true }]).message).toMatch(/did you mean "ifAbsent"/);
    expect(failure([{ op: 'order', id: 'g', flows: ['f'], after: 'x' }]).message).toMatch(/^ops\[0\] \(order\): unknown key "after"; allowed keys: id, flows, lanes, pools$/);
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
    const error = failure([{ op: 'add', kind: 'usertask' }, { op: 'add', kind: 'userTsk' }]);
    expect(error.message).toMatch(/^ops\[1\] \(add\): Unknown kind "userTsk"/);
    expect(error.candidates).toContain('userTask');
    expect(failure([{ op: 'add', kind: 'choreographyTask' }]).message).toMatch(/rejected/);
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
    const error = failure([{ op: 'remove', ids: ['x'] }, { op: 'split', after: 'a', branches: [{ nodes: [{ name: 'no kind' }] }] }]);
    expect(error.message).toMatch(/^ops\[1\] \(split\) branches\[0\].nodes\[0\]: missing required key "kind"/);
    expect(error.op).toBe(1);
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
    expect(kinds.map((kind) => kind.kind)).toEqual(KINDS.map((kind) => kind.kind));
    for (const kind of kinds) {
      expect(kind.prefix).toBeTruthy();
      expect(kind.description).toBeTruthy();
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
    for (const kind of KINDS) {
      expect(text).toContain(kind.kind);
      for (const alias of kind.aliases) expect(text).toContain(alias);
    }
    for (const opt of ['--timer', '--message', '--error-code', '--signal', '--escalation-code', '--when', '--link', '--non-interrupting']) expect(text).toContain(opt);
    for (const opt of ['--after', '--before', '--flow', '--in', '--on', '--to']) expect(text).toContain(opt);
    for (const entry of ERROR_CATALOGUE) expect(text).toContain(entry.code);
  });

  it('the guide lists every command commander registers, and no other', () => {
    const registered = new Cli('test', FILE_USE_CASES).program.commands.map((registeredCommand) => registeredCommand.name());
    expect([...COMMANDS.map((commandSpec) => commandSpec.name)].sort()).toEqual([...registered].sort());
  });

  it('guideText mentions every command with usage and an example', () => {
    const text = guideText();
    const names = COMMANDS.map((commandSpec) => commandSpec.name);
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
    const codes = ERROR_CATALOGUE.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const entry of ERROR_CATALOGUE) {
      expect(entry.code).toMatch(/^[EW]_[A-Z][A-Z0-9_]*(\*)?$/);
      expect(entry.meaning.length).toBeGreaterThan(10);
      expect(entry.fix.length).toBeGreaterThan(10);
    }
    const missing = codesInSource().filter((code) => !codes.includes(code));
    expect(missing, `codes used in src/ but missing from ERROR_CATALOGUE: ${missing.join(', ')}`).toEqual([]);
  });

  it('every command the catalogue and the strings under src/ name with arguments names the file first', () => {
    const problems = ERROR_CATALOGUE.flatMap((entry) => commandsWithoutFile(`${entry.meaning} ${entry.fix}`).map((command) => `${entry.code}: ${command}`));
    for (const file of sourceFiles(SRC_DIR)) {
      // the strings only: comments describe commands, hints and notes reach the user
      for (const text of stringsInSource(file)) problems.push(...commandsWithoutFile(text).map((command) => `${file.slice(SRC_DIR.length + 1)}: ${command}`));
    }
    // the scanner: strings and templates with their escapes and substitutions, no comment, no regular expression
    expect(stringsIn("// 'no'\nconst a = 'it\\'s' + \"x\\ty\" + `bpmn set ${quoted} ${f(`in`)}` /* `no` */ / 2;\nconst r = /['`]/g.test(a) ? `\\u0041` : '';")).toEqual([
      "it's",
      'x\ty',
      '`in`',
      '`bpmn set ${quoted} ${…}`',
      '`A`',
      '',
    ]);
    // the rule itself: an option first is a name, stdin is a file, a command without the file is found
    expect(commandsWithoutFile('`bpmn layout --engine auto` `bpmn validate --platform c7` `bpmn set - x=1` `bpmn help add`')).toEqual([]);
    expect(commandsWithoutFile("`bpmn move <id> --in <scope>` `bpmn set <id> 'a=b'`")).toEqual(['`bpmn move <id> --in <scope>`', "`bpmn set <id> 'a=b'`"]);
    expect(problems).toEqual([]);
  });
});

describe('guide, README and docs: documented syntax matches the CLI', () => {
  const repoFile = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
  const README = repoFile('README.md');
  const DOCS = ['commands', 'reference', 'ops', 'layout', 'contract', 'camunda', 'walkthrough'].map((name) => repoFile(`docs/${name}.md`)).join('\n');
  const texts: Record<string, string> = { guide: guideText(), kinds: kindsText(), README, DOCS };
  const command = (name: string) => COMMANDS.find((commandSpec) => commandSpec.name === name)!;
  const catalogue = (code: string) => ERROR_CATALOGUE.find((entry) => entry.code === code)!;

  it('documents ext sub-command first (bpmn ext add|remove|list <file> <id> ...)', () => {
    for (const line of [command('ext').usage, ...command('ext').examples]) expect(line).toMatch(/^bpmn ext (add|remove|list) /);
    for (const [name, text] of Object.entries(texts)) {
      for (const match of text.matchAll(/bpmn ext (\S+) (\S+)/g)) {
        expect(['add', 'remove', 'list'], `${name}: ${match[0]}`).toContain(match[1]);
        expect(match[2], `${name}: ${match[0]}`).toMatch(/^(<file>|\w+\.bpmn)$/);
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
    expect(DOCS).toMatch(/alternately below and above/);
  });

  it('documents keeping flow ids wherever renames are described (--keep-flow-ids, BPMN_KEEP_FLOW_IDS, W_FLOW_ID_STALE)', () => {
    const keep = COMMON_OPTIONS.find((option) => option.option === '--keep-flow-ids')!;
    expect(keep.description).toMatch(/W_FLOW_ID_STALE[\s\S]*BPMN_KEEP_FLOW_IDS=1/);
    expect(COMMON_OPTIONS.map((option) => option.option)).toContain('--no-keep-flow-ids');
    for (const [name, text] of Object.entries({ guide: guideText(), DOCS, library: repoFile('docs/library.md') })) {
      for (const word of ['--keep-flow-ids', 'W_FLOW_ID_STALE']) expect(text, `${name}: ${word}`).toContain(word);
    }
    expect(DOCS).toContain('BPMN_KEEP_FLOW_IDS=1');
    expect(guideShort()).toContain('--keep-flow-ids');
    expect(catalogue('W_FLOW_ID_STALE').fix).toContain('`bpmn set <file> <flowId> id=<newId>`');
    // the first variable that can fail a command: the code an agent looks up names it
    expect(catalogue('E_USAGE').meaning).toContain('BPMN_KEEP_FLOW_IDS');
    expect(DOCS).not.toMatch(/the CLI has no switch/);
    // a batch keeps the ids of the flows it does not remove; a move puts the node's out-flow back; outAs names a splice's new flow
    for (const [name, text] of Object.entries({ guide: guideText(), ops: repoFile('docs/ops.md') })) {
      expect(text, name).not.toMatch(/every flow the file had keeps its id/);
      expect(text, name).toMatch(/unless an op\s+removes it/);
      expect(text, name).toMatch(/move`? puts the moved\s+node's\s+out-flow back/);
      expect(text, name).toMatch(/"outAs"`?\s+the\s+(new\s+)?flow\s+(the\s+splice\s+creates\s+\(new\s+)?node -> old\s+successor/);
      expect(text, name).not.toMatch(/has no alias/);
    }
    // the skill's pre-approved permission covers `bpmn ...`, not an inline variable in front of it
    expect(repoFile('plugins/bpmn-cli/skills/bpmn/SKILL.md')).toMatch(/--keep-flow-ids[\s\S]*BPMN_KEEP_FLOW_IDS[\s\S]*not pre-approved/);
    // a result whose flow ids the variable kept says so (src/adapters/in/cli/MutationCommand.ts keptByEnvNote): the reader may not see the variable
    for (const [name, text] of Object.entries({ guide: guideText(), DOCS, skill: repoFile('plugins/bpmn-cli/skills/bpmn/SKILL.md') })) {
      expect(text, name).toContain('`note: flow ids kept: BPMN_KEEP_FLOW_IDS=1 (');
    }
  });

  it('keeps usages, options and the result description in sync with the CLI', () => {
    expect(command('validate').usage).toContain('[--strict]');
    expect(command('layout').summary).toMatch(/no --no-layout/);
    expect(COMMON_OPTIONS.find((option) => option.option === '--no-layout')!.description).toMatch(/pruned/);
    for (const key of ['written', 'importWarnings', 'written: <file>']) expect(guideText()).toContain(key);
    for (const key of ['"written": true', '"importWarnings": []']) expect(DOCS).toContain(key);
    expect(DOCS).toMatch(/`--target camunda7` the `camunda:` and `modeler:` namespaces/);
  });

  it('documents retype, event sub-processes, participants and scopes the way the ops behave', () => {
    expect(command('retype').summary).toMatch(/<kind>:none/);
    expect(command('retype').examples).toContain('bpmn retype order.bpmn Event_Start startEvent:none');
    expect(DOCS).toMatch(/retype Event_X startEvent:none/);
    expect(catalogue('E_EVENT_SUBPROCESS_NO_START').fix).toMatch(/one `bpmn apply`/);
    expect(DOCS).toMatch(/`eventSubProcess`.*one `bpmn apply`/);
    expect(catalogue('E_INVALID_SCOPE').meaning).not.toMatch(/collaboration/);
    const wrap = command('add').examples.findIndex((example) => example.includes('participant "Order handling"'));
    const blackBox = command('add').examples.findIndex((example) => example.includes('--black-box'));
    expect(wrap).toBeGreaterThanOrEqual(0);
    expect(blackBox).toBeGreaterThan(wrap);
    expect(DOCS).toMatch(/\$ bpmn add order\.bpmn participant "Order handling"\n[\s\S]*\$ bpmn add order\.bpmn participant "Customer" --black-box/);
    expect(DOCS).toMatch(/\| flow nodes \| `lane`.*`default`/);
  });

  it('states the id length cap the way ids are cut: a name\'s 40 characters, whole words, a suffix included (#31)', () => {
    expect(DOCS).toMatch(new RegExp(`at most ${MAX_SLUG} characters\\s+of them: a longer name loses its last words, and a single longer word is cut at ${MAX_SLUG}\\.`));
    expect(DOCS).toMatch(new RegExp(`An id has at\\s+most ${MAX_ID} characters, a collision suffix included\\. An id within that is not cut again\\. A longer one\\s+loses whole words`));
    expect(DOCS).toMatch(/A word is cut inside only when no whole word is left to give up/);
    expect(guideText()).toMatch(/at most 64 characters, cut at whole words/);
    expect(kindsSectionText(['ids'])).toMatch(/a name gives at most 40 characters of words \(a single longer word is cut at 40\), and an id within 64 is not cut again; a longer one loses whole words/);
    expect(kindsSectionText(['ids'])).toMatch(/a word is cut inside only when no whole word is left to give up/);
    expect(kindsSectionText(['ids'])).toMatch(/of the cuts that fit, the one with the most words, then the most characters/);
    expect(DOCS).toMatch(/of the cuts that fit, the one\s+with the most words is taken, then the longest/);
    // a number a cut leaves goes only where it reads like a collision suffix; a long prefix gives way in every flow form where the ends do not fit
    expect(DOCS).toMatch(/a number a cut would leave at the end of the id goes too where it would read\s+like a collision suffix/);
    expect(kindsSectionText(['ids'])).toMatch(/a number left at the end of the id goes too where it reads like a collision suffix/);
    expect(kindsSectionText(['ids'])).toMatch(/a flow prefix or scope that leaves a flow's ends fewer than 16 stays where the ends fit beside it at whole words, else a named flow with Flow_/);
    for (const [name, text] of Object.entries(texts)) expect(text, name).not.toMatch(/cut at a word\b|an id that fits is never cut/);
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
