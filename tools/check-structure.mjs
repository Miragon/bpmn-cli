import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseSync } from 'oxc-parser';

const ROOT = resolve(process.argv[2] ?? '.');
const MODULES = ['model', 'operations', 'edit', 'scoring', 'drawing', 'checks', 'views', 'write', 'api', 'cli'];
const BANNED_NAMES = new Set(['utils', 'helpers', 'common', 'shared', 'misc', 'types']);
const BANNED_CLASS_WORDS = new Set(['Util', 'Utils', 'Helper', 'Helpers', 'Manager', 'Service', 'Impl', 'Base']);
const CONTRACT_FUNCTIONS = new Set(['applyToXml', 'showXml', 'findXml', 'diagramXml', 'renderXml', 'validateXml', 'newXml', 'kindsJson']);
const CONTRACT_FILE = 'src/api/index.ts';
const CORE_TESTS_WITHOUT_MIRROR = new Set(['e2e', 'contract', 'corpus', 'repo', 'support']);
const RENDER_TESTS_WITHOUT_MIRROR = new Set(['golden']);
const TEST_SUPPORT = 'test/support';
const CONFIG_FILES = ['vitest.config.ts', '.dependency-cruiser.cjs'];
const COMMENT_FREE_FOLDERS = ['src', 'test', 'tools'];
const MAX_FILE_LINES = 300;
const MAX_PUBLIC_METHODS = 12;
const MAX_CONSTRUCTOR_PARAMETERS = 5;
const MAX_FOLDER_FILES = 12;
const MAX_FOLDERS_BELOW_MODULE = 2;

const violations = [];
let classCount = 0;

function report(path, message) {
  violations.push(`${path}: ${message}`);
}

function fromRoot(absolutePath) {
  return relative(ROOT, absolutePath).split(sep).join('/');
}

function allFiles(folder) {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder)
    .filter((name) => name !== 'node_modules')
    .flatMap((name) => {
      const path = join(folder, name);
      return statSync(path).isDirectory() ? allFiles(path) : [path];
    });
}

function allFolders(folder) {
  if (!existsSync(folder)) {
    return [];
  }
  const children = readdirSync(folder)
    .map((name) => join(folder, name))
    .filter((path) => statSync(path).isDirectory());
  return [folder, ...children.flatMap(allFolders)];
}

function isTypeScript(path) {
  return path.endsWith('.ts') && !path.endsWith('.d.ts');
}

function parse(path) {
  const parsed = parseSync(path, readFileSync(path, 'utf8'), { sourceType: 'module', lang: path.endsWith('.ts') ? 'ts' : 'js' });
  for (const error of parsed.errors) {
    report(fromRoot(path), `does not parse: ${error.message}`);
  }
  return parsed;
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  if (typeof node.type === 'string') {
    visit(node);
  }
  Object.values(node).forEach((child) => walk(child, visit));
}

function classesIn(program) {
  const classes = [];
  walk(program, (node) => {
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      classes.push(node);
    }
  });
  return classes;
}

function declarationOf(statement) {
  const exported = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration';
  return exported ? statement.declaration : statement;
}

function isFunctionValue(node) {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
}

function freeFunctionNames(statement) {
  const declaration = declarationOf(statement);
  if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'TSDeclareFunction') {
    return [declaration.id?.name ?? 'default'];
  }
  if (declaration?.type === 'VariableDeclaration') {
    return declaration.declarations.filter(({ init }) => isFunctionValue(init)).map(({ id }) => id.name);
  }
  return isFunctionValue(declaration) ? ['default'] : [];
}

function isReExport(statement) {
  if (statement.type === 'ExportAllDeclaration') {
    return true;
  }
  if (statement.type !== 'ExportNamedDeclaration' || statement.declaration) {
    return false;
  }
  return Boolean(statement.source) || statement.specifiers.length === 0;
}

function isContractFunction(statement) {
  const declaration = declarationOf(statement);
  return statement.type === 'ExportNamedDeclaration' && declaration?.type === 'FunctionDeclaration' && CONTRACT_FUNCTIONS.has(declaration.id.name);
}

