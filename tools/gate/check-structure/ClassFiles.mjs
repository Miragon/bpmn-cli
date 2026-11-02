import { basename } from 'node:path';
import { SyntaxTree } from './SyntaxTree.mjs';

/**
 * One class per file, named like the file, and no free functions: the file name alone tells where a behaviour lives.
 */
export class ClassFiles {
  constructor(tree) {
    this.tree = tree;
  }

  run() {
    let classCount = 0;
    const problems = [];
    for (const file of this.#classFiles()) {
      const path = this.tree.fromRoot(file);
      const program = this.tree.program(file);
      const classes = SyntaxTree.classesIn(program);
      classCount += classes.length;
      if (classes.length !== 1) {
        problems.push(`${path}: holds ${classes.length} classes, exactly one per file`);
      } else if (classes[0].id?.name !== basename(file, '.ts')) {
        problems.push(`${path}: the class ${classes[0].id?.name ?? '(anonymous)'} is not named like its file`);
      }
      for (const name of program.body.flatMap(ClassFiles.#freeFunctionNames)) {
        problems.push(`${path}: free function ${name}: only the 8 of the contract are allowed`);
      }
    }
    return { problems, summary: `${classCount} classes` };
  }

  #classFiles() {
    return this.tree
      .parts()
      .flatMap(({ sourceRoot }) => this.tree.typeScriptFiles(sourceRoot))
      .filter((file) => basename(file) !== 'index.ts');
  }

  static #freeFunctionNames(statement) {
    const declaration = SyntaxTree.declarationOf(statement);
    if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'TSDeclareFunction') {
      return [declaration.id?.name ?? 'default'];
    }
    if (declaration?.type === 'VariableDeclaration') {
      return declaration.declarations.filter(({ init }) => ClassFiles.#isFunctionValue(init)).map(({ id }) => id.name);
    }
    return ClassFiles.#isFunctionValue(declaration) ? ['default'] : [];
  }

  static #isFunctionValue(node) {
    return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
  }
}
