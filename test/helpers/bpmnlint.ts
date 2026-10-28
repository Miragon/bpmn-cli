import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { applyToXml, newXml } from '../../src/api.js';
import type { ValidatorIssue } from '../../src/domain/validation/validators.js';

export const ROOT = join(import.meta.dirname, '..', '..');
export const fixture = (path: string): string => readFileSync(join(ROOT, 'test', 'fixtures', path), 'utf8');

export let top: string;
beforeAll(() => {
  top = mkdtempSync(join(tmpdir(), 'bpmn-lint-'));
});
afterAll(() => rmSync(top, { recursive: true, force: true }));

let repos = 0;
/** A repository (a .git directory) with a .bpmnlintrc (text, or an object written as JSON; undefined: none) and files. */
export function repo(rc: unknown, files: Record<string, string> = {}, parent = top): string {
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
export function plugin(dir: string, name: string, def: { version?: string; configs?: Record<string, unknown>; rules?: Record<string, string>; main?: string }): string {
  const pkg = join(dir, 'node_modules', name);
  mkdirSync(join(pkg, 'rules'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version: def.version ?? '1.2.0', main: 'index.js' }));
  writeFileSync(join(pkg, 'index.js'), def.main ?? `module.exports = { configs: ${JSON.stringify(def.configs ?? {})} };`);
  for (const [rule, source] of Object.entries(def.rules ?? {})) writeFileSync(join(pkg, 'rules', `${rule}.js`), source);
  return pkg;
}

/** A model made with the in-memory API (a new file: every node lists its flows). */
export async function model(ops: unknown[], name = 'Order'): Promise<string> {
  return (await applyToXml((await newXml({ processName: name })).xml, ops)).xml;
}

/** start "Received" -> userTask "Check" -> end "Done" in Process_Order. */
export const LINE = [
  { op: 'add', kind: 'start', name: 'Received' },
  { op: 'add', kind: 'userTask', name: 'Check', after: 'Event_Received' },
  { op: 'add', kind: 'end', name: 'Done', after: 'Activity_Check' },
];

/** A moddle descriptor BpmnModdle takes, and fails on when it parses any file: a property that redefines one bpmn has not. */
export const REDEFINES_NOTHING = { name: 'X', prefix: 'x', uri: 'http://example.org/x', types: [{ name: 'A', extends: ['bpmn:BaseElement'], properties: [{ name: 'id', type: 'String', redefines: 'bpmn:Nope#x' }] }] };

/** The same XML without the incoming / outgoing lists (a generated or hand-written model). */
export const listless = (xml: string): string => xml.replace(/\s*<bpmn:(incoming|outgoing)>[^<]*<\/bpmn:\1>/g, '');

export const lintOf = (issues: readonly unknown[]): ValidatorIssue[] => (issues as ValidatorIssue[]).filter((warning) => warning.validator === 'bpmnlint');
export const codes = (issues: readonly unknown[]): string[] => (issues as Array<{ code: string; element?: string }>).map((warning) => `${warning.code}${warning.element ? ` ${warning.element}` : ''}`);

/** A code example as written in the docs, without line breaks, indentation, comment markers or trailing commas. */
export const codeOf = (text: string): string => text.replace(/\/\/|\s+/g, '').replace(/,(?=[)\]}])/g, '');
