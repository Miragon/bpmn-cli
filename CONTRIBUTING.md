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
[Vitest](https://vitest.dev/). Node 20+ is required (developed on Node 24).

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

- `src/`: the CLI (`cli.ts`), the in-memory API (`api.ts`, exported from `index.ts`), the ops, the
  layout engine and the Camunda 7 / 8 rules (`platform/`). `src/guide.ts` is the source of
  `bpmn guide`, `bpmn kinds` and `--help`.
- `test/`: the vitest suite. It also pins the documentation: the README quick start and the
  examples in `docs/` must match what the CLI prints. `test/setup.ts` clears `BPMN_KEEP_FLOW_IDS`
  of your shell before every file, so the tests see the CLI's defaults.
- `tools/`: benchmark, fuzzer, layout regression, isomorphism check, descriptor generator.
  `node tools/demo/make-demo.mjs` redraws the README demo (`docs/assets/demo.gif`; needs
  [gifski](https://gif.ski/) on your PATH and network access for the Geist fonts).
- `docs/`: the reference the README links to.
- `plugins/bpmn-cli/`: the Claude Code plugin (see its [README](plugins/bpmn-cli/README.md)).

### Dependencies

`bpmn-moddle` (the semantic model; `moddle` for its types), `bpmn-auto-layout` (pinned to
`2.0.0-alpha.2`, loaded only for `--engine auto`), `@resvg/resvg-wasm` (the PNG rasteriser of
`bpmn render`) and `commander` (the CLI only). Nothing else.

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
  changes `src/guide.ts` and the matching page in `docs/`.

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
