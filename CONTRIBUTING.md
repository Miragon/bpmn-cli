# Contributing

Thanks for your interest in `@miragon/bpmn-cli`! Contributions of all kinds are welcome: bug
reports, ideas for commands, docs and code.

## External contributions

We're currently not accepting pull requests from outside the team. We don't have the resources to fully review and validate external contributions, so we can't guarantee that a merged change keeps the project free of bugs, free of security vulnerabilities or malicious code, and consistent with requirements that make sense for it. Pull requests opened by external contributors will be closed.

If you've found a bug or have an idea, please [open an issue](https://github.com/Miragon/bpmn-cli/issues/new) instead. We read every one, and it's the best way to get something onto our radar.

## Getting started

```bash
git clone https://github.com/Miragon/bpmn-cli.git
cd bpmn-cli
npm ci
npm run gate
```

It is a TypeScript CLI and library on npm workspaces, tested with [Vitest](https://vitest.dev/). Node 24
or later is required. `npm run dev -- <command>` builds and runs the CLI.

## Scripts (the quality gate)

`npm run gate` runs everything a change has to pass, cheapest first, and stops at the first failure; each also runs alone:

| script | checks |
| --- | --- |
| `lint` | biome: block statements, function and file size, nested ternaries; errors only |
| `typecheck` | tsc strict over `src/` and `packages/`, and over the tests |
| `structure` | `tools/gate/check-structure.mjs`: classes, free functions, mirrored tests, folders |
| `jscpd` | copied code over 0.25 % |
| `knip` | dead files, exports and dependencies, then test-only code in `src/` |
| `architecture` | dependency-cruiser: layers, entries, package edges, cycles with type imports |
| `check-build` | `tools/gate/check-build/`, one class per check, `-- . budgets`, `iso` or `bundle` runs one group: `budgets.json` (lines per module and package, runtime exports, commands, flag slots, the guide, the coverage floors); Node code in `.` or render's `.` and the browser start imports over their budget; the painter, camunda-compat, bpmnlint or resvg loaded on a write |
| `api` | the public `.d.ts` against the reports in `api-report/`; `npm run api:update` writes them when a change is meant |
| `build` | the bundles, and the help tables written from the catalogues |
| `coverage` | the tests, with 90 % lines and 85 % branches per module and package; raise only |
| `timings` | `--version` over 60 ms; `bpmn add` on a model of 500 nodes over 1.2 times main's time |

CI runs the gate on every pull request and every push to `main`. What each layer holds, the corpus, fuzz
and bench: [docs/testing.md](docs/testing.md). The rules behind them: [how code is cut](#how-code-is-cut).

## How the package is laid out

- `src/`: ten modules, each entered only through its `index.ts`, and `src/index.ts`, the contract. Which
  module does what, and which way imports go: [docs/architecture.md](docs/architecture.md).
- `packages/render` and `packages/lint`: private workspaces whose `exports` point at their TypeScript
  sources, so tsc, vitest and esbuild reach `@miragon/bpmn-render/text` and the others without a build.
- `test/`: mirrors `src/`, one test per class; `test/repo/` proves the guardrails on planted repositories.
- `fixtures/`: every BPMN input of the tests, the fuzz and the bench, all of it synthetic or public.
- `tools/`: the fuzz, the bench, the live engine run and the guardrails' checks.
- `docs/adr/`: the architecture decisions and why they were made.
- `docs/`: the docs site, [miragon.github.io/bpmn-cli](https://miragon.github.io/bpmn-cli/), a
  VitePress site with its own `package.json` and lockfile. `npm --prefix docs ci` once, then
  `npm run docs:dev` serves it with live reload and `npm run docs:build` builds it (a dead link
  fails the build; the `docs` workflow builds it on every pull request that touches `docs/` and
  deploys it from `main`). A new page goes into the sidebar in `docs/.vitepress/config.ts`;
  maintainer notes (`testing.md`, `releasing.md`, the decisions in `adr/`) stay
  out of the site via `srcExclude`. `npm --prefix docs run shots` draws the pictures with the built CLI,
  from the recipes in `docs/shots/`.
  The site is built with the Miragon docs kit: `docs/.vitepress/config.ts` passes the repo's name,
  nav and sidebar to its `miragonDocs()`, and the kit sets the theme, the colours light and dark,
  the GitHub-style heading anchors and the legal row. The kit in `docs/.vitepress/miragon/` and the
  logos in `docs/public/logo/` are vendored unchanged from Miragon's corporate identity (skill
  `docs-site` of the miragon-brand plugin): do not edit them here, `npm --prefix docs run check:kit`
  fails on a hand edit, and the `docs` workflow runs it on every pull request that touches `docs/`.
  `.miragon/brand.json` switches brand-lint on for the docs and the README.
- `plugins/bpmn-cli/`: the Claude Code plugin (see its [README](plugins/bpmn-cli/README.md)).

### Dependencies

Every dependency the final code needs is declared in `package.json`, so a step never touches it. A
private package lists what it loads itself; the core lists the same at the same version, since its
bundles load them at run time, and `test/repo/hygiene.test.ts` holds the two equal. `bpmnlint` and
`@miragon/bpmnlint-plugin-rules` are pinned exactly: they decide which findings an agent sees.

### Where new code goes

- A new operation is one `OperationDefinition` in `src/operations/`; the schema, the parser, the command
  and its flags follow from it. What it does goes into `src/edit/` or `src/drawing/runners/`.
- A new check goes into `src/checks/`, a new layout problem into `src/scoring/` as a `ScoringCriterion`.
- A new read goes into `src/views/` with its text class beside it, and reaches the contract through
  `src/api/index.ts` only when a command needs it.
- `docs/architecture.md` has a section per module; a new module or a renamed class changes it, and
  `test/contract/architecture.test.ts` says so.

### How code is cut

- A type lives with the class that makes it. A private helper is `static` when it reads no state; a
  helper of many classes is a method of their value, such as `Point`, `Box` or `IdSlug`.
- One element is read and changed through `BpmnElement`. `BpmnTree` returns the same one for a moddle
  object on every call, so `===`, `Set` and `Map` hold. No free `is` or `idOf`.
- A catalogue, such as the kinds or the codes, is a class with `static readonly` typed records and query
  methods.
- Nouns for classes, verbs for methods; no `Util`, `Helper`, `Manager`, `Service`, `Impl`, `Base`.
- An interface or abstract class only with two implementations today.
- At most 300 lines per file, 12 public methods and 5 constructor parameters per class, 50 lines and a
  cognitive complexity of 15 per function. A class that does not fit splits into its phases.
- `src/<module>/index.ts` is the only way into a module. A subfolder names a domain concept (`lanes/`,
  `routing/`), holds at most 12 files, sits at most two levels below its module and never imports a value
  from its parent; what two subfolders share sits in a sibling subfolder. `utils`, `helpers`, `common`,
  `shared`, `misc` and `types` are banned names.

`npm run structure` holds the files, classes, sizes and folders, biome the function sizes, and
dependency-cruiser the imports ([architecture](docs/architecture.md#layers)).

## Ground rules

- **Conventional Commits.** Commit messages and PR titles follow
  [Conventional Commits](https://www.conventionalcommits.org/) with one of the types `feat`, `fix`,
  `chore`, `docs`, `refactor`, `ci`, `build`, `test`, `revert`. Releases and the changelog are
  generated from them via [release-please](https://github.com/googleapis/release-please), so a
  `feat` or `fix` title is what users read in the release notes.
- **Documentation moves with the code.** A change to a command, an option or an output also changes
  the matching page in `docs/`.
- **Block style.** The bodies of `if`, `else` and loops are blocks on lines of their own, with
  `} else {` on the closing line. `biome lint` enforces this with the plugin
  `tools/gate/biome/block-statements.grit`.
- **Comments say why, not what.** Names carry what the code does, so a comment that repeats it goes. A
  comment earns its place when it gives the reason something exists or works the way it does and the
  code cannot say it, such as a rule from the BPMN standard or a decision that is easy to undo by mistake.
- One class per file, named like it; a helper of one class is a `private` method, a helper of many a
  method of its value. No free functions but the 8 of the contract, no `utils`, and a mirrored test per
  class. `npm run structure` holds this.

## Before opening a PR

```bash
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

Use the GitHub issue templates. Attaching the `.bpmn` file and the exact command (or the operations JSON
of `bpmn apply`) is by far the fastest path to a fix.