function checkIndex(path, program) {
  const isContract = path === CONTRACT_FILE;
  for (const statement of program.body) {
    if (isReExport(statement) || (isContract && statement.type === 'ImportDeclaration')) {
      continue;
    }
    if (!isContract || !isContractFunction(statement)) {
      report(path, `an index.ts holds only re-exports${isContract ? ' and the 8 contract functions' : ''}, not ${statement.type}`);
      continue;
    }
    if (declarationOf(statement).body.body.length !== 1) {
      report(path, `${declarationOf(statement).id.name} is one line into a class`);
    }
  }
}

function memberName(member) {
  return member.key?.name ?? member.key?.value;
}

function isPublic(member) {
  return member.key?.type !== 'PrivateIdentifier' && member.accessibility !== 'private' && member.accessibility !== 'protected';
}

function isMethod(member) {
  return member.type === 'MethodDefinition' || member.type === 'TSAbstractMethodDefinition';
}

function isConstructor(member) {
  return isMethod(member) && member.kind === 'constructor';
}

function publicMethodNames(members) {
  const methods = members.filter((member) => isMethod(member) && !isConstructor(member) && isPublic(member));
  return new Set(methods.map((method) => `${method.static ? 'static ' : ''}${memberName(method)}`));
}

function constructorParameterCount(members) {
  const counts = members.filter(isConstructor).map((constructor) => constructor.value.params.length);
  return Math.max(0, ...counts);
}

function isStaticRecord(member) {
  return member.type === 'PropertyDefinition' && member.static && member.readonly;
}

function hasOnlyStaticMembers(members) {
  const named = members.filter((member) => !isConstructor(member) && member.type !== 'StaticBlock');
  return named.length > 0 && named.every((member) => member.static);
}

function classNameWords(name) {
  return name.split(/(?=[A-Z])/);
}

function checkClassShape(path, node) {
  const name = node.id?.name ?? 'an anonymous class';
  const members = node.body.body;
  const bannedWord = classNameWords(name).find((word) => BANNED_CLASS_WORDS.has(word));
  if (bannedWord) {
    report(path, `class ${name}: ${bannedWord} is a banned word in a class name`);
  }
  const publicMethods = publicMethodNames(members).size;
  if (publicMethods > MAX_PUBLIC_METHODS) {
    report(path, `class ${name} has ${publicMethods} public methods, at most ${MAX_PUBLIC_METHODS}`);
  }
  const constructorParameters = constructorParameterCount(members);
  if (constructorParameters > MAX_CONSTRUCTOR_PARAMETERS) {
    report(path, `class ${name} has ${constructorParameters} constructor parameters, at most ${MAX_CONSTRUCTOR_PARAMETERS}`);
  }
  if (hasOnlyStaticMembers(members) && !members.some(isStaticRecord)) {
    report(path, `class ${name} has only static members but no static readonly record, so it is no catalogue`);
  }
}

function checkClassFile(path, program) {
  const stem = basename(path, '.ts');
  const classes = classesIn(program);
  classCount += classes.length;
  if (classes.length !== 1) {
    report(path, `holds ${classes.length} classes, exactly one per file`);
  } else if (classes[0].id?.name !== stem) {
    report(path, `the class ${classes[0].id?.name ?? '(anonymous)'} is not named like its file`);
  }
  classes.forEach((node) => checkClassShape(path, node));
  for (const name of program.body.flatMap(freeFunctionNames)) {
    report(path, `free function ${name}: only the 8 of the contract are allowed`);
  }
}

function checkFileSize(path, text) {
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  if (lines > MAX_FILE_LINES) {
    report(path, `has ${lines} lines, at most ${MAX_FILE_LINES}`);
  }
}

function checkSourceFile(absolutePath) {
  const path = fromRoot(absolutePath);
  const { program } = parse(absolutePath);
  checkFileSize(path, readFileSync(absolutePath, 'utf8'));
  if (basename(path) === 'index.ts') {
    checkIndex(path, program);
  } else {
    checkClassFile(path, program);
  }
  return program;
}

