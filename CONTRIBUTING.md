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
npm run typecheck       # tsc, no emit
npm test                # the vitest suite
npm run gate            # everything a change has to pass before it is handed over
```

`npm run gate` builds, runs the tests, the isomorphism check of the browser-safe core, the
layout-regression budget and a short fuzz campaign. CI runs `typecheck` and `gate` on every pull
request and every push to `main`. The test layers, the benchmark and the fuzzer, and how to run
them on a private corpus without copying it into the repository, are described in
[docs/testing.md](docs/testing.md).

## How the package is laid out

- `src/`: the three entries (`cli.ts`, `api.ts`, the browser-safe `index.ts`) and one folder per
  stage of the pipeline. `src/report/CommandCatalogue.ts` lists every command with its arguments,
  its `--help` text and its guide usage, and the options of every write: the commander wiring in
  `src/commands/` and `bpmn guide` both read it. `src/report/guide.ts` holds the error catalogue
  and the other hand-written tables that `bpmn guide` (`AgentGuide.ts`) and `bpmn kinds`
  (`KindsReference.ts`) print.

  | folder | holds |
  | --- | --- |
  | `shared/` | errors, used everywhere |
  | `model/` | the moddle tree, kinds, the read helpers views and ops share (lanes, nested slots, extensions, decision links), `Doc`, the `ChangeSet` of a mutation, the `FlowRules`, an edit's `IdAllocator` |
  | `ids/` | id words and slugs, the file's id style, the declared id conventions |
  | `xml/` | the text-preserving write, the positional XML reader, the encoding |
  | `platform/` | Camunda 7 / 8 knowledge; `profiles/` holds the engine rules that load on demand |
  | `ops/` | the semantic edits (`add`, `connect`, `set`, ...); `flows/`, `events/`, `extensions/` and `participants/` hold what several of them share, `parsing/` the ops JSON of `apply` |
  | `drawing/` | the drawing (BPMN DI): reading and writing planes, frames, groups, the geometry and the checkpoint every engine shares |
  | `layout/` | the layout engines: `clean/` redraws (`FullLayout`), `incremental/` keeps a hand-made drawing (placers, routers, the space tool); the debug sink |
  | `format/` | the format ops (`place`, `align`, `color`, `label`, `route`, `space`, `tidy`, `compact`) |
  | `render/` | the SVG of a diagram |
  | `validate/` | structural validation (`StructuralValidator`, `FlowOrder`), the validator hook, the bpmnlint validator, the `FindingBaseline` a write compares with |
  | `query/` | the read views: `show`, `find`, `--around`, `--context`, the selectors |
  | `pipeline/` | the transactions: `EditTransaction` (`mutateDoc`) with its `DiagramUpdate`, `Relayout` (`layoutDoc`), `DocCheck` (`checkDoc`) |
  | `report/` | what a command prints, as text and JSON, and the guide |
  | `node/` | the Node-only layer (`@miragon/bpmn-cli/node`): files, the `.bpmnlintrc`, PNG |
  | `commands/` | the CLI: the `Cli` (commander, streams, exit codes, errors) and one class per command |
  | `types/` | type shims for the bpmn-io packages that ship no usable declarations |

  Where new code goes: a change of the model's semantics is an op (`ops/`); reading the model
  without changing it is a view (`query/`); deciding positions is `layout/`, or `format/` when a
  user asks for it; geometry more than one engine needs is `drawing/`; text or JSON for the user
  is `report/`; anything that touches the file system or `process` is `node/`; mapping flags to
  options and printing a command's result is `commands/` (`cli.ts` only starts the `Cli`).
  `test/architecture.test.ts` keeps the root of `src/` to the three entries.

  **Classes first, helpers in `utils/`.** Each stage builds on classes, one per file, the file
  named like the class (`model/ModelError.ts`, `drawing/DrawingCheckpoint.ts`). Stateless helper
  functions live in a `utils/` folder of their stage (`model/utils/moddle.ts`,
  `shared/utils/fuzzy.ts`); a utils file holds no class and imports only other utils files and
  error classes. Outside the entries (`api.ts`, `index.ts`, `node/index.ts`, which keep the
  package's public functions and delegate to the classes) there are no free functions. The
  domain terms the classes are named after are in [GLOSSARY.md](GLOSSARY.md).
- `test/`: the vitest suite. It also pins the documentation: the README quick start and the
  examples in `docs/` must match what the CLI prints. `test/setup.ts` clears `BPMN_KEEP_FLOW_IDS`
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
it is inlined into `src/platform/camunda-descriptor.ts` by `node tools/gen-camunda-descriptor.mjs`
(run it after updating the package; a test fails while the copy differs), so the published package
reads the copy, without the package and without file access. It is never registered with
bpmn-moddle, so camunda content stays untyped and the serialisation is unchanged.
`zeebe-bpmn-moddle` (pinned to `2.0.0`) is the same for Camunda 8: its Zeebe descriptor is inlined
into `src/platform/zeebe-descriptor.ts` by the same tool and read as data (placement and known
names of zeebe content, see [Camunda 8](docs/camunda.md#camunda-8)).

## Ground rules

- **Conventional Commits.** Commit messages and PR titles follow
  [Conventional Commits](https://www.conventionalcommits.org/) with one of the types `feat`, `fix`,
  `chore`, `docs`, `refactor`, `ci`, `build`, `test`, `revert`. Releases and the changelog are
  generated from them via [release-please](https://github.com/googleapis/release-please), so a
  `feat` or `fix` title is what users read in the release notes.
- **Documentation moves with the code.** A change to a command, an option or an output also
  changes `src/report/CommandCatalogue.ts` or `src/report/guide.ts` and the matching page in `docs/`.

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
