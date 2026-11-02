export default {
  probe: 'image',
  target: 'adapters/out/render/utils/svg.js',
  find: `export const STROKE = '#22242a';`,
  replace: `export const STROKE = '#2a7a42';`,
};
