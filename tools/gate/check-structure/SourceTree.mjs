import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { parseSync } from 'oxc-parser';

const CORE_TESTS_WITHOUT_MIRROR = new Set(['e2e', 'contract', 'fixtures', 'repo', 'support']);
const RENDER_TESTS_WITHOUT_MIRROR = new Set(['golden']);

/**
 * The files every structure check reads: the core and each package, parsed once.
 */
export class SourceTree {
  static MODULES = ['model', 'operations', 'edit', 'scoring', 'drawing', 'checks', 'views', 'write', 'api', 'cli'];

  #programs = new Map();

  constructor(root) {
    this.root = root;
  }

  fromRoot(absolutePath) {
    return relative(this.root, absolutePath).split(sep).join('/');
  }

  files(folder) {
    if (!existsSync(folder)) {
      return [];
    }
    return readdirSync(folder)
      .filter((name) => name !== 'node_modules')
      .flatMap((name) => {
        const path = join(folder, name);
        return statSync(path).isDirectory() ? this.files(path) : [path];
      });
  }

  folders(folder) {
    if (!existsSync(folder)) {
      return [];
    }
    const children = readdirSync(folder)
      .map((name) => join(folder, name))
      .filter((path) => statSync(path).isDirectory());
    return [folder, ...children.flatMap((child) => this.folders(child))];
  }

  typeScriptFiles(folder) {
    return this.files(folder).filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'));
  }

  program(path) {
    if (!this.#programs.has(path)) {
      this.#programs.set(path, parseSync(path, readFileSync(path, 'utf8'), { sourceType: 'module', lang: 'ts' }).program);
    }
    return this.#programs.get(path);
  }

  parts() {
    const coreSource = join(this.root, 'src');
    const core = {
      sourceRoot: coreSource,
      testRoot: join(this.root, 'test'),
      testsWithoutMirror: CORE_TESTS_WITHOUT_MIRROR,
      moduleRoots: SourceTree.MODULES.map((module) => join(coreSource, module)),
    };
    return [core, ...this.#packageRoots().map((packageRoot) => this.#partOfPackage(packageRoot))];
  }

  #packageRoots() {
    const packages = join(this.root, 'packages');
    if (!existsSync(packages)) {
      return [];
    }
    return readdirSync(packages)
      .map((name) => join(packages, name))
      .filter((path) => statSync(path).isDirectory());
  }

  #partOfPackage(packageRoot) {
    const sourceRoot = join(packageRoot, 'src');
    const testsWithoutMirror = basename(packageRoot) === 'render' ? RENDER_TESTS_WITHOUT_MIRROR : new Set();
    return { sourceRoot, testRoot: join(packageRoot, 'test'), testsWithoutMirror, moduleRoots: [sourceRoot] };
  }
}
