import { dirname } from 'node:path';
import type { BpmnlintUnavailable } from '../../validate/bpmnlint-validator.js';
import { shown } from './paths.js';

export const PLUGIN = '@miragon/bpmnlint-plugin-rules';

/** The packages bpmn-cli ships (tiers 1 and 2). */
export const SHIPPED = new Set(['bpmnlint', 'bpmnlint-plugin-camunda-compat', PLUGIN]);

export const SKIP_HINT = '--no-lint-config skips bpmnlint.';

export type Require = ((id: string) => unknown) & { resolve(id: string): string };

/** Why the libraries could not be loaded (kept: one process does not try again). */
export interface LoadFailure {
  message: string;
  bpmnlint?: { version: string; dir: string };
  pinned?: string;
}

export function versionOf(req: Require, pkg: string): { version: string; dir: string } | undefined {
  try {
    const file = req.resolve(`${pkg}/package.json`);
    return { version: String((req(file) as { version?: unknown }).version), dir: dirname(file) };
  } catch {
    return undefined;
  }
}

export function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/** The engine failure as an unavailable entry: what failed, which bpmnlint the plugin found, what to do. */
export function engineUnavailable(failure: LoadFailure, from?: string): BpmnlintUnavailable {
  const found = failure.bpmnlint ? `; the plugin found bpmnlint ${failure.bpmnlint.version} in ${shown(failure.bpmnlint.dir, from)}` : '';
  return {
    kind: 'engine',
    name: 'bpmnlint',
    pkg: 'bpmnlint',
    reason: `bpmnlint could not be loaded: ${failure.message}${found}`,
    hint: `bpmn-cli needs bpmnlint >= 11.14 next to ${PLUGIN} (it pins ${failure.pinned ?? '11.15.0'}): update the project's bpmnlint (npm i -D bpmnlint@${failure.pinned ?? '11.15.0'}) or run bpmn-cli from its own install (npx); ${SKIP_HINT}`,
  };
}
