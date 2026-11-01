# Code, tests and guardrails

How is code cut into classes, how do tests follow them, and which checks hold the cut? The rules hold
from the rebuild's first commit, so no exception list is needed. Today one class per file holds (320
of 320), but 84 `utils` files hold 4,934 lines, and no class has a test at its own path.

## Classes

- One class per file, named like it; a type lives with the class that makes it.
- A helper of one class is a `private` method, `static` when it reads no state.
- A helper of many is a method of its value: `geom.ts` becomes `Point`, `Box`, `Segment`, `Polyline`;
  `slug.ts` becomes `IdSlug`; `PlaneQuery`'s 8 statics become methods of `Plane`.
- One element is read and changed through `BpmnElement`, a wrapper around one moddle object (`is`, `id`,
  `name`, `children`, `add`, `remove`). `BpmnTree` makes one per object and returns the same one on every
  call, so `===`, `Set` and `Map` hold; the tree is read through `BpmnTree` (`walk`, `byId`, `processes`,
  `enclosingProcess`, `containerOf`). No free `is` or `idOf`.
- A catalogue (kinds, codes) is a class with `static readonly` typed records and query methods.
- The only free functions are the 8 of the contract, one line each into a class.
- Nouns for classes, verbs for methods; no `Util`, `Helper`, `Manager`, `Service`, `Impl`, `Base`.
- Size limits: at most 300 lines per file; 12 public methods and 5 constructor parameters per class; 50
  lines and cognitive complexity 15 per function.
- An interface or abstract class only with two implementations today; `Validator` qualifies.
- No comments; block statements for every `if`, `else` and loop.

The size limits are strict on purpose: main has 395 findings at them, most in the layout routers. A
router that does not fit splits into its phases. If the drawing step's first commit shows that this fails,
the limit changes for all.

Folders: `src/<module>/index.ts` is the only way in. A subfolder names a domain concept (`lanes/`,
`routing/`), has at most 12 files, sits at most two levels deep and never imports a value from its parent.
`utils`, `helpers`, `common`, `shared`, `misc` and `types` are banned names.

## Tests

