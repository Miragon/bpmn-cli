import { pathToFileURL } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { openBuild } from './build-side.mjs';
import { MAIN_ROOT } from './paths.mjs';

const subjects = new Map();

const entryOf = async ({ entryFile }) => (await import(pathToFileURL(entryFile).href)).default;

function subjectOf(job) {
  if (!subjects.has(job.entryFile)) {
    subjects.set(job.entryFile, entryOf(job).then((entry) => entry.open(job.entryOptions)));
  }
  return subjects.get(job.entryFile);
}

async function sidesOf(job) {
  const [entry, subject] = await Promise.all([entryOf(job), subjectOf(job)]);
  return entry.sidesFor ? entry.sidesFor(job.input, subject) : { main: await openBuild(MAIN_ROOT), subject };
}

parentPort.on('message', async (job) => {
  const started = performance.now();
  try {
    const { default: probe } = await import(pathToFileURL(job.probeFile).href);
    const outcome = await probe.compare(job.input, await sidesOf(job));
    parentPort.postMessage({ ...outcome, ms: performance.now() - started });
  } catch (error) {
    parentPort.postMessage({ failure: error.stack, ms: performance.now() - started });
  }
});
