import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES = ['model', 'operations', 'edit', 'scoring', 'drawing', 'checks', 'views', 'write', 'api', 'cli'];

export interface ToolRun {
  status: number | null;
  output: string;
}

export class PlantedRepo {
  private readonly root = mkdtempSync(join(tmpdir(), 'bpmn-planted-'));

  constructor() {
    this.plant('src/index.ts', "export * from './api/index.js';\n");
    for (const module of MODULES) {
      this.plant(`src/${module}/index.ts`, 'export {};\n');
    }
    this.plant('packages/render/src/index.ts', 'export {};\n');
    this.plant('packages/lint/src/index.ts', 'export {};\n');
    this.plant('tsconfig.json', JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } }));
  }

  plantInstalledPackages(): void {
    for (const name of ['bpmnlint', 'commander', 'zod']) {
      this.plant(`node_modules/${name}/package.json`, JSON.stringify({ name, main: 'index.js' }));
      this.plant(`node_modules/${name}/index.js`, 'export {};\n');
    }
    const plugin = 'node_modules/@miragon/bpmnlint-plugin-rules';
    this.plant(`${plugin}/package.json`, JSON.stringify({ exports: { '.': './dist/index.js' } }));
    this.plant(`${plugin}/dist/index.js`, 'export {};\n');
    symlinkSync(join(this.root, 'packages', 'render'), this.linkOf('@miragon/bpmn-render'));
    symlinkSync(join(this.root, 'packages', 'lint'), this.linkOf('@miragon/bpmn-lint'));
  }

  plant(path: string, content: string): void {
    const file = join(this.root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  checkStructure(): ToolRun {
    return this.run(process.execPath, [join(REPOSITORY, 'tools', 'check-structure.mjs'), this.root]);
  }

  checkBudgets(): ToolRun {
    return this.run(process.execPath, [join(REPOSITORY, 'tools', 'check-budgets.mjs'), this.root]);
  }

  cruise(): ToolRun {
    const depcruise = join(REPOSITORY, 'node_modules', '.bin', 'depcruise');
    return this.run(depcruise, ['src', 'packages', '--config', join(REPOSITORY, '.dependency-cruiser.cjs')]);
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  private linkOf(packageName: string): string {
    return join(this.root, 'node_modules', packageName);
  }

  private run(command: string, args: string[]): ToolRun {
    const { status, stdout, stderr } = spawnSync(command, args, { cwd: this.root, encoding: 'utf8' });
    return { status, output: stdout + stderr };
  }
}
