/**
 * The bench's layout measurement: this repository's metrics library
 * (src/diagram/metrics.ts, built to dist/diagram/metrics.js), whatever arm
 * wrote the file, so every arm is scored by the same oracle.
 *
 * Contract: `loadMetrics()` -> { keys, weights, hard, newKinds, measure(xml), diff(a, b) } where
 *  - keys / weights are the library's KEYS / WEIGHTS: every problem kind it
 *    knows, including kinds added after this tool was written;
 *  - hard = the hard kinds (tools/fuzz/lib/metric-kinds.mjs: an explicit list
 *    exported by the library, else weight >= 6);
 *  - measure(xml) -> { counts, problems, score } (layoutProblemsOfXml; score =
 *    the tools/layout-regress.mjs score of the file);
 *  - diff(before, after) -> { added, resolved } (diffProblems).
 * Throws a readable error when dist/ is missing.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hardKinds, newKinds } from '../../fuzz/lib/metric-kinds.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export async function loadMetrics() {
  const file = join(ROOT, 'dist', 'diagram', 'metrics.js');
  if (!existsSync(file)) throw new Error(`${file} is missing: run \`npm run build\` first`);
  const lib = await import(pathToFileURL(file).href);
  return {
    keys: [...lib.KEYS],
    weights: { ...lib.WEIGHTS },
    hard: hardKinds(lib),
    newKinds: newKinds(lib),
    measure: (xml) => lib.layoutProblemsOfXml(xml),
    diff: (before, after) => lib.diffProblems(before, after),
  };
}
