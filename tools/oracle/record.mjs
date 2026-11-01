import { ensureMainBuilt } from './lib/main-build.mjs';
import { loadModules } from './lib/registry.mjs';

const { commit } = ensureMainBuilt({ log: console.log });
const picked = process.argv.slice(2);
const recordings = await loadModules('recordings', picked.length ? picked : undefined);
for (const recording of recordings.sort((first, second) => first.order - second.order)) {
  const started = performance.now();
  await recording.run({ commit });
  console.log(`${recording.name}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
