import { join } from 'node:path';
import { copyModels } from '../lib/corpus.mjs';
import { MAIN_ROOT } from '../lib/paths.mjs';

export default {
  order: 1,
  run() {
    copyModels(join(MAIN_ROOT, 'tools', 'scenarios'), 'layout');
  },
};
