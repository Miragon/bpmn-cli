/**
 * The layout of src/ (CONTRIBUTING.md, "How the package is laid out"),
 * checked with ArchUnitTS: three rings (domain, application, adapters) whose
 * imports point inwards only, and the entries in the root that wire them.
 * The error catalogue is the one source of truth for the E_/W_ codes src/ emits.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';
import { ERROR_CATALOGUE } from '../src/adapters/in/report/guide.js';

const SRC_DIR = join(__dirname, '..', 'src');

/** Codes the pipeline composes from the layout engine's codes (`E_${code}`, `W_LAYOUT_${code}`), keyed to the literal they are composed from. */
const COMPOSED_CODES: Record<string, string> = {
  E_LAYOUT_INCREMENTAL: 'LAYOUT_INCREMENTAL',
  W_LAYOUT_INCREMENTAL_FAILED: 'INCREMENTAL_FAILED',
};

function quotedLiteralsOutsideGuide(pattern: RegExp): Set<string> {
  const literals = new Set<string>();
  for (const entry of readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const file = join(entry.parentPath, entry.name);
    if (file.endsWith(join('report', 'guide.ts'))) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) literals.add(match[1]!);
  }
  return literals;
}

const covers = (entry: string, code: string) => (entry.endsWith('*') ? code.startsWith(entry.slice(0, -1)) : entry === code);

const sourceFiles = (readdirSync('src', { recursive: true }) as string[]).filter((relativePath) => relativePath.endsWith('.ts')).map((relativePath) => join('src', relativePath));

const ENTRIES = ['src/api.ts', 'src/cli.ts', 'src/index.ts', 'src/node.ts'];
const DOMAIN_MODULES = ['document', 'commands', 'diagram', 'editing', 'validation', 'views', 'batch'];
const ADAPTERS = ['in/cli', 'in/report', 'out/files', 'out/memory'];
/** adapter -> the adapters it may use: the CLI prints through the reports the library also returns */
const ADAPTER_USES: Record<string, string[]> = { 'in/cli': ['in/report'] };
/** the public API's classes (Doc, CliError, ChangeSet), constants and pure helpers on kinds, op names, metrics and conventions text */
const DOMAIN_VALUES_ENTRIES_REEXPORT = [
  'Doc', 'TARGETS', 'CliError', 'EXIT_CODES', 'ChangeSet', 'KINDS', 'parseKind', 'kindOf', 'kindLabel', 'FORMAT_OP_NAMES', 'isDiagramCommand', 'LAYOUT_MODES',
  'AROUND_DEFAULT_DEPTH', 'BPMNLINT_COVERS', 'BPMNLINT_VALIDATOR', 'renderConventions', 'ID_NAMING_RULE', 'PLATFORM_CHOICES', 'OPS_SCHEMA',
  'diffProblems', 'metricsDelta', 'KEYS', 'WEIGHTS', 'SWATCHES', 'RENDER_MAX_SIZE', 'MIN_LABEL_SCALE', 'HALO_COLORS',
];
const inFolder =(file: string, folder: string) => file.startsWith(join('src', folder) + sep);

/** Every import specifier of a source file, type-only imports included. */
function importsOf(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((match) => match[1]!);
}

async function expectNoDependency(from: string, to: string[]): Promise<void> {
  for (const target of to) {
    const dependency = projectFiles().inFolder(`src/${from}/**`).shouldNot().dependOnFiles();
    const rule = target.endsWith('.ts') ? dependency.inPath(target) : dependency.inFolder(`src/${target}/**`);
    await expect(rule, `${from} -> ${target}`).toPassAsync();
  }
}

/** domain module -> the domain modules it imports */
function domainModuleGraph(): Map<string, Set<string>> {
  const graph = new Map(DOMAIN_MODULES.map((module) => [module, new Set<string>()]));
  for (const file of sourceFiles) {
    const from = DOMAIN_MODULES.find((module) => inFolder(file, join('domain', module)));
    if (!from) continue;
    for (const specifier of importsOf(file).filter((imported) => imported.startsWith('.'))) {
      const target = join(file, '..', specifier);
      const to = DOMAIN_MODULES.find((module) => inFolder(target, join('domain', module)));
      if (to && to !== from) graph.get(from)!.add(to);
    }
  }
  return graph;
}

