# Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please) and published
to npm as `@miragon/bpmn-cli` with
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). No npm token is stored in the
repository or in GitHub secrets.

## How a release happens

1. Commit to `main` with [Conventional Commits](https://www.conventionalcommits.org/):
   - `fix: …` → patch release
   - `feat: …` → minor release
   - `feat!: …` or a `BREAKING CHANGE:` footer → major release; while the version is `0.x` it bumps the
     minor version instead (`bump-minor-pre-major` in `release-please-config.json`)
   - `docs:`, `chore:`, `ci:`, `test:`, `refactor:` → no release on their own
2. The `release-please` workflow (`.github/workflows/release-please.yml`) keeps a release PR open. The PR
   bumps `package.json`, `.release-please-manifest.json` and `CHANGELOG.md`, and the version of the
   Claude Code plugin (see [The Claude Code plugin](#the-claude-code-plugin)).
3. Merging the release PR creates the tag `vX.Y.Z` and the GitHub release. The `publish` job of the same
   workflow then checks out the tag, runs `npm ci`, `npm run build` and `npm test`, and runs
   `npm publish` with an OIDC token.

The `ci` workflow (`.github/workflows/ci.yml`) runs `npm run typecheck` and `npm run gate` on every pull
request, including the release PRs.

To force a specific version, add a `Release-As: X.Y.Z` footer to a commit on `main`.

## One-time npm setup

Trusted publishing can only be configured for a package that already exists on npm. The first version
(`0.1.0`) is therefore published once by hand. You need publish rights in the npm organisation `miragon`
and two-factor authentication on your npm account.

```
npm login
npm run build && npm publish --access public
npm trust github @miragon/bpmn-cli --file release-please.yml --repo Miragon/bpmn-cli --allow-publish
```

`npm trust` needs npm 11.15 or later. Instead of the command you can also set it up on npmjs.com: in the
package settings, add a trusted publisher for GitHub Actions with organization `Miragon`, repository
`bpmn-cli`, workflow `release-please.yml` and no environment.

Afterwards every release goes through the workflow. Optionally, in the package settings on npmjs.com, set
"Publishing access" to require two-factor authentication and disallow tokens, so that only the trusted
workflow can publish.

## The Claude Code plugin

`plugins/bpmn-cli` (listed in the marketplace `.claude-plugin/marketplace.json`) carries the package's
version. `release-please-config.json` names two `extra-files`, so every release PR also bumps:

- `plugins/bpmn-cli/.claude-plugin/plugin.json` (`json` updater, `$.version`);
- the pinned `npx -y @miragon/bpmn-cli@X.Y.Z` of `plugins/bpmn-cli/skills/bpmn/SKILL.md` (`generic`
  updater: it replaces the version on every line that carries the marker `x-release-please-version`,
  so a new line with a pinned version needs the marker too).

The version is set only in `plugin.json`, not in the marketplace entry. Installed plugins update when
this version changes, so a change to the skill reaches users with the next release, together with the
CLI version it describes (until then the pinned `npx` version is the previous release). The `ci`
workflow's `plugin` job runs `claude plugin validate --strict` on the plugin and the marketplace (no
credentials needed), and `test/plugin.test.ts` fails when `plugin.json`, the pinned `npx` version and
`package.json` disagree.

## Notes

- Requirements for the `publish` job: GitHub-hosted runner, `id-token: write`, npm 11.5.1 or later (the
  job installs the latest npm). `repository.url` in `package.json` must match `Miragon/bpmn-cli` exactly.
- The repository is private, so npm creates no provenance attestation. When the repository becomes
  public, npm adds provenance to trusted publishes automatically.
- release-please uses the default `GITHUB_TOKEN`. Tags and releases created with it do not trigger other
  workflows, which is why `publish` runs as a job of the same workflow, gated on `release_created`.
- The repository setting "Allow GitHub Actions to create and approve pull requests" must stay enabled.
