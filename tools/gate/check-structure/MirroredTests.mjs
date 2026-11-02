import { existsSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

/**
 * Every class has its test at the same path under test/, so a reader finds it without searching and a class without one stands out.
 */
export class MirroredTests {
  constructor(tree) {
    this.tree = tree;
  }

  run() {
    const problems = this.tree.parts().flatMap((part) => [...this.#classesWithoutTest(part), ...this.#testsWithoutClass(part)]);
    return { problems, summary: 'every class tested' };
  }

  #classesWithoutTest({ sourceRoot, testRoot }) {
    return this.tree
      .typeScriptFiles(sourceRoot)
      .filter((file) => basename(file) !== 'index.ts')
      .map((file) => [file, join(testRoot, relative(sourceRoot, file).replace(/\.ts$/, '.test.ts'))])
      .filter(([, expected]) => !existsSync(expected))
      .map(([file, expected]) => `${this.tree.fromRoot(file)}: class ${basename(file, '.ts')} has no mirrored test ${this.tree.fromRoot(expected)}`);
  }

  #testsWithoutClass({ sourceRoot, testRoot, testsWithoutMirror }) {
    const mirrored = this.tree.typeScriptFiles(testRoot).filter((file) => !testsWithoutMirror.has(relative(testRoot, file).split(sep)[0]));
    return mirrored.flatMap((file) => {
      const path = this.tree.fromRoot(file);
      if (!path.endsWith('.test.ts')) {
        return [`${path}: a mirrored folder holds only tests; helpers sit in test/support/`];
      }
      const sourceFile = join(sourceRoot, relative(testRoot, file).replace(/\.test\.ts$/, '.ts'));
      const hasClass = existsSync(sourceFile) && basename(sourceFile) !== 'index.ts';
      return hasClass ? [] : [`${path}: test without its class ${this.tree.fromRoot(sourceFile)}`];
    });
  }
}
