import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlantedRepo } from './PlantedRepo.js';

const CLASS = 'export class Point {\n  x(): number {\n    return 1;\n  }\n}\n';
const POINT_TEST = "import { describe, it } from 'vitest';\ndescribe('Point', () => {\n  it('holds', () => {});\n});\n";

const methods = (count: number) => Array.from({ length: count }, (_, index) => `  method${index}(): void {\n    return;\n  }\n`).join('');

let repo: PlantedRepo;

beforeEach(() => {
  repo = new PlantedRepo();
});

afterEach(() => {
  repo.remove();
});

function plantAll(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    repo.plant(path, content);
  }
}

describe('the structure check', () => {
  it('passes the empty skeleton', () => {
    expect(repo.checkStructure().status).toBe(0);
  });

  it('passes a class with its mirrored test', () => {
    plantAll({ 'src/model/Point.ts': CLASS, 'test/model/Point.test.ts': POINT_TEST });
    expect(repo.checkStructure()).toMatchObject({ status: 0, output: expect.stringContaining('1 classes') });
  });

  it('passes a catalogue, a private helper and a URL in a string', () => {
    plantAll({
      'src/model/Kinds.ts':
        "export class Kinds {\n  static readonly TASK = { url: 'https://example.org/*x*/' };\n  static all(): string[] {\n    return Kinds.prefixed();\n  }\n  private static prefixed(): string[] {\n    return [Kinds.TASK.url];\n  }\n}\n",
      'test/model/Kinds.test.ts': POINT_TEST.replace('Point', 'Kinds'),
    });
    expect(repo.checkStructure().status).toBe(0);
  });

  it('does not take the word class in a string for a class', () => {
    plantAll({
      'src/model/Point.ts': `const LABEL = 'class Fake {}';\n${CLASS.replace('return 1', 'return LABEL.length')}`,
      'test/model/Point.test.ts': POINT_TEST,
    });
    expect(repo.checkStructure().status).toBe(0);
  });

  it('passes a type import of another module and a value through test/support/', () => {
    plantAll({
      'src/model/Point.ts': CLASS,
      'src/edit/Move.ts': CLASS.replaceAll('Point', 'Move'),
      'test/edit/Move.test.ts': `import type { Point } from '../../src/model/Point.js';\nimport { Fixtures } from '../support/Fixtures.js';\nexport type Input = Point;\nconsole.log(Fixtures);\n${POINT_TEST.replace('Point', 'Move')}`,
      'test/model/Point.test.ts': POINT_TEST,
      'test/support/Fixtures.ts': "export { Point as Fixtures } from '../../src/model/Point.js';\n",
    });
    expect(repo.checkStructure().status).toBe(0);
  });

  it.each([
    ['a utils file', { 'src/model/utils.ts': 'export const a = 1;\n' }, 'utils is a banned file name'],
    ['a utils folder', { 'src/model/utils/Point.ts': CLASS }, 'utils is a banned folder name'],
    ['a free function', { 'src/model/Point.ts': `${CLASS}export function distance(): number {\n  return 0;\n}\n`, 'test/model/Point.test.ts': POINT_TEST }, 'free function distance'],
    ['a free arrow function', { 'src/model/Point.ts': `const distance = () => 0;\n${CLASS.replace('return 1', 'return distance()')}`, 'test/model/Point.test.ts': POINT_TEST }, 'free function distance'],
    ['a class with no test', { 'src/model/Point.ts': CLASS }, 'class Point has no mirrored test test/model/Point.test.ts'],
    ['a test whose describe names no class', { 'src/model/Point.ts': CLASS, 'test/model/Point.test.ts': POINT_TEST.replace('Point', 'Dot') }, "has no describe('Point')"],
    ['a test without its class', { 'test/model/Point.test.ts': POINT_TEST }, 'test without its class src/model/Point.ts'],
    ['a helper in a mirrored folder', { 'test/model/builder.ts': 'export const a = 1;\n' }, 'a mirrored folder holds only tests'],
    ['a file with no class', { 'src/model/Point.ts': 'export const a = 1;\n', 'test/model/Point.test.ts': POINT_TEST }, 'holds 0 classes'],
    ['a file with two classes', { 'src/model/Point.ts': `${CLASS}class Other {}\n`, 'test/model/Point.test.ts': POINT_TEST }, 'holds 2 classes'],
    ['a class hidden in an expression', { 'src/model/Point.ts': `${CLASS}export const other = new (class {})();\n`, 'test/model/Point.test.ts': POINT_TEST }, 'holds 2 classes'],
    ['a class not named like its file', { 'src/model/Dot.ts': CLASS, 'test/model/Dot.test.ts': POINT_TEST.replace('Point', 'Dot') }, 'is not named like its file'],
    ['a file over 300 lines', { 'src/model/Point.ts': `${CLASS}${'\n'.repeat(300)}`, 'test/model/Point.test.ts': POINT_TEST }, 'at most 300'],
    ['13 public methods', { 'src/model/Point.ts': `export class Point {\n${methods(13)}}\n`, 'test/model/Point.test.ts': POINT_TEST }, 'has 13 public methods'],
    ['6 constructor parameters', { 'src/model/Point.ts': 'export class Point {\n  constructor(a: 1, b: 2, c: 3, d: 4, e: 5, f: 6) {\n    console.log(a, b, c, d, e, f);\n  }\n}\n', 'test/model/Point.test.ts': POINT_TEST }, 'has 6 constructor parameters'],
    ['only static methods', { 'src/model/Point.ts': 'export class Point {\n  static x(): number {\n    return 1;\n  }\n}\n', 'test/model/Point.test.ts': POINT_TEST }, 'no catalogue'],
    ['a banned class word', { 'src/model/PointManager.ts': CLASS.replace('Point', 'PointManager'), 'test/model/PointManager.test.ts': POINT_TEST.replace('Point', 'PointManager') }, 'Manager is a banned word'],
    ['a value of another module', { 'src/model/Point.ts': CLASS, 'src/edit/Move.ts': CLASS.replaceAll('Point', 'Move'), 'test/model/Point.test.ts': POINT_TEST, 'test/edit/Move.test.ts': `import { Point } from '../../src/model/Point.js';\nconsole.log(Point);\n${POINT_TEST.replace('Point', 'Move')}` }, 'imports a value of model'],
    ['a package value in a mirrored test', { 'src/edit/Move.ts': CLASS.replaceAll('Point', 'Move'), 'test/edit/Move.test.ts': `import '@miragon/bpmn-render/text';\n${POINT_TEST.replace('Point', 'Move')}` }, 'imports a value of @miragon/bpmn-render/text'],
    ['a line comment', { 'src/model/index.ts': '// why\nexport {};\n' }, 'holds 1 comment'],
    ['a block comment in a test', { 'test/repo/a.test.ts': '/* why */\nexport {};\n' }, 'holds 1 comment'],
    ['a comment in a tool', { 'tools/a.mjs': 'const a = 1; // why\nconsole.log(a);\n' }, 'holds 1 comment'],
    ['a comment in a package', { 'packages/lint/src/index.ts': '/** why */\nexport {};\n' }, 'holds 1 comment'],
    ['13 files in a folder', Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`src/model/geometry/a${index}.json`, '{}\n'])), 'holds 13 files'],
    ['three levels below a module', { 'src/drawing/full/lanes/deep/Lane.ts': CLASS.replace('Point', 'Lane'), 'test/drawing/full/lanes/deep/Lane.test.ts': POINT_TEST.replace('Point', 'Lane') }, 'sits 3 levels below'],
    ['three levels below a package', { 'packages/render/src/a/b/c/Lane.ts': CLASS.replace('Point', 'Lane'), 'packages/render/test/a/b/c/Lane.test.ts': POINT_TEST.replace('Point', 'Lane') }, 'sits 3 levels below'],
    ['code in an index.ts', { 'src/model/index.ts': 'export const a = 1;\n' }, 'holds only re-exports'],
    ['a ninth function in api', { 'src/api/index.ts': 'export function layoutXml(): void {\n  return;\n}\n' }, 'holds only re-exports and the 8 contract functions'],
    ['logic in a contract function', { 'src/api/index.ts': 'export function newXml(): string {\n  const a = 1;\n  return String(a);\n}\n' }, 'newXml is one line into a class'],
    ['a module the plan lacks', { 'src/extra/index.ts': 'export {};\n' }, 'is no module of the plan'],
    ['a file in the root of src/', { 'src/cli.ts': 'export {};\n' }, 'the root of src/ holds only index.ts'],
    ['a class of a package with no test', { 'packages/render/src/text/TextMetrics.ts': CLASS.replace('Point', 'TextMetrics') }, 'class TextMetrics has no mirrored test packages/render/test/text/TextMetrics.test.ts'],
  ] as [string, Record<string, string>, string][])('fails on %s', (_name, files, expected) => {
    plantAll(files);
    const { status, output } = repo.checkStructure();
    expect(output).toContain(expected);
    expect(status).toBe(1);
  });

  it('accepts render golden tests that mirror no class', () => {
    plantAll({ 'packages/render/test/golden/shapes.test.ts': "import { it } from 'vitest';\nit('draws', () => {});\n" });
    expect(repo.checkStructure().status).toBe(0);
  });
});
