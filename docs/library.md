# Library use

The package has two entries:

- **`@miragon/bpmn-cli`**: the core. It runs in Node and in the browser:
  nothing it imports reads a file, `process`, `Buffer` or a Node builtin
  (checked on every change, see [Browser bundles](#browser-bundles)).
  Strings in, strings and data out.
- **`@miragon/bpmn-cli/node`**: the core plus the file helpers the CLI uses
  (Node only).

## The in-memory API

Every function runs the code of the CLI command it names, without a file:

| function | like | returns |
| --- | --- | --- |
| `applyToXml(xml, ops, opts?)` | `bpmn apply` | `EditResult` |
| `newXml(opts?)` | `bpmn new` | `EditResult` |
| `layoutXml(xml, opts?)` | `bpmn layout` | `EditResult` |
| `validateXml(xml, opts?)` | `bpmn validate --json` | `ValidationReport` |
| `viewXml(xml, opts?)` | `bpmn show --json` | `ModelView`, `ElementDetail` (with `id`), `ElementContext` (with `id` and `context: true`), `AroundView` (with `around`), `LayoutView` (with `layout: true`) |
| `showXml(xml, opts?)` | `bpmn show` | the text |
| `metricsXml(xml)` | `bpmn metrics --json` | `{ score, counts, problems }` |
| `findXml(xml, text, { kind? })` | `bpmn find --json` | `FindHit[]` |
| `extensionsXml(xml, id)` | `bpmn ext list <file> <id> --json` | `ExtensionInfo[]` |
| `renderSvg(xml, opts?)` | `bpmn render --format svg` | `RenderResult` |

- `ops` is the [ops JSON](ops.md#ops-json-bpmn-apply) of `bpmn apply`: an array,
  `{ "ops": [...] }`, or the JSON text of either (schema: `OPS_SCHEMA`, also
  `bpmn kinds --json` -> `ops`). It is checked like `apply` checks it
  (`E_USAGE` naming `ops[<i>]`; values are normalised, `"by": "80"` is 80
  pixels).
- Options of the writing functions (`EditOptions`): `layout` (`'auto'`, the
  default, `'incremental'`, `'full'` or `false`, see
  [Layout modes](layout.md#layout-modes)), `engine` (`'clean'` or `'auto'`), `force`,
  `platform` (`'auto'`, `'c7'`, `'c8'`, `'none'`), `validators` (see
  [Validators](validators.md)), `file` (the document's name for the
  validators), `keepFlowIds` (keep the id of every existing sequence flow
  the ops give other ends, like `--keep-flow-ids`; `W_FLOW_ID_STALE` in
  `result.warnings.added` names each one whose id no longer names its
  ends), `conventions` (declared id conventions, see
  [Building blocks](#building-blocks); `result.conventions` names the new ids
  under a prefix they declare that differ from the file's style, in a file
  with ids of its own they reject), `show`
  (add the model view) and `debug` (below). `layoutXml` takes `expand`,
  `collapse` and `tidy` instead of `layout`; `newXml` takes `processName`,
  `processId`, `executable`, `target` and `conventions`; `conventionsXml(xml,
  { conventions, file, severity, notes, where, undeclared })` is `show
  --conventions` (`xml` undefined: a new file; `undeclared` says why none
  are declared); `viewXml` and `showXml` take `id`, `context`, `around`,
  `depth`, `inner`, `scope` and `layout` like `show` (`viewDoc(doc, opts)`
  and `renderShown(view)` do the same on a parsed `Doc`; `aroundView`,
  `elementContext` and `implementationOf` are the builders); `validateXml`
  takes `platform`, `validators` and `file`;
  `renderSvg` takes `plane`, `scale` and `maxSize` (no limit by default;
  `RENDER_MAX_SIZE` is the CLI's 2000), the crops `around: { id, depth?,
  inner? }`, `path: { from, to, via? }`, `scope` and `ids`, `highlight` (a
  list, or `{ created, changed, moved }`: the halo colours `HALO_COLORS`),
  `problems` (`true`, or a list of `LayoutProblem`s to number), `focus`
  (ids: their plane, and only their region when the whole would be
  unreadable) and `tiles`, and returns `{ svg, width, height, scale, tokens,
  plane, planes, notes, problems, nodes?, tiles? }` (`renderDocSvg(doc,
  opts)` draws a parsed `Doc` without the in-memory layout;
  `changeHighlight(result)` turns a mutation result into the `{ created,
  changed, moved }` highlight `--render` uses; `locateProblems(definitions,
  problems)` adds where each layout problem shows, `at: { plane, x, y }`).
- `EditResult` is `{ xml, unchanged, result }`: the new document, which
  keeps the input's text wherever the ops changed nothing ([What a write
  changes](contract.md#what-a-write-changes)); `unchanged` is `true` when it is
  byte-identical to the input (then `xml` is the input string itself and
  there is nothing to save; a rename to the current name, `tidy` on a tidy
  drawing); `result` is what the CLI prints with `--json`
  ([Output](reference.md#output-errors-and-exit-codes)) without `file`, `written` and the
  XML: the warnings as a delta (`result.warnings.added`, `resolved`,
  `preexistingCount`; with batch aliases, `result.aliases` maps each to the
  final id of its element). `renderMutation(result)` gives the CLI's text for it,
  `mutationSummary(result)` / `renderSummary(summary, { advisory:
  advisoryValidators(result) })` the `--summary` form (`advisory`: the names
  of the advisory validators, whose findings group by code and message as on
  the command line; the summary does not keep the validators, so
  `renderSummary` cannot tell them itself), `renderValidation(report)` the
  text of `validate`.
- The CLI's guards apply: a lossy import (`E_IMPORT_LOSSY`), validation
  errors the ops would introduce (`E_VALIDATION`, also those of
  `validators`) and content a retype would delete
  (`E_WOULD_DROP_CONTENT`) are refused unless `force: true`. The layout
  modes, the format ops, the file's id style for new ids
  ([Ids](reference.md#ids)) and the platform profile's new findings
  (`result.validation.platform`) work as on the command line.
- A failure throws a `CliError`: `code`, `category`, `details` (`element`,
  `related`, `candidates`, `hint`, `op`; `E_NO_ROOM` also `ops` and, when
  the refused op saw the document's own drawing, `command` with `<file>`
  for the file; `E_VALIDATION` also `errors`, the errors the change would
  add, which a check of the unchanged document does not show); `toJSON()`
  is the CLI's `--json` error. Nothing is half done: the caller still has
  its input.
- The Camunda 7 and Camunda 8 profile rules load on demand: the first call
  that validates a document of that platform loads them (`import()`, a
  chunk of its own in a host's bundle, see [Browser bundles](#browser-bundles));
  plain BPMN, design models and `platform: 'none'` never load them. The
  signatures stay the same. A host that wants the chunk before the first
  edit prefetches it when it opens a file: `await
  loadProfile(detectPlatform(doc).platform)` (or `loadProfile('c7')` /
  `loadProfile('c8')`; `'none'` resolves at once). The rule chunks import
  nothing, so a host's entry module may await these calls (and
  `loadProfile`) at top level. A chunk that cannot be loaded rejects the
  call with `E_PROFILE_LOAD` (category `io`) before a result exists. The
  library does not keep the failure: a later call imports the chunk again,
  which loads it in Node, but a browser may keep the failed module fetch
  until the page reloads (Chrome does).
- A call with `engine: 'auto'` (`layoutXml`, a full redraw of
  `applyToXml`) loads bpmn-auto-layout on demand. Its chunk imports
  `bpmn-moddle`, which Rollup / Vite put into the host's entry chunk, so a
  host built with them must not await such a call in the top-level await
  of its entry module (it hangs there, as in 0.4): call it from a function
  or an event handler.

```ts
import { applyToXml, CliError, newXml, renderMutation, showXml } from '@miragon/bpmn-cli';

let { xml } = await newXml({ processName: 'Order handling' });
const edit = await applyToXml(xml, [
  { op: 'add', kind: 'start', name: 'Order received' },
  { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'Event_OrderReceived' },
  { op: 'add', kind: 'end', name: 'Done', after: 'Activity_CheckInvoice' },
]);
if (!edit.unchanged) xml = edit.xml; // and save it
edit.result.created.map((c) => c.id); // ['Event_OrderReceived', 'Activity_CheckInvoice', 'Flow_OrderReceivedToCheckInvoice', 'Event_Done', 'Flow_CheckInvoiceToDone']
edit.result.layout.mode;              // 'full' (no diagram before: drawn from scratch)
renderMutation(edit.result);          // the text `bpmn apply` prints: created ... / layout: ok - full (...)
await showXml(xml);                   // the `bpmn show` text of the README quick start

try {
  await applyToXml(xml, [{ op: 'add', kind: 'userTask', name: 'Ship', after: 'Activity_Check' }]);
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  err.code;               // 'E_NOT_FOUND'
  err.details.candidates; // ['Activity_CheckInvoice']
}
```

The layout engines' diagnostic lines (placement candidates, reroute reasons,
`[strip]` / `[rows]` lines) go to a `debug: (line) => ...` option of one
call, or to `setLayoutDebug(sink)` for the whole process; the CLI sets the
latter when `BPMN_LAYOUT_DEBUG=1` and writes them to stderr.

## File helpers (`@miragon/bpmn-cli/node`)

`readXml(file)` and `readDoc(file)` (`E_FILE_NOT_FOUND`, `E_IO`, `E_PARSE`;
no lossy-import guard), `loadDoc(file, { force })` (`E_IMPORT_LOSSY`),
`writeAtomic(file, text)` (temp file, then rename; `E_IO` without a temp file
left when it fails), `mutateFile(file, ops,
opts)` (typed ops, what every mutating command runs), `mutateDocToFile(doc,
ops, opts)` (`new`), `layoutFile(file, opts)` (`layout`), `layoutDocToFile(doc,
opts)` (`layout` on a loaded document, e.g. one read from stdin),
`checkFile(file, { platform, validators })` (`validate`) and
`checkLoadedDoc(doc, opts)` (`validate -`: a document without a file).
`FileMutationOptions` adds the file options to the core options: `out`,
`dryRun`, `backup` and `mustNotExist` (`E_FILE_EXISTS` unless `force`); the
result says `written: true` and names the file. A result equal to the file
it was read from is not written back (`written: false`, `unchanged: true`;
`out` to another file still writes the copy). The helpers tell the
validators the file they write or check (`ctx.file`, the `out` target with
`out`) unless `file` names another.

The project's bpmnlint ([bpmnlint](bpmnlint.md)): every file helper runs
the nearest `.bpmnlintrc` above the file it writes or checks (up to the
repository root, whoever owns it; outside a git repository only the file's
directory; the path as given, then the physical directory where the
file's directory is reached through a symbolic link; a linked file counts
by the directory of the link) as an advisory validator,
`FileBpmnlintOptions`:
`lintConfig` (a path, relative to `lintFrom`; `false` runs nothing),
`lintFrom` (where a document without a file looks it up, and the base of
the paths in messages; without it such a document gets no lookup),
`lintBlocks` (errors bpmnlint finds in the change block the write with
`E_VALIDATION`; default false) and `lintProjectCode` (run plugins the
project installed, inside a git repository of the user running the host,
by owner as git checks it, not git's `safe.directory`, and on Windows only
inside the home directory; elsewhere a plugin is left out with
`W_LINT_UNAVAILABLE` and the rest of the `.bpmnlintrc` runs; default false,
so a library host runs only what bpmn-cli ships; the CLI passes true). A
host that passes its own validator named `bpmnlint` gets no second one. The
parts: `findBpmnlintConfig(dir)`,
`loadBpmnlint(path, { explicit, projectCode, from })` (cached on the file's
text and on what it left out or read from the project: a plugin or moddle
package installed after the hint, also inside the repository after one
above it was found, a failed plugin fixed or reinstalled and an edited
moddle descriptor are loaded by the next call; a project plugin that loaded
stays in Node's require cache until the host restarts, and so does the
`package.json` of a failed plugin whose reinstall moved its entry module;
`engine.resolver` is the resolver chain, `used` says which tier answered
what),
`projectBpmnlint(file, opts)` (the validator, or undefined),
`projectBpmnlintSettings(file, opts)` (the effective rule settings: the
same lookup, flags and errors), `projectIdConventions(file, opts)` (the id
conventions of its `element-id-naming`, its `W_CONFIG_IGNORED` notes, the
`W_LINT_UNAVAILABLE` of what it leaves out, the rule's setting, and
`unavailable` where the `.bpmnlintrc` could not be loaded; the file helpers
pass these conventions to the core unless the host passes `conventions`
itself or a validator named `bpmnlint` of its own) and `bpmnlintEngine()`
(bpmnlint's `Linter` with the offline part of that chain: the plugin's
bundled resolver, then the camunda-compat bpmn-cli ships, so every
camunda-compat config resolves, no project code; and the plugin:
`getDefaultLintConfig`, `naming`).

`renderPng(xml, opts)` is `bpmn render` without the file: the options of
`renderSvg` (`maxSize` defaults to 2000) and `{ images: [{ png, width,
height, tokens, columns?, band? }], scale, plane, planes, notes, problems,
nodes? }` (one image, or one per tile; `png` is a `Uint8Array`). It loads `@resvg/resvg-wasm` on the first call and draws text
with the bundled Arimo font only; a rasteriser failure is a `CliError` with
`E_RENDER`.

## Building blocks

The in-memory API is made of exported parts. `Doc` (`Doc.fromXml(xml)`,
`Doc.create({ target })` with `TARGETS`; query the model;
`doc.followFlowEnds = false` keeps the ids of the flows the document had
before the call (a flow the call creates still follows its ends), which
`MutationOptions.keepFlowIds` sets for one call), `parseOps` and
`OPS_SCHEMA`, `runOps` (the ops alone, without any guard; with flow ids
kept it reports `W_FLOW_ID_STALE` too), the pipeline on a
`Doc`: `mutateDoc(doc, ops, opts)` / `layoutDoc` / `checkDoc` (never write;
`written` is `false`; typed ops, not checked by `parseOps`: a `split` checks
the shape of its `branches`, their `nodes` and each node's `kind` itself and
refuses a bad one with `E_USAGE` in `parseOps`' words before the split
changes anything, while the ops before it in the batch have run; missing or
empty `branches` stay `E_INVALID_VALUE`), with the types
`MutationOptions`, `MutationResult`, `LayoutMode`, `LayoutStatus` and
`LAYOUT_MODES`, and `assertLossless`. What the CLI prints: `mutationReport`,
`mutationWarnings`, `validationReport`, `renderMutation`, `renderValidation`,
`renderView`, `renderDetail`, `renderLayoutView`, `renderFind`,
`renderMetrics`, `renderExtensionList`, `renderProblems`; `guideText`,
`kindsText`, `kindsJson` and `ERROR_CATALOGUE`. Views: `validateDoc`,
`buildView` / `scopeView` / `elementDetail` / `findElements`, `layoutModel`
and the `KINDS` vocabulary. The diagram API: `layoutProblems` /
`layoutProblemsOfXml` / `diffProblems` / `metricsDelta` (layout metrics with
ids, `METRIC_KEYS`, `METRIC_WEIGHTS`), `layoutView` (what `show --layout`
prints), `runFormatOps` (the format operations on a loaded document;
`FORMAT_OP_NAMES`, `isFormatOp`, the op types `PlaceOp`, `AlignOp`,
`ColorOp`, `LabelOp`, `RouteOp`, `SpaceOp`, `TidyOp`) and the colour palette
`SWATCHES`. The platform profile: `validateDoc(doc, { platform: 'auto' |
'c7' | 'c8' | 'none' })` (findings among the warnings, `result.platform`
with the platform, its source and the counts), `MutationOptions.platform`
(default auto; `'none'` switches it off; an explicit choice also decides the
engine rules of the ops, e.g. which event-gateway rule a bridge follows, and
the spelling of a decision link: with `'none'` a link keeps its engine
spelling and a new one follows the file's, [Set keys](reference.md#set-keys)),
`runProfile`, `detectPlatform`, `PLATFORM_CHOICES` and the types
`ProfileFinding`, `PlatformSummary`, `Severity`; `listExtensions` /
`listAllExtensions` (what `ext list` prints). `runProfile` and
`validateDoc(doc, { platform })` are synchronous and need the rules of the
platform they check loaded: `await loadProfile(platform)` (`'c7'`, `'c8'`;
`'none'` resolves at once; cached) or `await loadProfiles()` (both; or
`loadProfiles(['c7'])`) once before them, otherwise they throw
`E_PROFILE_NOT_LOADED`. `mutateDoc`, `checkDoc` and the in-memory API load
the rules themselves.

Validation in the transaction (see [Validators](validators.md)):
`MutationOptions.validators` / `CheckOptions.validators` (also `validators`
of `applyToXml`, `validateXml` and `checkFile`) with the types `Validator`,
`ValidatorFn`, `NamedValidator`, `ValidatorFinding`, `ValidatorContext`,
`ValidatorIssue`, `ValidatorReport`, `ValidatorSeverity`. A finding a write
should not compare carries `ValidatorFinding.leftOut` (a reason); the report
counts it and lists it in `ValidatorReport.leftOut`, the summary in
`MutationSummary.leftOut` (see [Left out](validators.md#left-out)).
`decisionLinkOf(element, doc)` reads a business rule task's decision link in
any spelling.

A bpmnlint configuration as an advisory validator (`blocks: false`, see
[Advisory validators](validators.md#advisory-validators)):
`resolveBpmnlintConfig(engine, config, { moddleExtensions })` (`extends`
flattened, every rule resolved once; what cannot be resolved is in
`unavailable`; a moddle extension the configuration names by module path
needs its descriptor in `moddleExtensions`, else it is in `unavailable`
too, and so is a descriptor `BpmnModdle` rejects),
`bpmnlintValidator(engine, resolved, { detail, blocks })`
(`BPMNLINT_VALIDATOR` is its name, `BPMNLINT_COVERS` the lint warnings it
replaces). The core does not import bpmnlint: `engine` is
`{ Linter, resolver }`. In Node, `bpmnlintEngine()` from
`@miragon/bpmn-cli/node` gives it (it requires the plugin's CJS build, and
bpmnlint from the plugin's own location, so the `Linter` and the rules are
one bpmnlint; its resolver answers synchronously, like the bundled one, and
also resolves the camunda-compat configs the bundle lacks,
`camunda-cloud-8-5`, `camunda-platform-7-20`); a browser host bundles
`bpmnlint`'s `Linter` and the plugin's `createBundledResolver()` itself,
which knows only `camunda-platform-7-24` and `camunda-cloud-8-10` of
camunda-compat:

```ts
import { applyToXml, bpmnlintValidator, resolveBpmnlintConfig } from '@miragon/bpmn-cli';
import { bpmnlintEngine } from '@miragon/bpmn-cli/node';

const engine = bpmnlintEngine();
const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended' });
const lint = bpmnlintValidator(engine, resolved, { detail: 'our rules' });
const edit = await applyToXml(xml, ops, { validators: [lint] });
edit.result.warnings.added; // the bpmnlint findings the change added, an error with severity 'error'
```

Declared id conventions: `idConventionsFromLint(setting, naming, { source })`
reads the effective setting of `@miragon/rules/element-id-naming`
(`resolved.rules[ID_NAMING_RULE]`) as the rule reads it, with the plugin's
naming helpers (`engine.plugin.naming`; injected, the core does not import the
plugin), and returns `conventions` (`IdConventions`: plain data, a prefix per
BPMN type and per event type and trigger, `case`, `qualifier`, `source`) and
its `W_CONFIG_IGNORED` notes (pass them to `bpmnlintValidator` as `notes`). A
host that lints with a configuration that turns the rule on (the engine
defaults `getDefaultLintConfig({ engine: 'c7' | 'c8' })` and the automation
preset do) passes the conventions of that same configuration, or its own
lint reports bpmn-cli's new ids. Helpers of a plugin before 0.12.1 work too,
but that plugin's rule cannot check a `case` named after a property of
JavaScript's Object (`toString`, `__proto__`): new ids take PascalCase, and
the note says the rule cannot check it. Without the plugin, a table of your
own works too ([bpmnlint](bpmnlint.md#id-conventions) has the rules):

```ts
const automation = await resolveBpmnlintConfig(engine, engine.plugin.getDefaultLintConfig({ preset: 'automation' }));
const { conventions, notes } = idConventionsFromLint(automation.rules[ID_NAMING_RULE], engine.plugin.naming, { source: 'our rules' });
const named = await applyToXml(xml, ops, { validators: [bpmnlintValidator(engine, automation, { notes })], conventions });
named.result.conventions; // { ids: [...], source: 'our rules' }: the new ids that follow the rule, not the file's style
await applyToXml(xml, ops, { conventions: { prefixes: { 'bpmn:ServiceTask': 'serviceTask_', 'bpmn:SequenceFlow': 'flow_' }, case: 'camelCase' } });
```

Text preservation: `mutateDoc` returns the text to store as `result.xml`:
the original text of everything the ops did not change (see [What a write
changes](contract.md#what-a-write-changes)); `result.unchanged` is true when it equals
the input (the file helpers then do not write over the file: `written:
false`). `Doc.fromXml` keeps what it read as `doc.source` (`DocSource`: the
text and the incoming / outgoing lists as read); `preserveText(original,
asRead, changed)` is the text-preserving step on its own, for a host that
serialises a model itself (two serialisations by bpmn-moddle, of the model as
read and as changed).

## Browser bundles

`npm run gate` (and so CI) runs `tools/iso/check.mjs` after the build: it
bundles `dist/index.js` with esbuild for `platform=browser` and fails on an
import of a Node builtin or a reference to `process`, `Buffer`, `global`,
`require`, `__dirname`, `__filename` or `setImmediate`, naming the module; it
also checks that both entries and their types resolve for a strict
TypeScript consumer (`skipLibCheck: false`, no `@types/node`).
`test/isomorphic.test.ts` runs the browser bundle in a vm context without any
Node global and compares `applyToXml` (also with host validators and
bpmnlint with an injected engine), `layoutXml` (both engines), `validateXml`, `showXml`,
`findXml`, `metricsXml` and `renderSvg` with Node, byte for byte; it also loads an ESM
split bundle and checks which profile chunks a call loads.

The Camunda 7 and Camunda 8 profile rules are chunks of their own: a host's
bundler (Vite, esbuild, webpack) turns their `import()` into a file that is
fetched the first time a document of that platform is validated. A plain
BPMN file or a design model loads neither, a Camunda 7 file only the
Camunda 7 rules, a Camunda 8 file only the Camunda 8 rules, and
`platform: 'none'` nothing. A bundler that inlines dynamic imports (an IIFE
bundle, `vite-plugin-singlefile`) keeps them in the one file, as in 0.4.
The rule modules import nothing of the core (the loader hands them what
they use), so their chunks import nothing, not even the host's entry chunk:
a host whose entry module awaits a Camunda 7 / 8 call at top level does not
wait for itself. The check fails when a rule module is in the initial
chunks or imports a module the entry loads, naming it, and when a size is
over its budget in `tools/iso/budget.json` (raising a budget is an explicit
change of that file).

Sizes (esbuild, `platform=browser`, minified / gzip, KB = 1024 bytes, split
like a host's bundler would; `node tools/iso/check.mjs --table` prints this
table):

| bundle | minified | gzip | budget (tools/iso/budget.json) | loads |
| --- | ---: | ---: | ---: | --- |
| everything `@miragon/bpmn-cli` exports | 996.6 KB | 320.0 KB | 997 / 321 KB | with the entry |
| `applyToXml` only (tree-shaken) | 713.3 KB | 229.8 KB | 714 / 230 KB | with the entry |
| Camunda 7 rules (`platform/c7`) | 56.3 KB | 17.0 KB | 58 / 18 KB | on demand: the first Camunda 7 document a call validates (`loadProfile('c7')` prefetches it) |
| Camunda 8 rules (`platform/c8`, `platform/feel`, `platform/schema-text`) | 78.8 KB | 23.1 KB | 80 / 24 KB | on demand: the first Camunda 8 document a call validates (`loadProfile('c8')` prefetches it) |
| bpmn-auto-layout | 82.1 KB | 28.0 KB | none | on demand: only for `engine: 'auto'` |

The SVG renderer (`renderSvg` with its crops, halos, numbered problems and
tiles) is about 31 KB minified of the whole entry, `locateProblems` 3.7 KB;
a host that imports only `applyToXml` loads neither (that bundle is
byte-identical with or without them). The PNG
rasteriser (`@resvg/resvg-wasm`, 2.5 MB of WebAssembly, and the 21 KB font)
is only in `@miragon/bpmn-cli/node`, and so are bpmnlint and
@miragon/bpmnlint-plugin-rules: the core's bpmnlint validator (about 7 KB
of the whole entry) gets them injected, and so does `idConventionsFromLint`
(about 6 KB of the whole entry, with the view of `show --conventions`; not in
the `applyToXml`-only bundle, which carries what applies declared
conventions to new ids, about 12 KB).

`package.json` declares only the CLI files as having side effects, so a
bundler drops what a host does not import. The guide is the exception:
importing any one of `guideShort`, `ERROR_CATALOGUE`, `kindsJson`,
`kindsText` or `guideText` adds 124 to 153 KB minified (38 to 47 KB gzip)
to `applyToXml`.
