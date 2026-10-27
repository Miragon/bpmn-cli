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

`npm run gate` builds, runs knip and the tests, the isomorphism check of the browser-safe core, the
layout-regression budget and a short fuzz campaign. CI runs `typecheck` and `gate` on every pull
request and every push to `main`. The test layers, the benchmark and the fuzzer, and how to run
them on a private corpus without copying it into the repository, are described in
[docs/testing.md](docs/testing.md).

## How the package is laid out

- `src/`: the four entries in the root and three rings around the domain (ports and adapters).
  The entries wire the rings: `cli.ts` starts the `Cli` with the file adapters, `node.ts` is
  `@miragon/bpmn-cli/node`, `api.ts` the in-memory functions (the only place they wire the services to the in-memory adapters; `index.ts` re-exports them), and `index.ts` the browser-safe
  core. `src/adapters/in/report/CommandCatalogue.ts` lists every command with its arguments,
  its `--help` text and its guide usage, and the options of every write: the commander wiring in
  `src/adapters/in/cli/` and `bpmn guide` both read it. `src/adapters/in/report/guide.ts` holds the
  error catalogue and the other hand-written tables that `bpmn guide` (`AgentGuide.ts`) and
  `bpmn kinds` (`KindsReference.ts`) print.

  | folder | holds |
  | --- | --- |
  | `domain/document/` | the moddle tree, kinds, `Doc`, the `ChangeSet` of a mutation, the `FlowRules`, an edit's `IdAllocator`, the errors; `ids/` (id words, the file's id style, the declared id conventions), `xml/` (the text-preserving write, the encoding), `vendor/` (Camunda 7 / 8 knowledge) |
  | `domain/commands/` | the commands a caller can ask for (`EditCommand`: `AddElement`, `PlaceShapes`, ...), the ops JSON of `apply` and its aliases |
  | `domain/diagram/` | the drawing (BPMN DI): `di/` reads and writes planes, frames, groups and the checkpoint every engine shares, `layout/` holds the engines (`clean/` redraws with `FullLayout`, `incremental/` keeps a hand-made drawing), `DrawnDiagram` is the drawing the diagram commands change, `DiagramCommandService` runs them and `format/` holds the services that change it (`ShapePlacementService`, `SpaceInsertionService`, ...); `BatchDrawing` is all a batch does to the drawing |
  | `domain/editing/` | the services that change the model (`ElementCreationService`, `ElementMoveService`, `PropertyService`, ...; `flows/`, `events/`, `extensions/`, `participants/`) |
  | `domain/validation/` | structural validation (`StructuralValidator`, `FlowOrder`), the validator hook, the bpmnlint validator, the `FindingBaseline` a write compares with; `profiles/` holds the engine rules that load on demand |
  | `domain/views/` | the read views (`show`, `find`, `--around`, `--context`) and `render/`, the SVG of a diagram |
  | `domain/batch/` | one batch of commands on a document in memory: `EditBatchService` (guard, commands, validation, layout, kept text, result), `ModelCommandService` hands each model command to its domain service and `BatchDrawing` (`domain/diagram/`) lays the drawing out between them; the top of the domain, nothing imports it back |
  | `application/port/in/` | one contract per use case, the way in: an interface with its `Command` and `Result` (`EditDocumentUseCase`, `RelayoutDiagramUseCase`, `ValidateDocumentUseCase`, `ShowModelUseCase`, ...) |
  | `application/port/out/` | what the application needs from outside, named after what it does: `LoadDocumentPort`, `SaveDocumentPort`, `LoadProjectSettingsPort` (the `.bpmnlintrc`), `WriteImagePort` |
  | `application/service/` | one service per use case that implements its contract (`EditDocumentService implements EditDocumentUseCase`): load, let the domain work, save, all through the outbound ports |
  | `adapters/in/cli/` | the driving adapter: the `Cli` (commander, streams, exit codes, errors) and one class per command; it knows the use cases only by their contracts |
  | `adapters/in/report/` | what a use case's result looks like to the one who asked: text and JSON reports (`MutationText`, `MutationReportBuilder`, `ValidationText`, ...), the views as text, and the reference the guide and `bpmn kinds` print; the CLI prints them and `index.ts` / `api.ts` return them |
  | `adapters/out/files/` | the driven adapters on disk, Node only: `FileDocumentStore`, `BpmnlintProjectSettings`, `FileImageWriter` (PNG) |
  | `adapters/out/memory/` | the driven adapters of the in-memory API: `InMemoryDocumentStore`, `NoProjectSettings` |
  | `types/` | type shims for the bpmn-io packages that ship no usable declarations |

  Where new code goes: a new command is a type in `domain/commands/` and a `...Service` of the
  domain that `domain/batch/` hands it to; a new command line verb or API function is a contract in
  `application/port/in/` and a service that implements it; reading the model without changing
  it is a view (`domain/views/`); deciding positions is `domain/diagram/`; text or JSON for the
  user is `adapters/in/report/`; anything that touches the file system or `process` is an
  adapter behind a port of `application/port/out/`; mapping flags to options and printing a
  command's result is `adapters/in/cli/`. The entries (`cli.ts`, `node.ts`, `api.ts`) create
  the services with their adapters. Every public function that works on a document goes
  through a use case, even one that only forwards to the domain: the library entries
  (`index.ts`, `api.ts`, `node.ts`) import values only from `application/` and `adapters/`, and
  from `domain/` only types, re-exporting just the public classes, constants and pure helpers
  the test lists. `test/architecture.test.ts` checks the rings: the domain
  imports neither the application nor the adapters, the application no adapter, an adapter no
  other adapter (the CLI only the reports), the driving adapter no service, only adapters and entries import `node:*`, the
  domain modules import each other without a cycle, and every service of `application/service/`
  implements its contract and calls no other, and the entries reach the domain only through the
  use cases.

  **Classes first, helpers in `utils/`.** Each module builds on classes, one per file, the file
  named like the class (`domain/document/ModelError.ts`, `domain/diagram/di/DrawingCheckpoint.ts`). Stateless helper
  functions live in the one `utils/` folder of their module (`domain/document/utils/moddle.ts`,
  `domain/document/utils/fuzzy.ts`); a utils file holds no class and imports only other utils files and
  error classes. Outside the entries (`api.ts`, `index.ts`, `node.ts`, which keep the
  package's public functions and delegate to the classes) there are no free functions. The
  domain terms the classes are named after are in [GLOSSARY.md](GLOSSARY.md).
- `test/`: the vitest suite. Its folders mirror the module folders of `src/`
  (`test/domain/batch/`, `test/adapters/in/cli/`, ...): a test sits with the module whose
  interface it exercises. Black-box tests through the entries and the CLI are in `test/e2e/`,
  shared helpers in `test/helpers/`; `test/repo-hygiene.test.ts` keeps it that way. Name a test
  after what it tests, never after the work step that added it. The suite also pins the documentation: the README quick start and the
  examples in `docs/` must match what the CLI prints. `test/helpers/setup.ts` clears `BPMN_KEEP_FLOW_IDS`
  of your shell before every file, so the tests see the CLI's defaults.
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

`bpmn-moddle` (the semantic model; `moddle` for its types), `bpmn-auto-layout` (pinned to
`2.0.0-alpha.2`, loaded only for `--engine auto`), `@resvg/resvg-wasm` (the PNG rasteriser of
`bpmn render`), `commander` (the CLI only), and `bpmnlint` (pinned to `11.15.0`) with
`@miragon/bpmnlint-plugin-rules` (pinned to `0.12.1`: bpmnlint's rules, camunda-compat and
Miragon's rules behind one resolver), loaded only when a `.bpmnlintrc` applies (see
[bpmnlint](docs/bpmnlint.md)). Both are pinned exactly: they decide which findings an agent sees,
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
