# Contributing

Thanks for your interest in `@miragon/bpmn-cli`! Contributions of all kinds are welcome: bug
reports, ideas for commands, docs and code.

## Getting started

```bash
git clone https://github.com/Miragon/bpmn-cli.git
cd bpmn-cli
npm ci
npm run build          # tsc -> dist/
npm link               # optional: puts `bpmn` on your PATH (bin/bpmn.js)
bpmn guide             # the agent cheat sheet
```

This is a single-package TypeScript CLI and library, built with `tsc` and tested with
[Vitest](https://vitest.dev/). Node 22.12+ is required (developed on Node 24; CI also runs the
build and the tests on Node 22.12).

## Scripts (the quality gate)

```bash
npm run dev -- <args>   # run the TypeScript sources directly (tsx src/cli.ts)
npm run typecheck       # tsc, no emit (unused locals and parameters fail)
npm run knip            # unused files, exports, types and dependencies
npm test                # the vitest suite
npm run gate            # everything a change has to pass before it is handed over
```

`npm run gate` builds, runs knip twice (the second time in production mode: code in `src/` that only
tests use fails unless its export is tagged `@internal`), the architecture rules (dependency-cruiser), the duplication budget of `src/` (jscpd,
`.jscpd.json`), the tests, the isomorphism check of the browser-safe core, the layout-regression
budget and a short fuzz campaign. CI runs `typecheck` and `gate` on every pull
request and every push to `main`. The test layers, the benchmark and the fuzzer, and how to run
them on a private corpus without copying it into the repository, are described in
[docs/testing.md](docs/testing.md).

## How the package is laid out

