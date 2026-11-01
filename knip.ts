const LOADED_BY_THE_BUNDLES_OF_PRIVATE_PACKAGES = ['@resvg/resvg-wasm'];
const PARSER_OF_DEPENDENCY_CRUISER = ['@swc/core'];
const LOADED_BY_REQUIRE_IN_LINT = ['bpmn-moddle'];

export default {
  workspaces: {
    '.': {
      entry: ['src/{index,cli/index}.ts!', 'tools/**/*.mjs', 'test/**/*.test.ts'],
      project: ['src/**/*.ts!', 'tools/**/*.mjs', 'test/**/*.ts'],
      ignoreDependencies: [...LOADED_BY_THE_BUNDLES_OF_PRIVATE_PACKAGES, ...PARSER_OF_DEPENDENCY_CRUISER],
    },
    'packages/render': { project: ['src/**/*.ts!', 'test/**/*.ts'] },
    'packages/lint': { ignoreDependencies: LOADED_BY_REQUIRE_IN_LINT },
  },
};
