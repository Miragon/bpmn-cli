# tools

Scripts that work on the repository, not in the product. Nothing here ships.

## Why a folder of its own

They run at different times, so each time has a folder:

| folder | runs | holds |
| --- | --- | --- |
| `build/` | on every build | the bundles of `dist/` and the help topics |
| `gate/` | in `npm run gate`, on every pull request | structure, API, build budgets, timings, the Biome rule |
| `verify/` | nightly or in its own workflow | fuzz, bench, the live engine run |
| `shared/` | used by `gate/` and `verify/` | the build of main to compare with |

Read [docs/testing.md](../docs/testing.md) for what each check holds.
