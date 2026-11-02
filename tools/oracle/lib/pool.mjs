import { Worker } from 'node:worker_threads';

const WORKER_FILE = new URL('./worker.mjs', import.meta.url);

export function runJobs(jobs, { workers, timeoutMs }) {
  const outcomes = new Array(jobs.length);
  let nextJob = 0;
  let settled = 0;
  return new Promise((resolve) => {
    if (!jobs.length) {
      resolve(outcomes);
      return;
    }
    const startWorker = () => {
      const worker = new Worker(WORKER_FILE);
      let running;
      let timer;
      const settle = (outcome) => {
        clearTimeout(timer);
        outcomes[running] = outcome;
        settled += 1;
        if (settled === jobs.length) {
          resolve(outcomes);
        }
      };
      const giveNextJob = () => {
        if (nextJob >= jobs.length) {
          worker.terminate();
          return;
        }
        running = nextJob;
        nextJob += 1;
        timer = setTimeout(() => {
          settle({ failure: `timed out after ${timeoutMs / 1000} s` });
          worker.terminate();
          startWorker();
        }, timeoutMs);
        worker.postMessage(jobs[running]);
      };
      worker.on('message', (outcome) => {
        settle(outcome);
        giveNextJob();
      });
      worker.on('error', (error) => {
        settle({ failure: `the worker died: ${error.message}` });
        startWorker();
      });
      giveNextJob();
    };
    for (let index = 0; index < Math.min(workers, jobs.length); index++) {
      startWorker();
    }
  });
}
