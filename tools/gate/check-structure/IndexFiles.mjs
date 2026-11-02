import { basename } from 'node:path';
import { SyntaxTree } from './SyntaxTree.mjs';

const CONTRACT_FILE = 'src/api/index.ts';
const CONTRACT_FUNCTIONS = new Set(['applyToXml', 'showXml', 'findXml', 'diagramXml', 'renderXml', 'validateXml', 'newXml', 'kindsJson']);

/**
 * An index.ts only names what a folder offers; logic in it hides from the one-class-per-file rule.
 * The contract in src/api/index.ts is the one exception: eight functions, each one line into a class.
 */
export class IndexFiles {
  constructor(tree) {
    this.tree = tree;
  }

  run() {
    const indexFiles = this.tree
      .parts()
      .flatMap(({ sourceRoot }) => this.tree.typeScriptFiles(sourceRoot))
      .filter((file) => basename(file) === 'index.ts');
    const problems = indexFiles.flatMap((file) => this.#problemsOf(this.tree.fromRoot(file), this.tree.program(file)));
    return { problems, summary: `${indexFiles.length} index files` };
  }

  #problemsOf(path, program) {
    const isContract = path === CONTRACT_FILE;
    const problems = [];
    for (const statement of program.body) {
      if (IndexFiles.#isReExport(statement) || (isContract && statement.type === 'ImportDeclaration')) {
        continue;
      }
      if (!isContract || !IndexFiles.#isContractFunction(statement)) {
        problems.push(`${path}: an index.ts holds only re-exports${isContract ? ' and the 8 contract functions' : ''}, not ${statement.type}`);
        continue;
      }
      const declaration = SyntaxTree.declarationOf(statement);
      if (declaration.body.body.length !== 1) {
        problems.push(`${path}: ${declaration.id.name} is one line into a class`);
      }
    }
    return problems;
  }

  static #isReExport(statement) {
    if (statement.type === 'ExportAllDeclaration') {
      return true;
    }
    if (statement.type !== 'ExportNamedDeclaration' || statement.declaration) {
      return false;
    }
    return Boolean(statement.source) || statement.specifiers.length === 0;
  }

  static #isContractFunction(statement) {
    const declaration = SyntaxTree.declarationOf(statement);
    return statement.type === 'ExportNamedDeclaration' && declaration?.type === 'FunctionDeclaration' && CONTRACT_FUNCTIONS.has(declaration.id.name);
  }
}
