import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { readCorpus } from './lib/corpus.mjs';
import { ensureMainBuilt } from './lib/main-build.mjs';
import { runOracle } from './lib/oracle.mjs';
import { ORACLE_DIR, REPO_ROOT, RESULT_FILE } from './lib/paths.mjs';
import { summaryText } from './lib/report.mjs';
import { judge } from './lib/verdict.mjs';

const { values: options } = parseArgs({
  options: {
    probe: { type: 'string' },
    entry: { type: 'string' },
    filter: { type: 'string' },
    jobs: { type: 'string' },
  },
});
const namesIn = (value) => value?.split(',');
const readJson = (name) => JSON.parse(readFileSync(join(ORACLE_DIR, name), 'utf8'));

const { commit } = ensureMainBuilt({ log: console.log });
const run = await runOracle({
  probeNames: namesIn(options.probe),
  entryNames: namesIn(options.entry),
  filter: options.filter,
  workers: options.jobs ? Number(options.jobs) : undefined,
});
const judged = judge(run.runs, { allowList: readJson('differences.json'), progress: readJson('progress.json') });
const recordedAt = JSON.parse(readCorpus('layout/scores.json')).commit;
const result = { commit, recordedAt, workers: run.workers, wallSeconds: run.wallSeconds, ...judged };
writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 1)}\n`);
console.log(summaryText(result, relative(REPO_ROOT, RESULT_FILE)));
process.exitCode = judged.ok ? 0 : 1;
