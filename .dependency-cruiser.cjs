const ENTRIES = '^src/(api|cli|index|node)[.]ts$';
const ADAPTERS = ['in/cli', 'in/report', 'out/bpmnlint', 'out/document', 'out/files', 'out/memory', 'out/render'];
const ADAPTER_USES = { 'in/cli': ['in/report'], 'out/files': ['out/bpmnlint', 'out/document'], 'out/memory': ['out/document'] };

const adapterRules = ADAPTERS.map((adapter) => {
  const forbidden = ADAPTERS.filter((other) => other !== adapter && !(ADAPTER_USES[adapter] ?? []).includes(other));
  return {
    name: `adapter-${adapter.replace('/', '-')}`,
    comment: `adapters/${adapter} uses only the adapters it is allowed to`,
    severity: 'error',
    from: { path: `^src/adapters/${adapter}/` },
    to: { path: `^src/adapters/(${forbidden.join('|')})/` },
  };
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'type-only imports vanish at runtime, so they may point back',
      severity: 'error',
      from: { path: '^src/' },
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
    {
      name: 'domain-depends-on-no-outer-layer',
      severity: 'error',
      from: { path: '^src/domain/' },
      to: { path: ['^src/(application|adapters)/', ENTRIES] },
    },
    {
      name: 'application-depends-on-no-outer-layer',
      severity: 'error',
      from: { path: '^src/application/' },
      to: { path: ['^src/adapters/', ENTRIES] },
    },
    {
      name: 'driving-adapters-use-no-service',
      comment: 'the driving adapters know the use cases only by their contracts',
      severity: 'error',
      from: { path: '^src/adapters/in/' },
      to: { path: ['^src/application/service/', ENTRIES] },
    },
    ...adapterRules,
    {
      name: 'only-adapters-and-entries-import-node-builtins',
      severity: 'error',
      from: { path: '^src/(domain|application)/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'only-entries-import-api-and-index',
      severity: 'error',
      from: { path: '^src/[^/]+/' },
      to: { path: '^src/(api|index)[.]ts$' },
    },
    {
      name: 'root-of-src-holds-only-entries',
      comment: 'knip fails on a file nothing imports, so every file is the target of some import',
      severity: 'error',
      from: {},
      to: { path: '^src/[^/]+[.]ts$', pathNot: ENTRIES },
    },
    {
      name: 'application-holds-only-ports-and-services',
      comment: 'port/in: *UseCase or *DocumentSource, port/out: *Port, service: *Service',
      severity: 'error',
      from: {},
      to: {
        path: '^src/application/',
        pathNot: '^src/application/(port/in/[^/]*(UseCase|DocumentSource)|port/out/[^/]+Port|service/[^/]+Service)[.]ts$',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    parser: 'swc',
  },
};
