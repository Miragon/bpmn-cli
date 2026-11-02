import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlantedRepo } from './PlantedRepo.js';

const RENDER_MANIFEST = JSON.stringify({
  name: '@miragon/bpmn-render',
  exports: { '.': './src/index.ts', './png': { node: './src/png/node/index.ts', default: './src/png/index.ts' }, './text': './src/text/index.ts' },
});
const LINT_MANIFEST = JSON.stringify({ name: '@miragon/bpmn-lint', exports: { '.': './src/index.ts' } });

let repo: PlantedRepo;

beforeEach(() => {
  repo = new PlantedRepo();
  repo.plantInstalledPackages();
  repo.plant('packages/render/package.json', RENDER_MANIFEST);
  repo.plant('packages/lint/package.json', LINT_MANIFEST);
  repo.plant('packages/render/src/text/index.ts', 'export {};\n');
  repo.plant('packages/render/src/png/index.ts', 'export {};\n');
  repo.plant('packages/render/src/png/node/index.ts', 'export {};\n');
  repo.plant('test/support/Fixtures.ts', 'export {};\n');
});

afterEach(() => {
  repo.remove();
});

describe('the import rules', () => {
  it('passes the empty skeleton', () => {
    expect(repo.cruise().status).toBe(0);
  });

  it.each([
    ['a module through the index of a lower layer', 'src/edit/index.ts', "export * from '../model/index.js';\n"],
    ['drawing to scoring and render text', 'src/drawing/index.ts', "export * from '../scoring/index.js';\nexport * from '@miragon/bpmn-render/text';\n"],
    ['scoring to model and render text', 'src/scoring/index.ts', "export * from '../model/index.js';\nexport * from '@miragon/bpmn-render/text';\n"],
    ['views to render', 'src/views/index.ts', "export * from '@miragon/bpmn-render';\n"],
    ['cli to api, lint and png', 'src/cli/index.ts', "export * from '../api/index.js';\nexport * from '@miragon/bpmn-lint';\nexport * from '@miragon/bpmn-render/png';\nexport * from 'commander';\n"],
    ['a Node builtin in cli', 'src/cli/index.ts', "import 'node:fs';\n"],
    ['a Node builtin in the png node entry', 'packages/render/src/png/node/index.ts', "import 'node:fs';\n"],
    ['the plugin root in cli/files during the interim', 'src/cli/files/Reader.ts', "import '@miragon/bpmnlint-plugin-rules';\n"],
    ['bpmnlint in lint', 'packages/lint/src/index.ts', "import 'bpmnlint';\n"],
    ['a type of another module in a core test', 'test/edit/Move.test.ts', "import type { Point } from '../../src/model/Point.js';\nexport type Input = Point;\n"],
    ['a value through test/support in a core test', 'test/edit/Move.test.ts', "import '../support/Fixtures.js';\n"],
    ['a type of the module root in a subfolder', 'src/model/ids/Id.ts', "import type { Point } from '../Point.js';\nexport type Id = Point;\n"],
  ])('allows %s', (_name, path, source) => {
    repo.plant('src/model/Point.ts', 'export class Point {}\n');
    repo.plant(path, source);
    const { status, output } = repo.cruise();
    expect(output).not.toContain('error');
    expect(status).toBe(0);
  });

  it.each([
    ['an upward import', 'src/model/index.ts', "export * from '../write/index.js';\n", 'layer-model'],
    ['an import inside a layer', 'src/edit/index.ts', "export * from '../drawing/index.js';\n", 'layer-edit'],
    ['an import past an index.ts', 'src/edit/index.ts', "export * from '../model/document/Doc.js';\n", 'module-entry-only'],
    ['a value of the module root in a subfolder', 'src/model/ids/Id.ts', "import { Point } from '../Point.js';\nexport const a = Point;\n", 'subfolder-imports-no-value-of-module-root'],
    ['cli past api', 'src/cli/index.ts', "export * from '../views/index.js';\n", 'cli-imports-only-api-lint-and-png'],
    ['cli importing another package', 'src/cli/index.ts', "import 'zod';\n", 'cli-imports-only-commander-and-the-plugin'],
    ['scoring importing operations', 'src/scoring/index.ts', "export * from '../operations/index.js';\n", 'scoring-imports-only-model-and-text'],
    ['scoring importing render', 'src/scoring/index.ts', "export * from '@miragon/bpmn-render';\n", 'scoring-imports-only-model-and-text'],
    ['edit importing scoring', 'src/edit/index.ts', "export * from '../scoring/index.js';\n", 'scoring-imported-only-by-drawing-write-and-views'],
    ['checks structure importing camunda', 'src/checks/structure/Rule.ts', "import '../camunda/Rule.js';\n", 'checks-structure-imports-no-camunda'],
    ['a package importing the core', 'packages/lint/src/index.ts', "export * from '../../../src/model/index.js';\n", 'package-imports-no-core'],
    ['a package importing a package', 'packages/lint/src/index.ts', "export * from '@miragon/bpmn-render';\n", 'package-imports-no-other-package'],
    ['a package test leaving its package', 'packages/lint/test/Lint.test.ts', "import '../../../src/model/index.js';\n", 'package-test-stays-in-its-package'],
    ['a value of another module in a core test', 'test/edit/Move.test.ts', "import '../../src/model/Point.js';\n", 'core-test-reaches-other-modules-through-support'],
    ['a package value in a core test', 'test/edit/Move.test.ts', "import '@miragon/bpmn-render/text';\n", 'core-test-reaches-other-modules-through-support'],
    ['lint imported by write', 'src/write/index.ts', "export * from '@miragon/bpmn-lint';\n", 'lint-imported-only-by-cli'],
    ['render internals', 'src/views/index.ts', "export * from '../../packages/render/src/paint/Painter.js';\n", 'core-reaches-packages-through-their-entries'],
    ['render root in drawing', 'src/drawing/index.ts', "export * from '@miragon/bpmn-render';\n", 'render-root-imported-only-by-views'],
    ['render text in views', 'src/views/index.ts', "export * from '@miragon/bpmn-render/text';\n", 'render-text-imported-only-by-drawing-and-scoring'],
    ['render png in views', 'src/views/index.ts', "export * from '@miragon/bpmn-render/png';\n", 'render-png-imported-only-by-cli'],
    ['a Node builtin in model', 'src/model/index.ts', "import 'node:fs';\n", 'node-builtins-only-in-cli-lint-and-the-png-node-entry'],
    ['a Node builtin in render', 'packages/render/src/index.ts', "import 'node:fs';\n", 'node-builtins-only-in-cli-lint-and-the-png-node-entry'],
    ['bpmnlint in model', 'src/model/index.ts', "import 'bpmnlint';\n", 'bpmnlint-loads-only-in-lint'],
    ['the plugin in checks', 'src/checks/index.ts', "import '@miragon/bpmnlint-plugin-rules';\n", 'bpmnlint-loads-only-in-lint'],
    ['bpmnlint in cli/files', 'src/cli/files/Reader.ts', "import 'bpmnlint';\n", 'cli-files-loads-only-the-plugin-root'],
    ['the plugin in cli outside files', 'src/cli/index.ts', "import '@miragon/bpmnlint-plugin-rules';\n", 'cli-outside-files-loads-no-plugin'],
    ['an import that resolves to nothing', 'src/model/index.ts', "export * from './Missing.js';\n", 'no-unresolvable'],
  ])('fails on %s', (_name, path, source, rule) => {
    repo.plant('src/model/document/Doc.ts', 'export class Doc {}\n');
    repo.plant('src/model/Point.ts', 'export class Point {}\n');
    repo.plant('src/checks/camunda/Rule.ts', 'export class Rule {}\n');
    repo.plant('packages/render/src/paint/Painter.ts', 'export class Painter {}\n');
    repo.plant(path, source);
    const { status, output } = repo.cruise();
    expect(output).toContain(rule);
    expect(status).not.toBe(0);
  });

  it('fails on a cycle of type imports', () => {
    repo.plant('src/model/A.ts', "import type { B } from './B.js';\nexport class A {\n  b?: B;\n}\n");
    repo.plant('src/model/B.ts', "import type { A } from './A.js';\nexport class B {\n  a?: A;\n}\n");
    const { status, output } = repo.cruise();
    expect(output).toContain('no-cycle');
    expect(status).not.toBe(0);
  });
});
