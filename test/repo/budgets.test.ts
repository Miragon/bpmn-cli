import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlantedRepo } from './PlantedRepo.js';

const FLOOR = { lines: 90, branches: 85 };

let repo: PlantedRepo;

beforeEach(() => {
  repo = new PlantedRepo();
  repo.plantBudgets({});
});

afterEach(() => {
  repo.remove();
});

function exportsOfCount(count: number): string {
  const names = Array.from({ length: count }, (_, index) => `name${index}`);
  return names.map((name) => `export const ${name} = 1;\n`).join('');
}

describe('the budgets', () => {
  it('pass the empty skeleton', () => {
    expect(repo.checkBudgets().status).toBe(0);
  });

  it('measure the guide: its topics in kilobytes, over all three folders', () => {
    repo.plant('src/cli/help/guide/core.md', 'x'.repeat(1200));
    repo.plant('src/cli/help/tables/kinds.md', 'x'.repeat(1300));
    expect(repo.checkBudgets().output).toContain('guide 2.5 KB');

    repo.plantBudgets({ guideKilobytes: 2 });
    const { status, output } = repo.checkBudgets();
    expect(output).toContain('the guide has 2.5 KB, over its budget of 2');
    expect(status).toBe(1);
  });

  it('measure the commands and flag slots of the CLI', () => {
    repo.plant('package.json', '{}');
    repo.plant('src/cli/CliProgram.ts', 'export class CliProgram {\n  commander = { commands: [{ commands: [{ commands: [], options: [1, 2] }] }, { commands: [], options: [1] }] };\n}\n');
    expect(repo.checkBudgets().output).toContain('2 commands, 3 flag slots');

    repo.plantBudgets({ commands: 1, flagSlots: 2 });
    const { status, output } = repo.checkBudgets();
    expect(output).toContain('the CLI has 2 commands, over its budget of 1');
    expect(output).toContain('the CLI has 3 flagSlots, over its budget of 2');
    expect(status).toBe(1);
  });

  it('fail on a module over its lines', () => {
    repo.plant('src/api/index.ts', exportsOfCount(301));
    const { status, output } = repo.checkBudgets();
    expect(output).toContain('src/api has 301 lines');
    expect(status).toBe(1);
  });

  it('fail on a total over its line budget', () => {
    repo.plantBudgets({ lines: { ...JSON.parse(repo.plantedBudgets()).lines, total: 1 } });
    repo.plant('src/api/index.ts', exportsOfCount(2));
    expect(repo.checkBudgets().output).toContain('src/ and packages/ have');
  });

  it('fail on a lowered coverage floor', () => {
    repo.plantBudgets({ coverage: { 'src/model': { lines: 80, branches: 85 } } });
    const { status, output } = repo.checkBudgets();
    expect(output).toContain('coverage is raised only');
    expect(status).toBe(1);
  });

  it('accept a raised coverage floor', () => {
    const { coverage } = JSON.parse(repo.plantedBudgets());
    repo.plantBudgets({ coverage: { ...coverage, 'src/model': { ...FLOOR, lines: 95 } } });
    expect(repo.checkBudgets().status).toBe(0);
  });
});

describe('the iso check', () => {
  it('passes the empty skeleton', () => {
    expect(repo.checkIso().status).toBe(0);
  });

  it('fails on a Node builtin in the core entry', () => {
    repo.plant('src/api/index.ts', "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n");
    const { status, output } = repo.checkIso();
    expect(output).toContain('node:fs');
    expect(status).toBe(1);
  });

  it('fails on a Node global in the render entry', () => {
    repo.plant('packages/render/src/index.ts', 'export const cwd = process.cwd();\n');
    const { status, output } = repo.checkIso();
    expect(output).toContain('packages/render/src/index.ts uses the Node-only global process');
    expect(status).toBe(1);
  });

  it('measures only the browser start imports and what loads with them', () => {
    repo.plantBudgets({ browserStartImportKilobytes: 1 });
    repo.plant('src/api/Heavy.ts', `export const heavy = '${'x'.repeat(4000)}';\n`);
    repo.plant('src/api/index.ts', "export const findXml = () => import('./Heavy.js');\nexport const unused = '" + 'y'.repeat(4000) + "';\n");
    expect(repo.checkIso()).toMatchObject({ status: 0, output: expect.stringContaining('1 of 7 imports') });
  });

  it("fails on the browser start imports over their budget", () => {
    repo.plantBudgets({ browserStartImportKilobytes: 1 });
    repo.plant('src/api/index.ts', `export const applyToXml = '${'x'.repeat(4000)}';\n`);
    const { status, output } = repo.checkIso();
    expect(output).toContain("the browser start imports are");
    expect(status).toBe(1);
  });
});
