import { basename } from 'node:path';
import { SyntaxTree } from './SyntaxTree.mjs';

const BANNED_CLASS_WORDS = new Set(['Util', 'Utils', 'Helper', 'Helpers', 'Manager', 'Service', 'Impl', 'Base']);
const MAX_PUBLIC_METHODS = 12;
const MAX_CONSTRUCTOR_PARAMETERS = 5;

/**
 * A class with a vague name, a wide surface or many collaborators has more than one job and wants a split.
 */
export class ClassShape {
  constructor(tree) {
    this.tree = tree;
  }

  run() {
    const files = this.tree
      .parts()
      .flatMap(({ sourceRoot }) => this.tree.typeScriptFiles(sourceRoot))
      .filter((file) => basename(file) !== 'index.ts');
    const problems = files.flatMap((file) =>
      SyntaxTree.classesIn(this.tree.program(file)).flatMap((node) => ClassShape.#problemsOf(node).map((problem) => `${this.tree.fromRoot(file)}: ${problem}`)),
    );
    return { problems, summary: `classes of at most ${MAX_PUBLIC_METHODS} public methods` };
  }

  static #problemsOf(node) {
    const name = node.id?.name ?? 'an anonymous class';
    const members = node.body.body;
    const problems = [];
    const bannedWord = name.split(/(?=[A-Z])/).find((word) => BANNED_CLASS_WORDS.has(word));
    if (bannedWord) {
      problems.push(`class ${name}: ${bannedWord} is a banned word in a class name`);
    }
    const publicMethods = ClassShape.#publicMethodCount(members);
    if (publicMethods > MAX_PUBLIC_METHODS) {
      problems.push(`class ${name} has ${publicMethods} public methods, at most ${MAX_PUBLIC_METHODS}`);
    }
    const constructorParameters = Math.max(0, ...members.filter(ClassShape.#isConstructor).map((constructor) => constructor.value.params.length));
    if (constructorParameters > MAX_CONSTRUCTOR_PARAMETERS) {
      problems.push(`class ${name} has ${constructorParameters} constructor parameters, at most ${MAX_CONSTRUCTOR_PARAMETERS}`);
    }
    if (ClassShape.#hasOnlyStaticMembers(members) && !members.some(ClassShape.#isStaticRecord)) {
      problems.push(`class ${name} has only static members but no static readonly record, so it is no catalogue`);
    }
    return problems;
  }

  static #publicMethodCount(members) {
    const methods = members.filter((member) => ClassShape.#isMethod(member) && !ClassShape.#isConstructor(member) && ClassShape.#isPublic(member));
    return new Set(methods.map((method) => `${method.static ? 'static ' : ''}${method.key?.name ?? method.key?.value}`)).size;
  }

  static #isPublic(member) {
    return member.key?.type !== 'PrivateIdentifier' && member.accessibility !== 'private' && member.accessibility !== 'protected';
  }

  static #isMethod(member) {
    return member.type === 'MethodDefinition' || member.type === 'TSAbstractMethodDefinition';
  }

  static #isConstructor(member) {
    return ClassShape.#isMethod(member) && member.kind === 'constructor';
  }

  static #isStaticRecord(member) {
    return member.type === 'PropertyDefinition' && member.static && member.readonly;
  }

  static #hasOnlyStaticMembers(members) {
    const named = members.filter((member) => !ClassShape.#isConstructor(member) && member.type !== 'StaticBlock');
    return named.length > 0 && named.every((member) => member.static);
  }
}
