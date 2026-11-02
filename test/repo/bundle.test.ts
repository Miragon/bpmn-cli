import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlantedRepo } from './PlantedRepo.js';

const APPLY_TO_XML = "export function applyToXml(xml) {\n  return Promise.resolve(xml);\n}\n";

let repo: PlantedRepo;

beforeEach(() => {
  repo = new PlantedRepo();
  repo.plantBudgets({});
  repo.plant('package.json', JSON.stringify({ sideEffects: false, dependencies: { bpmnlint: '12.0.0' } }));
  repo.plant('src/api/index.ts', APPLY_TO_XML);
  repo.plant('packages/lint/package.json', JSON.stringify({ name: '@miragon/bpmn-lint', exports: './src/index.ts', sideEffects: true }));
  repo.plant('packages/render/package.json', JSON.stringify({ name: '@miragon/bpmn-render', exports: './src/index.ts', sideEffects: true }));
  repo.plantInstalledPackages();
});

afterEach(() => {
  repo.remove();
});

describe('what a write may load', () => {
  it('passes a CLI that loads project lint on demand', () => {
    repo.plant('src/cli/index.ts', "export const lint = () => import('@miragon/bpmn-lint');\n");

    expect(repo.checkBundle().status).toBe(0);
  });

  it('fails when the CLI loads project lint up front', () => {
    repo.plant('src/cli/index.ts', "import '@miragon/bpmn-lint';\n");
    repo.plant('packages/lint/src/index.ts', "console.log('lint');\n");

    const { status, output } = repo.checkBundle();

    expect(output).toContain('the CLI loads project lint on a write');
    expect(status).toBe(1);
  });

  it('fails when a write in the library can reach the painter', () => {
    repo.plant('src/api/index.ts', "export const applyToXml = () => import('@miragon/bpmn-render');\n");
    repo.plant('packages/render/src/index.ts', "console.log('paint');\n");

    const { status, output } = repo.checkBundle();

    expect(output).toContain('applyToXml loads the painter on a write');
    expect(status).toBe(1);
  });

  it('fails when the CLI imports bpmnlint up front', () => {
    repo.plant('src/cli/index.ts', "import 'bpmnlint';\n");

    const { status, output } = repo.checkBundle();

    expect(output).toContain('the CLI loads bpmnlint on a write');
    expect(status).toBe(1);
  });
});
