const LAYERS = [['cli'], ['api'], ['write', 'views'], ['edit', 'drawing', 'checks'], ['operations', 'scoring'], ['model']];
const LINT_LOADERS = '^node_modules/(bpmnlint|bpmnlint-plugin-[^/]+|@[^/]+/bpmnlint-plugin-[^/]+)/';
const PLUGIN_ROOT_ENTRY = '^node_modules/@miragon/bpmnlint-plugin-rules/dist/index[.]js$';
const RENDER_ROOT_ENTRY = '^packages/render/src/index[.]ts$';
const RENDER_TEXT_ENTRY = '^packages/render/src/text/index[.]ts$';
const RENDER_PNG_ENTRY = '^packages/render/src/png/(node/)?index[.]ts$';
const LINT_ENTRY = '^packages/lint/src/index[.]ts$';
const SOURCE = '^(src|packages/[^/]+/src)/';

function forbid(name, from, to) {
  return { name, severity: 'error', from, to };
}

function layerRules() {
  return LAYERS.flatMap((layer, depth) => {
    const sameOrHigher = LAYERS.slice(0, depth + 1).flat();
    return layer
      .map((module) => [module, sameOrHigher.filter((other) => other !== module)])
      .filter(([, forbidden]) => forbidden.length > 0)
      .map(([module, forbidden]) => forbid(`layer-${module}`, { path: `^src/${module}/` }, { path: `^src/(${forbidden.join('|')})/` }));
  });
}

module.exports = {
  forbidden: [
    forbid('no-unresolvable', {}, { couldNotResolve: true }),
    forbid('no-cycle', { path: '^(src|packages|test)/' }, { circular: true }),
    ...layerRules(),
    forbid('module-entry-only', { path: '^src/([^/]+)/' }, { path: '^src/[^/]+/.', pathNot: ['^src/$1/', '^src/[^/]+/index[.]ts$'] }),
    forbid('core-entry-is-the-contract', { path: '^src/index[.]ts$' }, { pathNot: '^src/api/index[.]ts$' }),
    forbid('core-entry-imported-by-no-module', { path: '^src/[^/]+/' }, { path: '^src/index[.]ts$' }),
    forbid('subfolder-imports-no-value-of-module-root', { path: '^(src/[^/]+)/[^/]+/' }, { path: '^$1/[^/]+[.]ts$', dependencyTypesNot: ['type-only'] }),
    forbid('deep-subfolder-imports-no-value-of-parent', { path: '^(src/[^/]+/[^/]+)/[^/]+/' }, { path: '^$1/[^/]+[.]ts$', dependencyTypesNot: ['type-only'] }),
    forbid('package-subfolder-imports-no-value-of-root', { path: '^(packages/[^/]+/src)/[^/]+/' }, { path: '^$1/[^/]+[.]ts$', dependencyTypesNot: ['type-only'] }),
    forbid('package-deep-subfolder-imports-no-value-of-parent', { path: '^(packages/[^/]+/src/[^/]+)/[^/]+/' }, { path: '^$1/[^/]+[.]ts$', dependencyTypesNot: ['type-only'] }),
    forbid('cli-imports-only-api-lint-and-png', { path: '^src/cli/' }, { path: '^(src|packages)/', pathNot: ['^src/cli/', '^src/api/index[.]ts$', LINT_ENTRY, RENDER_PNG_ENTRY] }),
    forbid('cli-imports-only-commander-and-the-plugin', { path: '^src/cli/' }, { path: '^node_modules/', pathNot: ['^node_modules/commander/', '^node_modules/@miragon/bpmnlint-plugin-rules/'] }),
    forbid('scoring-imports-only-model-and-text', { path: '^src/scoring/' }, { path: '^(src|packages|node_modules)/', pathNot: ['^src/scoring/', '^src/model/index[.]ts$', RENDER_TEXT_ENTRY] }),
    forbid('scoring-imported-only-by-drawing-write-and-views', { path: '^src/', pathNot: '^src/(scoring|drawing|write|views)/' }, { path: '^src/scoring/' }),
    forbid('checks-structure-imports-no-camunda', { path: '^src/checks/structure/' }, { path: '^src/checks/camunda/' }),
    forbid('checks-camunda-imports-no-structure', { path: '^src/checks/camunda/' }, { path: '^src/checks/structure/' }),
    forbid('package-imports-no-core', { path: '^packages/' }, { path: '^src/' }),
    forbid('package-imports-no-other-package', { path: '^packages/([^/]+)/' }, { path: '^packages/', pathNot: '^packages/$1/' }),
    forbid('package-test-stays-in-its-package', { path: '^packages/([^/]+)/test/' }, { pathNot: ['^packages/$1/', '^node_modules/'], dependencyTypesNot: ['core'] }),
    forbid('lint-imported-only-by-cli', { pathNot: ['^src/cli/', '^packages/lint/'] }, { path: '^packages/lint/' }),
    forbid('core-reaches-packages-through-their-entries', { path: '^(src|test)/' }, { path: '^packages/', pathNot: [RENDER_ROOT_ENTRY, RENDER_TEXT_ENTRY, RENDER_PNG_ENTRY, LINT_ENTRY] }),
    forbid('render-root-imported-only-by-views', { path: '^src/', pathNot: '^src/views/' }, { path: RENDER_ROOT_ENTRY }),
    forbid('render-text-imported-only-by-drawing-and-scoring', { path: '^src/', pathNot: '^src/(drawing|scoring)/' }, { path: RENDER_TEXT_ENTRY }),
    forbid('render-png-imported-only-by-cli', { path: '^src/', pathNot: '^src/cli/' }, { path: RENDER_PNG_ENTRY }),
    forbid('node-builtins-only-in-cli-lint-and-the-png-node-entry', { path: SOURCE, pathNot: ['^src/cli/', '^packages/lint/', '^packages/render/src/png/node/'] }, { dependencyTypes: ['core'] }),
    forbid(
      'bpmnlint-loads-only-in-lint',
      { pathNot: ['^packages/lint/', '^src/cli/files/', '^test/drawing/.*ShapeSizes[.]test[.]ts$', '^test/corpus/'] },
      { path: LINT_LOADERS },
    ),
    {
      name: 'cli-files-loads-only-the-plugin-root',
      comment: 'Interim until step 2 ships ./naming from @miragon/bpmnlint-plugin-rules: src/cli/files/ may import the plugin root instead of /naming; that step narrows both bpmnlint rules to the /naming entry.',
      severity: 'error',
      from: { path: '^src/cli/files/' },
      to: { path: LINT_LOADERS, pathNot: PLUGIN_ROOT_ENTRY },
    },
    forbid('cli-outside-files-loads-no-plugin', { path: '^src/cli/', pathNot: '^src/cli/files/' }, { path: LINT_LOADERS }),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|coverage|[.]oracle|[.]api)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    parser: 'swc',
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['node', 'import', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
    },
  },
};