- `src/`: the four entries in the root and three rings around the domain (ports and adapters).
  The entries wire the rings: `cli.ts` starts the `Cli` with the file adapters, `node.ts` is
  `@miragon/bpmn-cli/node`, `api.ts` the in-memory functions (they wire the services to the in-memory adapters; `index.ts` re-exports them), and `index.ts` the browser-safe
  core, which wires the services of its own functions to the in-memory adapters too. `src/adapters/in/report/CommandCatalogue.ts` lists every command with its arguments,
  its `--help` text and its guide usage, and the options of every write: the commander wiring in
  `src/adapters/in/cli/` and `bpmn guide` both read it. `src/adapters/in/report/guide.ts` holds the
  error catalogue and the other hand-written tables that `bpmn guide` (`AgentGuide.ts`) and
  `bpmn kinds` (`KindsReference.ts`) print.

  | folder | holds |
  | --- | --- |
  | `domain/document/` | the moddle tree, kinds, `Doc`, the `ChangeSet` of a mutation, the `FlowRules`, an edit's `IdAllocator`, the errors; `ids/` (id words, the file's id style, the declared id conventions), `xml/` (the text-preserving write, the encoding), `vendor/` (Camunda 7 / 8 knowledge) |
  | `domain/commands/` | the commands a caller can ask for (`EditCommand`: `AddElement`, `PlaceShapes`, ...), the ops JSON of `apply` and its aliases |
  | `domain/diagram/` | the drawing (BPMN DI): `di/` reads and writes planes, frames, groups and the checkpoint every engine shares, `layout/` holds the engines (`clean/` redraws with `FullLayout`, `incremental/` keeps a hand-made drawing), `DrawnDiagram` is the drawing the diagram commands change, `commands/` holds one handler per diagram command (`ShapePlacement`, `ShapeAlignment`, `SpaceInsertion`, ...) and `DiagramCommands`, which dispatches them; `BatchDrawing` is all a batch does to the drawing |
  | `domain/editing/` | what changes the model, one folder per concern: `elements/` (add, remove, retype, move, order, placement, artifacts, pools, lanes), `connections/` (connect, associations, sequence flows, bridges, flow ids, split), `properties/` (set, value coercion, the set keys, nested slots, vendor elements, decision links), `events/` (triggers, event definitions, root elements, the event-gateway rule), `extensions/` (ext), `ids/` (id renames); a command is a class created with the `EditSession` (`new ElementCreation(edit).add(op)`, `new Connections(edit).connect(op)`, ...) |
  | `domain/validation/` | structural validation (`StructuralValidator`, `FlowOrder`), the validator hook, the `FindingBaseline` a write compares with and the `FindingMatcher` that tells the same finding before and after an edit; `PlatformCheck` adds the Camunda 7 / 8 findings of the injected `EngineLint` |
  | `domain/views/` | the read views (`show`, `find`, `--around`, `--context`) and `DrawableDoc`, a document ready to draw (one without a diagram laid out in memory) |
  | `domain/batch/` | one batch of commands on a document in memory: `EditBatch` (guard, commands, validation, layout, kept text, result), `ModelCommands` hands each model command to its domain service and `BatchDrawing` (`domain/diagram/`) lays the drawing out between them; the top of the domain, nothing imports it back |
  | `application/port/in/` | one contract per use case, the way in: an interface with its `Command` and `Result` (`EditDocumentUseCase`, `RelayoutDiagramUseCase`, `ValidateDocumentUseCase`, `ShowModelUseCase`, ...), also for a pure query that needs no outbound port |
  | `application/port/out/` | what the application needs from outside, named after what it does: `DocumentPort` (load a document, resolve where a result goes, save it), `LoadProjectSettingsPort` (the `.bpmnlintrc`), `RenderDiagramPort` (a plane as SVG), `EngineLintPort` (the Camunda 7 / 8 rules), `WriteImagePort` |
  | `application/service/` | one service per use case that implements its contract (`EditDocumentService implements EditDocumentUseCase`): load, let the domain work, save, all through the outbound ports; a query asks the domain and returns its answer |
  | `adapters/in/cli/` | the driving adapter: the `Cli` (commander, streams, exit codes, errors) and one class per command; it knows the use cases only by their contracts and reaches the domain only through them; from the domain it takes the command vocabulary to check its flags (errors, op rules, flag values) |
  | `adapters/in/report/` | what a use case's result looks like to the one who asked: text and JSON reports (`MutationText`, `MutationReportBuilder`, `ValidationText`, ...), the views as text, and the reference the guide and `bpmn kinds` print; the CLI prints them and `index.ts` / `api.ts` return them |
  | `adapters/out/bpmnlint/` | the injected bpmnlint as a validator of the domain, browser-safe: `BpmnlintConfigResolution` (the effective `.bpmnlintrc`), `BpmnlintValidator`, `IdConventionsReader` (the id conventions of `element-id-naming`); `BpmnlintEngineLint`, the Camunda 7 / 8 rules (the `EngineLintPort`), which loads `engine/` on demand: camunda-compat's rules (`compatRules`) and bpmn-cli's own rules (six for Camunda 7, five for Camunda 8: `engine/rules/c7|c8/`, written on `EngineRule` of `@miragon/bpmnlint-plugin-rules/engine` and run in one walk with its `lint`), mapped to `W_C7_*` / `W_C8_*` (`EngineFindings`, `EngineCodes`, `EngineHint`; `CompatVerdicts` holds where bpmn-cli reads camunda-compat differently), and the checks on bpmn-cli's own model a typed parse cannot see (`OwnModelCheck`); `engine/` gets the core from `engine-kit.ts` (a rule chunk must not import the entry) |
  | `adapters/out/files/` | the driven adapters on disk, Node only: `FileDocumentStore`, `BpmnlintProjectSettings` (loads the `.bpmnlintrc` and its plugins for `adapters/out/bpmnlint/`), `FileImageWriter` (PNG) |
  | `adapters/out/document/` | `DocumentStore`, what the file store and the in-memory store share behind the `DocumentPort`: a source parsed into a `Doc`, the lossless check, the target of a write and whether to write; browser-safe |
  | `adapters/out/render/` | the SVG renderer behind the `RenderDiagramPort`, browser-safe: `SvgRenderer` (the port), `DocRenderer` (one plane, start to end), `crop/` (which part of the plane), `paint/` (the shapes, connections and labels as SVG), `compose/` (frame, scale, badges, tiles) |
  | `adapters/out/memory/` | the driven adapters of the in-memory API: `NoDocumentFiles`, `NoProjectSettings` |
  | `types/` | type shims for the bpmn-io packages that ship no usable declarations |

  Where new code goes: a new command is a type in `domain/commands/` and a class of
  `domain/editing/` created with the `EditSession` that `domain/batch/` hands it; a new command line verb or API function is a contract in
  `application/port/in/` and a service that implements it; reading the model without changing
  it is a view (`domain/views/`); deciding positions is `domain/diagram/`; text or JSON for the
  user is `adapters/in/report/`; anything that touches the file system or `process` is an
  adapter behind a port of `application/port/out/`; mapping flags to options and printing a
  command's result is `adapters/in/cli/`. The entries (`cli.ts`, `index.ts`, `node.ts`, `api.ts`) create
  the services with their adapters. Every public function that works on a document goes
  through a use case, even one that only forwards to the domain: the entries import values only
  from `application/` and `adapters/`, and from `domain/` only types, re-exporting just the
  public classes, constants and pure helpers. `npm run architecture` (dependency-cruiser, `.dependency-cruiser.cjs`) checks the rings: the domain
  imports neither the application nor the adapters, the application no adapter, an adapter no
  other adapter (the CLI only the reports, the files only bpmnlint and the document store, the memory adapters only the document store), the driving adapter no service, only adapters and entries import `node:*`,
  `application/` holds only ports and services, and the root of `src/` only the entries.
  It also keeps `src/` free of import cycles; type-only imports may point back.

  **Classes first, helpers in `utils/`.** Each module builds on classes, one per file, the file
  named like the class (`domain/document/ModelError.ts`, `domain/diagram/di/DrawingCheckpoint.ts`). Stateless helper
  functions live in the one `utils/` folder of their module (`domain/document/utils/moddle.ts`,
  `domain/document/utils/fuzzy.ts`); a utils file holds no class and imports only other utils files and
  error classes. Outside the entries (`api.ts`, `index.ts`, `node.ts`, which keep the
  package's public functions and delegate to the classes) there are no free functions.
- `test/`: the vitest suite. Its folders mirror the module folders of `src/`
  (`test/domain/batch/`, `test/adapters/in/cli/`, ...): a test sits with the module whose
  interface it exercises. Black-box tests through the entries and the CLI are in `test/e2e/`,
  shared helpers in `test/helpers/`; `test/repo-hygiene.test.ts` keeps it that way. Name a test
  after what it tests, never after the work step that added it. The suite also pins the documentation: the README quick start and the
  examples in `docs/` must match what the CLI prints.
- `tools/`: benchmark, fuzzer, layout regression, isomorphism check, descriptor generator.
  The README demo (`docs/assets/demo.gif`) comes from the `product-shots` skill of the
  `miragon-brand` plugin ([Miragon/corporate-identity](https://github.com/Miragon/corporate-identity)),
  journey `bpmn-cli-demo.mjs`; this repo keeps no script of its own for it.
- `docs/`: the docs site, [miragon.github.io/bpmn-cli](https://miragon.github.io/bpmn-cli/), a
  VitePress site with its own `package.json` and lockfile. `npm --prefix docs ci` once, then
  `npm run docs:dev` serves it with live reload and `npm run docs:build` builds it (a dead link
  fails the build; the `docs` workflow builds it on every pull request that touches `docs/` and
  deploys it from `main`). A new page goes into the sidebar in `docs/.vitepress/config.ts`;
  maintainer notes (`testing.md`, `releasing.md`, the audit) stay out of the site via `srcExclude`.
  The site is built with the Miragon docs kit: `docs/.vitepress/config.ts` passes the repo's name,
  nav and sidebar to its `miragonDocs()`, and the kit sets the theme, the colours light and dark,
  the GitHub-style heading anchors and the legal row. The kit in `docs/.vitepress/miragon/` and the
  logos in `docs/public/logo/` are vendored unchanged from Miragon's corporate identity (skill
  `docs-site` of the miragon-brand plugin): do not edit them here, `npm --prefix docs run check:kit`
  fails on a hand edit, and the `docs` workflow runs it on every pull request that touches `docs/`.
  `.miragon/brand.json` switches brand-lint on for the docs and the README.
- `plugins/bpmn-cli/`: the Claude Code plugin (see its [README](plugins/bpmn-cli/README.md)).

### Dependencies

`bpmn-moddle` (the semantic model; `moddle` for its types), `@resvg/resvg-wasm` (the PNG rasteriser of
`bpmn render`), `commander` (the CLI only), and `bpmnlint` (pinned to `11.15.0`) with
`@miragon/bpmnlint-plugin-rules` (bpmnlint's rules, camunda-compat and Miragon's rules behind one
resolver). They run when a `.bpmnlintrc` applies (see [bpmnlint](docs/bpmnlint.md)), and the plugin's
`./camunda-7` and `./camunda-8` entries are the Camunda 7 / 8 rules of every check, loaded on demand
(see [Camunda 7 and Camunda 8](docs/camunda.md#where-the-checks-come-from)). Both are pinned exactly: they decide which findings an agent sees,
the tests pin those findings, and bpmn-cli uses bpmnlint's `Linter` beyond its documented API.

`camunda-bpmn-moddle` (pinned to `8.0.1`) is a development dependency: its Camunda 7 descriptor
says which `camunda:` attributes and extension elements belong where (placement, `validate`), and
it is inlined into `src/domain/document/vendor/camunda-descriptor.ts` by `node tools/gen-camunda-descriptor.mjs`
(run it after updating the package; a test fails while the copy differs), so the published package
reads the copy, without the package and without file access. It is never registered with
bpmn-moddle, so camunda content stays untyped and the serialisation is unchanged.
`zeebe-bpmn-moddle` (pinned to `2.0.0`) is the same for Camunda 8: its Zeebe descriptor is inlined
into `src/domain/document/vendor/zeebe-descriptor.ts` by the same tool and read as data (placement and known
names of zeebe content, see [Camunda 8](docs/camunda.md#camunda-8)).

## Ground rules

- **Conventional Commits.** Commit messages and PR titles follow
  [Conventional Commits](https://www.conventionalcommits.org/) with one of the types `feat`, `fix`,
  `chore`, `docs`, `refactor`, `ci`, `build`, `test`, `revert`. Releases and the changelog are
  generated from them via [release-please](https://github.com/googleapis/release-please), so a
  `feat` or `fix` title is what users read in the release notes.
- **Documentation moves with the code.** A change to a command, an option or an output also
  changes `src/adapters/in/report/CommandCatalogue.ts` or `src/adapters/in/report/guide.ts` and the matching page in `docs/`.
- **Block style.** The bodies of `if`, `else` and loops are blocks on lines of their own, with
  `} else {` on the closing line. Only an `if` without `else` may stay on one line without braces
  when it fits in 80 characters (`if (!doc) return undefined;`). `biome lint` enforces this with
  the plugin `tools/biome/block-statements.grit`.

## Before opening a PR

```bash
npm run typecheck
npm run gate
```

## The release flow

Releases are automated with release-please:

1. Merge PRs with Conventional-Commit titles into `main`.
2. release-please opens (and keeps updating) a release PR that bumps the version and
   `CHANGELOG.md` from the accumulated commits.
3. Merging that release PR tags the release and triggers the publish job, which publishes to npm
   using OIDC trusted publishing. No manual `npm publish` and no `NPM_TOKEN` are involved.

The details are in [docs/releasing.md](docs/releasing.md).

## Reporting bugs

Use the GitHub issue templates. Attaching the `.bpmn` file and the exact command (or the ops JSON
of `bpmn apply`) is by far the fastest path to a fix.
