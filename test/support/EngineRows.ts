import { expect } from 'vitest';
import type { Finding } from '../../src/model/index.js';
import { type BpmnDocument, PlatformDetection } from '../../src/model/index.js';
import { Fixtures } from './Fixtures.js';

type Verdict = 'accept' | 'reject';

export interface VerdictRow {
  table: string;
  model: string;
  class: string;
  name: string;
  codes: string[];
  engine: Verdict;
  operaton?: Verdict;
  structural?: string;
}

export interface ParityRow {
  model: string;
  class: string;
  name: string;
  valid: boolean;
  codes: string[];
}

export interface StructureRow {
  model: string;
  class: string;
  name: string;
  findings: Array<Pick<Finding, 'code' | 'severity' | 'element'>>;
}

export interface FeelRow {
  expression: string;
  accepted: boolean;
}

interface Checks {
  all(): Finding[];
}

type ChecksOf = (document: BpmnDocument, platform?: 'c7' | 'c8') => Checks;

export class EngineRows {
  private static readonly VERDICT_TABLES = ['c7-profile', 'c7-profile-rules', 'c7-schema-rules', 'c8-feel-and-deploy', 'c8-profile', 'c8-values', 'camunda7-rules'];
  private static readonly TABLES_OF_DEPLOY_CODES = ['c8-feel-and-deploy'];
  private static readonly TABLES_OF_DISTINCT_DEPLOY_CODES = ['c8-values'];

  constructor(
    private readonly className: string,
    private readonly checksOf: ChecksOf,
  ) {}

  static feel(): FeelRow[] {
    return EngineRows.read<FeelRow>('engine/feel/verdicts.json');
  }

  private static read<TRow>(path: string): TRow[] {
    return JSON.parse(Fixtures.text(path)) as TRow[];
  }

  private static comparable(table: string, findings: Finding[]): string[] {
    const deploy = findings.filter(({ severity }) => severity === 'deploy').map(({ code }) => code);
    if (EngineRows.TABLES_OF_DEPLOY_CODES.includes(table)) {
      return deploy.sort();
    }
    return EngineRows.TABLES_OF_DISTINCT_DEPLOY_CODES.includes(table) ? [...new Set(deploy)].sort() : findings.map(({ code }) => code).sort();
  }

  verdicts(): VerdictRow[] {
    const rows = EngineRows.VERDICT_TABLES.flatMap((table) => EngineRows.read<VerdictRow>(`engine/verdicts/${table}.json`).map((row) => ({ ...row, table })));
    return rows.filter((row) => row.class === this.className);
  }

  parity(): ParityRow[] {
    return EngineRows.read<ParityRow>('engine/parity/codes.json').filter((row) => !row.valid && row.class === this.className);
  }

  structure(): StructureRow[] {
    return EngineRows.read<StructureRow>('engine/structure/rows.json').filter((row) => row.class === this.className);
  }

  async expectVerdict(row: VerdictRow): Promise<void> {
    const document = await Fixtures.read(`engine/${row.model}`);
    const findings = this.checksOf(document).all();
    const readsOperaton = new PlatformDetection(document.tree.definitions).info().operaton === true;
    const verdict = readsOperaton ? (row.operaton ?? row.engine) : row.engine;

    expect(EngineRows.comparable(row.table, findings)).toEqual([...row.codes].sort());
    expect(findings.some(({ severity }) => severity === 'deploy') || row.structural !== undefined).toBe(verdict === 'reject' || row.structural !== undefined);
  }

  async expectParity(row: ParityRow): Promise<void> {
    const platform = row.model.startsWith('parity/c7/') ? 'c7' : 'c8';
    const codes = this.checksOf(await Fixtures.read(`engine/${row.model}`), platform).all().map(({ code }) => code);

    expect(codes.filter((code) => code === row.codes[0]).length).toBeGreaterThanOrEqual(row.codes.length);
  }

  async expectStructure(row: StructureRow): Promise<void> {
    const findings = this.checksOf(await Fixtures.read(`engine/${row.model}`)).all();

    const rows = findings.map(({ code, severity, element }) => ({ code, severity, element: element ?? '-' }));

    expect(rows).toHaveLength(row.findings.length);
    expect(rows).toEqual(expect.arrayContaining(row.findings));
  }
}
