/**
 * Reads the parts of an oxc syntax tree that more than one check needs.
 */
export class SyntaxTree {
  static walk(node, visit) {
    if (Array.isArray(node)) {
      node.forEach((child) => SyntaxTree.walk(child, visit));
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (typeof node.type === 'string') {
      visit(node);
    }
    Object.values(node).forEach((child) => SyntaxTree.walk(child, visit));
  }

  static classesIn(program) {
    const classes = [];
    SyntaxTree.walk(program, (node) => {
      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        classes.push(node);
      }
    });
    return classes;
  }

  static declarationOf(statement) {
    const exported = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration';
    return exported ? statement.declaration : statement;
  }
}
