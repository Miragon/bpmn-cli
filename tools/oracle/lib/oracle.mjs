import { availableParallelism } from 'node:os';
import { runJobs } from './pool.mjs';
import { loadModule, loadModules } from './registry.mjs';

const JOB_TIMEOUT_MS = 180_000;

function jobsOf(entry, probe, { filter, entryOptions }) {
  return probe.inputs()
    .filter(({ id }) => !filter || id.includes(filter))
    .map((input) => ({ entryFile: entry.file, entryOptions, probeFile: probe.file, input }));
}

async function runOf(entry, probe, jobs, outcomes) {
  const differences = [];
  const listed = [];
  for (const [index, outcome] of outcomes.entries()) {
    differences.push(...(outcome.differences ?? []));
    listed.push(...(outcome.listed ?? []));
    if (outcome.failure) {
      differences.push(`${jobs[index].input.id}: the oracle failed: ${outcome.failure}`);
    }
  }
  const conclusion = (await probe.conclude?.(outcomes.map(({ measures }) => measures).filter(Boolean))) ?? {};
  return {
    entry: entry.name,
    probe: probe.name,
    inputs: jobs.length,
    differences: [...differences, ...(conclusion.differences ?? [])],
    listed,
    measures: conclusion.measures ?? {},
    busySeconds: Math.round(outcomes.reduce((sum, { ms = 0 }) => sum + ms, 0) / 100) / 10,
  };
}

export async function runOracle({ entryNames, probeNames, entryFiles, filter, workers, entryOptions = {} }) {
  const started = performance.now();
  const probes = await loadModules('probes', probeNames);
  const entries = entryFiles ? await Promise.all(entryFiles.map(loadModule)) : await loadModules('entries', entryNames);
  const planned = entries.flatMap((entry) => probes
    .filter((probe) => !entry.probes || entry.probes.includes(probe.name))
    .map((probe) => ({ entry, probe, jobs: jobsOf(entry, probe, { filter, entryOptions }) })));
  const workerCount = workers ?? availableParallelism();
  const outcomes = await runJobs(planned.flatMap(({ jobs }) => jobs), { workers: workerCount, timeoutMs: JOB_TIMEOUT_MS });
  let offset = 0;
  const runs = [];
  for (const { entry, probe, jobs } of planned) {
    runs.push(await runOf(entry, probe, jobs, outcomes.slice(offset, offset + jobs.length)));
    offset += jobs.length;
  }
  return { runs, workers: workerCount, wallSeconds: Math.round((performance.now() - started) / 100) / 10 };
}