- Mirror: `src/edit/ElementCreation.ts` has `test/edit/ElementCreation.test.ts`,
  `describe('ElementCreation')`; a package mirrors its own `src/` in its own `test/`. Only `test/e2e/`,
  `test/contract/`, `test/corpus/`, `test/repo/`, `test/support/` and render's `test/golden/` mirror no
  class; the [guardrails](#guardrails) say what each holds.
- `src/api/index.ts` holds no class, so `test/contract/TheContract.test.ts` holds it.
- A mirrored test imports by value its class and the classes of its own module that build its input in
  production. It reaches another module only through `test/support/`: one `Fixtures` class that reads
  `corpus/` into a `BpmnDocument`, plus builders of values, at most 12 files.
- No mocks inside a module; fakes only for files, engine REST and the clock.
- A case is one behaviour of a public method, named as a sentence about BPMN.
- Per public method: the main path, each refusal code, each boundary BPMN names (empty, first lane,
  nested host), each fixed bug by its behaviour.
- Not tested: private methods, plain getters, types, what moddle or commander do, one behaviour twice.
- Layout tests assert invariants and order (no overlap, inside its lane), not pixels.
- Verdict tables stay data in `corpus/engine/`: the models of 8 test files that carry 421
  recorded engine verdicts, and 762 FEEL expressions. Each row names the class whose rule it tests, and that class's mirrored test runs its
  rows in one `it.each`, so no row runs twice. An `OperationDefinition`'s mirrored test runs its accepted and
  refused operation examples the same way.
- The layout's rows stay data in `corpus/layout/`: the 115 scenarios with main's scores, which
  `FullLayout`'s mirrored test draws and holds in total to main's, and main's counts per kind on every
  corpus file, which `Scorer`'s mirrored test matches.
- About 1 to 3 cases per public method; a class with more than 20 cases splits. Below write and in
  `packages/lint`, inputs are BPMN fixtures, never the edit API; a drawing test takes a before and an
  after fixture. An `it.each` over corpus rows counts as one case.

## Guardrails

Each catches what a unit test cannot see. All are hard gates but the last row, a trend.

| guardrail | catches |
| --- | --- |
| `test/e2e/`: CLI in-process, one file per command group, one spawn smoke test | flags, exit codes, stdout, files; a text result over 1 KB |
| `test/contract/`: design-iq's recorded calls | a consumer's calls break |
| `test/corpus/`: golden corpus, property test | a no-op changes bytes; incomplete DI, nondeterminism; a drawn shape that bpmnlint's `standard-size` reports |
| [oracle](rebuild.md#oracle) | a difference from main, after 1.0 from the last release |
| render's `test/golden/`, ≈ 20 SVGs | a shape or colour changes |
| tsc strict | type errors |
| biome with the block statement plugin, errors only | the function size limits, nested ternaries |
| `tools/check-structure.mjs` | a `utils` file or folder; 0 or 2 classes in a file other than an `index.ts`, whose only code is re-exports or, in api, the 8 functions; a class without its mirrored test or a test without its class; a mirrored test importing a value of another module except through `test/support/`; the file and class size limits; a class with only static members, other than a catalogue |
| dependency-cruiser | an import against the layers, inside a layer, past an `index.ts` or in a cycle; Node builtins outside cli, `packages/lint` and the Node entry of render's `./png`; a package importing the core, or its tests importing outside the package; `packages/lint` imported by anything but cli; `checks/structure/` and `checks/camunda/` importing each other; scoring importing anything but model and render's `./text`, or imported by anything but drawing, write and views; bpmnlint, or any plugin entry but `@miragon/bpmnlint-plugin-rules/naming`, loaded outside `packages/lint`, but for the rule `standard-size` in `ShapeSizes`' test and `test/corpus/` |
| knip, twice | dead files, exports, dependencies; test-only code in `src/` |
| API Extractor per package | a public symbol changes; more than 10 runtime exports in the core |
| iso check | Node code in `.` or render's `.`; design-iq's import set over 810 KB |
| v8 coverage | untested branches below 90 % lines, 85 % branches per module and package; raise only |
| `budgets.json` | lines per module and package, exports, commands, flag slots or the guide's 20 KB grow; the lines start at the estimates of the [modules](modules.md#modules) table, and raising one needs a reason in the commit |
| jscpd | copied code over 0.25 % |
| `test/contract/`: spy test, result fixtures | over 2 parses or 3 serialisations per write |
| esbuild metafile | the painter (render's `.` or `./png`), camunda-compat or bpmnlint loaded on a write |
| `FullLayout`'s scenario rows, 115 models of `corpus/layout/` | their total above main's, a budget that only falls; it lists each scenario that scores higher |
| `test/contract/`: names test | the skill, the guide or a hint the corpus produces names a command or flag 1.0 lacks; `docs/architecture.md` lacks a module or names a class that does not exist |
| `test/repo/`: hygiene | private paths, control bytes; a dependency of a private package that the core lacks or pins at another version |
| a live run over `corpus/engine/` when it or a pinned engine version changes, and once on the release candidate | our checks and Camunda drifting apart |
| timings, nightly fuzz, bench | slow calls, rare crashes |

The gate step sets the static guardrails (tsc, biome, the structure check, dependency-cruiser, knip, API
Extractor, iso, coverage, budgets, jscpd, hygiene) and wires in the oracle; knip's production run turns
green once write, views and api import the modules, in step 13. Each suite joins the gate in the commit
that builds what it reads: `test/corpus/` with model, render's golden SVGs with render, the live job with checks, `Scorer`'s rows with
scoring, the scenario rows with drawing, `test/contract/` with write, views and api, and `test/e2e/`, the metafile, timings, fuzz
and bench with the CLI. The names test reads the guide and hints from the CLI step, and the skill and
`docs/architecture.md` from the skill and docs step.

- Dropped: every `warn` level (nobody reads 327 warnings); fuzz in the gate (the property test covers
  its invariants); the test layout part of `repo-hygiene.test.ts` (the structure check replaces it).
- Not added: mutation testing; it costs minutes per run for what the cases per public method ask anyway.
- jscpd stays: dependency-cruiser checks imports, not copies, and a port invites copies. Coverage costs
  ≈ 20 % more test time.
