import type { Executor } from './exec.mjs';

export interface Violation {
  step: number;
  op: string;
  kind: string;
  detail?: string;
  severity: 'error' | 'warn';
}

export interface WalkSummary {
  steps: number;
  ok: number;
  errors: number;
  warnings: number;
  violations: Violation[];
  ops: Array<{ name: string; ops: unknown[] }>;
}

export interface WalkMetrics {
  measure(xml: string): Promise<{ counts?: Record<string, number>; problems?: readonly unknown[]; score?: number | null }>;
  diff(before: readonly never[], after: readonly never[]): { added: unknown[] };
  hard: string[];
}

export interface WalkConfig {
  xml: string;
  model: string;
  seed: number;
  steps: number;
  exec: Executor;
  metrics: WalkMetrics;
  detEvery: number;
  hardSeverity?: 'error' | 'warn';
}

export function runWalk(config: WalkConfig): Promise<WalkSummary>;
