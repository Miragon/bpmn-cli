import { openBuild } from '../lib/build-side.mjs';
import { MAIN_ROOT } from '../lib/paths.mjs';

export default {
  name: 'main',
  describes: 'main itself, standing in for the rebuild',
  open: () => openBuild(MAIN_ROOT),
};
