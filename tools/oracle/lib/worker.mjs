import { pathToFileURL } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { openBuild } from './build-side.mjs';
import { MAIN_ROOT } from './paths.mjs';

const subjects = new Map();

function subjectOf({ entryFile, entryOptions }) {
  if (!subjects.has(entryFile)) {
    subjects.set(entryFile, import(pathToFileURL(entryFile).href).then(({ default: entry }) => entry.open(entryOptions)));
  }
  return subjects.get(entryFile);
}

parentPort.on('message', async (job) => {
  const started = performance.now();
  try {
    const { default: probe } = await import(pathToFileURL(job.probeFile).href);
    const [main, subject] = await Promise.all([openBuild(MAIN_ROOT), subjectOf(job)]);
    const outcome = await probe.compare(job.input, { main, subject });
    parentPort.postMessage({ ...outcome, ms: performance.now() - started });
  } catch (error) {
    parentPort.postMessage({ failure: error.stack, ms: performance.now() - started });
  }
});