function cycleIn(graph: Map<string, Set<string>>): string[] | undefined {
  const visit = (node: string, path: string[]): string[] | undefined => {
    if (path.includes(node)) return [...path.slice(path.indexOf(node)), node];
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next, [...path, node]);
      if (cycle) return cycle;
    }
    return undefined;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node, []);
    if (cycle) return cycle;
  }
  return undefined;
}

describe('architecture', () => {
  it('the domain imports nothing from the application, the adapters or the entries', async () => {
    await expectNoDependency('domain', ['application', 'adapters', ...ENTRIES]);
  });

  it('the application imports nothing from the adapters or the entries', async () => {
    await expectNoDependency('application', ['adapters', ...ENTRIES]);
  });

  it('only the adapters and the entries import node builtins', () => {
    const allowed = (file: string) => ENTRIES.includes(file) || inFolder(file, 'adapters');
    const offenders = sourceFiles.filter((file) => !allowed(file) && importsOf(file).some((specifier) => specifier.startsWith('node:')));
    expect(offenders).toEqual([]);
  });

  it('an adapter imports no other adapter but the reports: the entries wire them', async () => {
    for (const adapter of ADAPTERS) {
      const forbidden = ADAPTERS.filter((other) => other !== adapter && !(ADAPTER_USES[adapter] ?? []).includes(other));
      await expectNoDependency(`adapters/${adapter}`, forbidden.map((other) => `adapters/${other}`));
    }
  });

  it('the domain modules import each other without a cycle', () => {
    expect(cycleIn(domainModuleGraph())).toBeUndefined();
  });

  it('only the entries import api.ts and index.ts', () => {
    const entryModules = ['src/api.ts', 'src/index.ts'].map((entry) => join(SRC_DIR, '..', entry));
    const offenders = sourceFiles
      .filter((file) => !ENTRIES.includes(file))
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith('.') && entryModules.includes(join(SRC_DIR, '..', file, '..', specifier).replace(/\.js$/, '.ts'))));
    expect(offenders).toEqual([]);
  });


  it('the entries reach the domain only through the use cases: from domain/ they import types and re-export only the public data and classes', () => {
    const valueNamesFromDomain = (entry: string, keyword: 'import' | 'export') =>
      [...readFileSync(entry, 'utf8').matchAll(new RegExp(`^${keyword}\\s+(type\\s+)?(?:\\{([^}]*)\\}|\\*|\\w+)\\s+from\\s+'([^']+)'`, 'gm'))]
        .filter((statement) => !statement[1] && inFolder(join(entry, '..', statement[3]!), 'domain'))
        .flatMap((statement) => (statement[2] ?? '*').split(',').map((specifier) => specifier.trim()).filter((specifier) => specifier && !specifier.startsWith('type ')).map((specifier) => specifier.split(/\s+as\s+/)[0]!));
    const entries = ENTRIES.filter((entry) => entry !== 'src/cli.ts');
    expect(entries.flatMap((entry) => valueNamesFromDomain(entry, 'import').map((name) => `${entry}: ${name}`))).toEqual([]);
    expect(entries.flatMap((entry) => valueNamesFromDomain(entry, 'export')).filter((name) => !DOMAIN_VALUES_ENTRIES_REEXPORT.includes(name))).toEqual([]);
  });

  it('application/ holds only the ports and the services that implement them', () => {
    const application = join('src', 'application');
    expect(sourceFiles.filter((file) => inFolder(file, 'application')).map((file) => file.slice(application.length + 1).split(sep)[0]).filter((part, index, all) => all.indexOf(part) === index).sort()).toEqual(['port', 'service']);
    const portsIn = sourceFiles.filter((file) => inFolder(file, join('application', 'port', 'in')));
    const portsOut = sourceFiles.filter((file) => inFolder(file, join('application', 'port', 'out')));
    expect(portsIn.filter((file) => !/(UseCase|DocumentSource)\.ts$/.test(file))).toEqual([]);
    expect(portsOut.filter((file) => !file.endsWith('Port.ts'))).toEqual([]);
  });

  it('every service of application/service implements its use case and calls no other service of it', () => {
    const services = sourceFiles.filter((file) => inFolder(file, join('application', 'service')));
    for (const file of services) {
      const useCase = file.split(sep).pop()!.replace('Service.ts', 'UseCase');
      expect(readFileSync(file, 'utf8'), file).toMatch(new RegExp(`implements ${useCase}\\b`));
      expect(existsSync(join('src', 'application', 'port', 'in', `${useCase}.ts`)), useCase).toBe(true);
    }
    expect(services.filter((file) => importsOf(file).some((specifier) => /Service\.js$/.test(specifier) && !specifier.includes('domain/')))).toEqual([]);
  });

  it('the driving adapters know the use cases only by their ports: the entries hand them the services', async () => {
    await expectNoDependency('adapters/in', ['application/service']);
  });

  it('the root of src/ holds only the entries', async () => {
    const rule = projectFiles().inFolder('src').should().haveName(/^(api|cli|index|node)\.ts$/);
    await expect(rule).toPassAsync();
  });

  it('only the kind definitions group gateway types by behaviour (the engine rule chunks load on demand and keep their own)', () => {
    const gatewayType = String.raw`'bpmn:(?:Exclusive|Inclusive|Parallel|Complex)Gateway'`;
    const groupedGatewayTypes = new RegExp(`${gatewayType}.*${gatewayType}`);
    const ownedElsewhere = (file: string) => file === join('src', 'domain', 'document', 'utils', 'kinds.ts') || file.startsWith(join('src', 'domain', 'validation', 'profiles'));
    const offenders = sourceFiles
      .filter((file) => !ownedElsewhere(file))
      .flatMap((file) => readFileSync(file, 'utf8').split('\n').map((line, lineIndex) => (groupedGatewayTypes.test(line) ? `${file}:${lineIndex + 1}` : undefined)))
      .filter(Boolean);
    expect(offenders).toEqual([]);
  });

  it('the error catalogue documents exactly the codes src/ emits', () => {
    const emitted = [...quotedLiteralsOutsideGuide(/'([EW]_[A-Z0-9_]+)'/g)];
    const catalogued = ERROR_CATALOGUE.map((entry) => entry.code);

    const undocumented = emitted.filter((code) => !catalogued.some((entry) => covers(entry, code)));
    expect(undocumented, 'emitted in src/ but missing from ERROR_CATALOGUE').toEqual([]);

    const sourceLiterals = quotedLiteralsOutsideGuide(/'([A-Z][A-Z0-9_]+)'/g);
    const composed = Object.entries(COMPOSED_CODES).filter(([, literal]) => sourceLiterals.has(literal)).map(([code]) => code);
    const dead = catalogued.filter((entry) => ![...emitted, ...composed].some((code) => covers(entry, code)));
    expect(dead, 'in ERROR_CATALOGUE but emitted nowhere in src/').toEqual([]);
  });

  it('only the modules owning group names and memberships touch a category value reference', () => {
    const owners = ['domain/document/utils/moddle.ts', 'domain/editing/ArtifactService.ts', 'domain/editing/ElementRemovalService.ts', 'domain/diagram/di/Groups.ts'];
    const touching = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.startsWith('domain/validation/profiles/'))
      .filter((file) => readFileSync(join('src', file), 'utf8').includes("'categoryValueRef'"));
    expect(touching.sort()).toEqual(owners.sort());
  });

  it('the CLI spells the command rules of domain/commands/utils/op-rules.ts with flags instead of restating them', () => {
    const cliFiles = [join('src', 'cli.ts'), ...sourceFiles.filter((file) => inFolder(file, join('adapters', 'in', 'cli')))];
    expect(cliFiles.length).toBeGreaterThan(1);
    for (const file of cliFiles) {
      const cli = readFileSync(file, 'utf8');
      for (const restatedRule of ['cannot be combined`', 'mutually exclusive', 'Use exactly one placement', 'Give at most one of']) expect(cli, file).not.toContain(restatedRule);
    }
  });
});