function checkFolderNames(sourceRoot) {
  for (const folder of allFolders(sourceRoot).slice(1)) {
    if (BANNED_NAMES.has(basename(folder).toLowerCase())) {
      report(fromRoot(folder), `${basename(folder)} is a banned folder name`);
    }
  }
  for (const file of allFiles(sourceRoot)) {
    const stem = basename(file).split('.')[0];
    if (BANNED_NAMES.has(stem.toLowerCase())) {
      report(fromRoot(file), `${stem} is a banned file name`);
    }
  }
}

function checkFolderSizes(sourceRoot) {
  for (const folder of allFolders(sourceRoot)) {
    const files = readdirSync(folder).filter((name) => statSync(join(folder, name)).isFile());
    if (files.length > MAX_FOLDER_FILES) {
      report(fromRoot(folder), `holds ${files.length} files, at most ${MAX_FOLDER_FILES}`);
    }
  }
}

function checkFolderDepth(moduleRoot) {
  for (const folder of allFolders(moduleRoot)) {
    const depth = relative(moduleRoot, folder).split(sep).filter(Boolean).length;
    if (depth > MAX_FOLDERS_BELOW_MODULE) {
      report(fromRoot(folder), `sits ${depth} levels below its module, at most ${MAX_FOLDERS_BELOW_MODULE}`);
    }
  }
}

function checkCoreLayout() {
  const source = join(ROOT, 'src');
  for (const name of readdirSync(source)) {
    const isFolder = statSync(join(source, name)).isDirectory();
    if (isFolder && !MODULES.includes(name)) {
      report(`src/${name}`, 'is no module of docs/architecture.md');
    }
    if (!isFolder && name !== 'index.ts') {
      report(`src/${name}`, 'the root of src/ holds only index.ts');
    }
  }
  for (const module of MODULES) {
    if (!existsSync(join(source, module, 'index.ts'))) {
      report(`src/${module}`, 'has no index.ts');
    }
  }
}

function hasDescribeOf(program, className) {
  return program.body.some(({ type, expression }) => {
    const isDescribe = type === 'ExpressionStatement' && expression.type === 'CallExpression' && expression.callee.name === 'describe';
    return isDescribe && expression.arguments[0]?.value === className;
  });
}

function checkMirrorOf(sourceRoot, testRoot, sourceFile) {
  const className = basename(sourceFile, '.ts');
  const expected = join(testRoot, relative(sourceRoot, sourceFile).replace(/\.ts$/, '.test.ts'));
  if (!existsSync(expected)) {
    report(fromRoot(sourceFile), `class ${className} has no mirrored test ${fromRoot(expected)}`);
    return;
  }
  if (!hasDescribeOf(parse(expected).program, className)) {
    report(fromRoot(expected), `has no describe('${className}')`);
  }
}

function isValueImport(node) {
  if (node.type === 'ImportExpression') {
    return true;
  }
  if (node.importKind === 'type' || node.exportKind === 'type') {
    return false;
  }
  const specifiers = node.specifiers ?? [];
  return specifiers.length === 0 || specifiers.some((specifier) => specifier.importKind !== 'type' && specifier.exportKind !== 'type');
}

