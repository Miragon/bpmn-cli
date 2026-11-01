import { openBuild } from './build-side.mjs';

export default {
  name: 'planted',
  describes: 'a throwaway copy of main with one change planted',
  open: ({ plantedRoot }) => openBuild(plantedRoot),
};
