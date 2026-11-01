const LOADED_BY_THE_BUNDLES_OF_PRIVATE_PACKAGES = ['@resvg/resvg-wasm', 'bpmnlint'];
const PARSER_OF_DEPENDENCY_CRUISER = ['@swc/core'];
const LOADED_BY_REQUIRE_IN_LINT = ['bpmn-moddle'];

const TEMPORARY_UNTIL_CODE_USES_THEM = {
  core: [
    '@miragon/bpmn-lint',
    '@miragon/bpmn-render',
    '@miragon/bpmnlint-plugin-rules',
    'bpmn-moddle',
    'camunda-bpmn-moddle',
    'commander',
    'moddle',
    'zeebe-bpmn-moddle',
    'zod',
  ],
};

export default {
  workspaces: {
    '.': {
      entry: ['src/*/index.ts', 'tools/**/*.mjs', 'test/**/*.test.ts'],
      project: ['src/**/*.ts!', 'tools/**/*.mjs', 'test/**/*.ts'],
      ignoreDependencies: [...LOADED_BY_THE_BUNDLES_OF_PRIVATE_PACKAGES, ...PARSER_OF_DEPENDENCY_CRUISER, ...TEMPORARY_UNTIL_CODE_USES_THEM.core],
    },
    'packages/lint': { ignoreDependencies: LOADED_BY_REQUIRE_IN_LINT },
  },
};