function importedPaths(program) {
  const imports = [];
  walk(program, (node) => {
    const isImport = ['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type);
    if (isImport && typeof node.source?.value === 'string' && isValueImport(node)) {
      imports.push(node.source.value);
    }
  });
  return imports;
}

function foreignModuleOf(testFile, specifier, ownModule) {
  if (specifier.startsWith('@miragon/bpmn-render') || specifier.startsWith('@miragon/bpmn-lint')) {
    return specifier;
  }
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const [root, module] = fromRoot(resolve(dirname(testFile), specifier)).split('/');
  return root === 'src' && module !== ownModule ? module : undefined;
}

function checkMirroredTestImports(testFile, program) {
  const ownModule = fromRoot(testFile).split('/')[1];
  for (const specifier of importedPaths(program)) {
    const foreign = foreignModuleOf(testFile, specifier, ownModule);
    if (foreign) {
      report(fromRoot(testFile), `imports a value of ${foreign}: another module is reached only through test/support/`);
    }
  }
}

function checkTestFile(sourceRoot, testRoot, testFile) {
  const path = fromRoot(testFile);
  if (!path.endsWith('.test.ts')) {
    report(path, 'a mirrored folder holds only tests; helpers sit in test/support/');
    return;
  }
  const sourceFile = join(sourceRoot, relative(testRoot, testFile).replace(/\.test\.ts$/, '.ts'));
  if (!existsSync(sourceFile) || basename(sourceFile) === 'index.ts') {
    report(path, `test without its class ${fromRoot(sourceFile)}`);
  }
  if (testRoot === join(ROOT, 'test')) {
    checkMirroredTestImports(testFile, parse(testFile).program);
  }
}

function checkPart({ sourceRoot, testRoot, testsWithoutMirror, moduleRoots }) {
  const sourceFiles = allFiles(sourceRoot).filter(isTypeScript);
  checkFolderNames(sourceRoot);
  checkFolderSizes(sourceRoot);
  moduleRoots.forEach(checkFolderDepth);
  sourceFiles.forEach(checkSourceFile);
  for (const sourceFile of sourceFiles.filter((file) => basename(file) !== 'index.ts')) {
    checkMirrorOf(sourceRoot, testRoot, sourceFile);
  }
  const mirroredTests = allFiles(testRoot).filter(isTypeScript);
  for (const testFile of mirroredTests) {
    const [topFolder] = relative(testRoot, testFile).split(sep);
    if (!testsWithoutMirror.has(topFolder)) {
      checkTestFile(sourceRoot, testRoot, testFile);
    }
  }
}

function checkTestSupportSize() {
  const files = allFiles(join(ROOT, TEST_SUPPORT));
  if (files.length > MAX_FOLDER_FILES) {
    report(TEST_SUPPORT, `holds ${files.length} files, at most ${MAX_FOLDER_FILES}`);
  }
}

function commentFreeFiles(packageRoots) {
  const folders = [...COMMENT_FREE_FOLDERS.map((folder) => join(ROOT, folder)), ...packageRoots];
  const code = folders.flatMap(allFiles).filter((path) => isTypeScript(path) || path.endsWith('.mjs'));
  const configs = CONFIG_FILES.map((name) => join(ROOT, name)).filter(existsSync);
  return [...code, ...configs];
}

function checkComments(packageRoots) {
  for (const file of commentFreeFiles(packageRoots)) {
    const { comments } = parse(file);
    if (comments.length > 0) {
      const line = readFileSync(file, 'utf8').slice(0, comments[0].start).split('\n').length;
      report(`${fromRoot(file)}:${line}`, `holds ${comments.length} comment(s); names carry the meaning`);
    }
  }
}

function packageRoots() {
  const packages = join(ROOT, 'packages');
  return existsSync(packages) ? readdirSync(packages).map((name) => join(packages, name)).filter((path) => statSync(path).isDirectory()) : [];
}

function partOfPackage(packageRoot) {
  const sourceRoot = join(packageRoot, 'src');
  const isRender = basename(packageRoot) === 'render';
  return { sourceRoot, testRoot: join(packageRoot, 'test'), testsWithoutMirror: isRender ? RENDER_TESTS_WITHOUT_MIRROR : new Set(), moduleRoots: [sourceRoot] };
}

function partOfCore() {
  const sourceRoot = join(ROOT, 'src');
  const moduleRoots = MODULES.map((module) => join(sourceRoot, module));
  return { sourceRoot, testRoot: join(ROOT, 'test'), testsWithoutMirror: CORE_TESTS_WITHOUT_MIRROR, moduleRoots };
}

checkCoreLayout();
const packages = packageRoots();
[partOfCore(), ...packages.map(partOfPackage)].forEach(checkPart);
checkTestSupportSize();
checkComments(packages);

for (const violation of [...new Set(violations)]) {
  console.error(violation);
}
if (violations.length > 0) {
  console.error(`structure: ${new Set(violations).size} violation(s)`);
  process.exit(1);
}
console.log(`structure: ${classCount} classes, 0 violations`);
