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

1.0 is being rebuilt from zero on this branch; [the plan](docs/plan/README.md) is the spec, and each
step fills the skeleton below. It is a TypeScript CLI and library on npm workspaces, tested with
[Vitest](https://vitest.dev/). Node 24 or later is required.

## Scripts (the quality gate)

`npm run gate` runs everything a change has to pass, in this order; each also runs alone:

| script | checks |
| --- | --- |
| `typecheck` | tsc strict over `src/` and `packages/`, and over the tests |
| `lint` | biome: block statements, function size, nested ternaries; errors only |
| `structure` | `tools/check-structure.mjs`: classes, free functions, mirrored tests, sizes, folders, no comments |
| `architecture` | dependency-cruiser: layers, entries, package edges, cycles with type imports |
| `knip` | dead files, exports and dependencies; `knip.ts`'s `TEMPORARY_UNTIL_CODE_USES_THEM` only shrinks, and an entry a step no longer needs fails |
| `knip:production` | test-only code in `src/`; in the gate only with `KNIP_PRODUCTION_GATES=1` until step 13 removes that switch |
| `jscpd` | copied code over 0.25 % |
| `budgets` | `budgets.json`: lines per module and package, runtime exports, the coverage floors |
| `api` | the public `.d.ts` against the reports in `api-report/`; `npm run api:update` writes them when a change is meant |
| `iso` | Node code in `.` or render's `.`; design-iq's import set over its budget |
| `coverage` | the tests, with 90 % lines and 85 % branches per module and package once it holds code; raise only |
| `oracle` | every difference from main that `tools/oracle/differences.json` does not explain |

CI runs the gate on every pull request and every push to `main`. The rules behind it are in
[docs/plan/code.md](docs/plan/code.md).

## How the package is laid out

- `src/`: ten modules, each entered only through its `index.ts`, and `src/index.ts`, the contract:
  [docs/plan/modules.md](docs/plan/modules.md).
- `packages/render` and `packages/lint`: private workspaces whose `exports` point at their TypeScript
  sources, so tsc, vitest and esbuild reach `@miragon/bpmn-render/text` and the others without a build.
- `test/`: mirrors `src/`, one test per class; `test/repo/` proves the guardrails on planted repositories.
- `corpus/`: every BPMN input of the oracle and the tests.
- `tools/`: the oracle and the guardrails' checks.
- `docs/adr/`: the decisions behind the rebuild.
- `docs/`: the docs site, [miragon.github.io/bpmn-cli](https://miragon.github.io/bpmn-cli/), a
  VitePress site with its own `package.json` and lockfile. `npm --prefix docs ci` once, then
  `npm run docs:dev` serves it with live reload and `npm run docs:build` builds it (a dead link
  fails the build; the `docs` workflow builds it on every pull request that touches `docs/` and
  deploys it from `main`). A new page goes into the sidebar in `docs/.vitepress/config.ts`;
  maintainer notes (`testing.md`, `releasing.md`, the audit, the plan in `plan/`) stay out of the
  site via `srcExclude`.
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
  `tools/biome/block-statements.grit`.

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

Use the GitHub issue templates. Attaching the `.bpmn` file and the exact command (or the ops JSON
of `bpmn apply`) is by far the fastest path to a fix.
