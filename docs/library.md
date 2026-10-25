# Library use

bpmn-cli as a package, for tools that embed it, such as a modeler or design-iq. Agents and
scripts use the CLI.

## Quick start

```sh
npm install @miragon/bpmn-cli
```

The functions take the XML as a string and return the new XML with the result the CLI prints:

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

A failure throws a `CliError` (`code`, `details`, `toJSON()` for the CLI's `--json` error). Nothing
is half done: the caller still has its input.

## Two entries

| entry | runs in | holds |
| --- | --- | --- |
| `@miragon/bpmn-cli` | Node and the browser | the core: strings in, strings and data out |
| `@miragon/bpmn-cli/node` | Node only | the core plus the file helpers the CLI uses |

## The in-memory API

Every function runs the CLI command it names, without a file:

| function | like |
| --- | --- |
| `applyToXml(xml, ops, opts?)` | `bpmn apply` |
| `newXml(opts?)` | `bpmn new` |
| `layoutXml(xml, opts?)` | `bpmn layout` |
| `validateXml(xml, opts?)` | `bpmn validate --json` |
| `viewXml(xml, opts?)`, `showXml(xml, opts?)` | `bpmn show --json`, `bpmn show` |
| `findXml(xml, text)` | `bpmn find --json` |
| `renderSvg(xml, opts?)` | `bpmn render --format svg` |

`ops` is the [ops JSON](ops.md#ops-json-bpmn-apply) of `bpmn apply`. A writing function returns
`{ xml, unchanged, result }`: `unchanged` is `true` when there is nothing to save, `result` is what
the CLI prints with `--json`. `renderMutation(result)` gives the CLI's text.

### Options

| option | values | CLI |
| --- | --- | --- |
| `layout` | `'auto'` (default), `'incremental'`, `'full'`, `false` | `--layout`, `--no-layout` |
| `engine` | `'clean'` (default), `'auto'` | `--engine` |
| `force` | write despite a guard | `--force` |
| `platform` | `'auto'`, `'c7'`, `'c8'`, `'none'` | `--platform` |
| `keepFlowIds` | keep flow ids; `W_FLOW_ID_STALE` names each stale one | `--keep-flow-ids` |
| `validators` | host validators ([Validators](validators.md)) | none |
| `conventions` | declared id conventions (below) | the `.bpmnlintrc` |

The full signatures ship as TypeScript types with the package.

::: warning engine: 'auto' and top-level await
`engine: 'auto'` loads bpmn-auto-layout on demand. A host bundled with Rollup or Vite must not
await such a call at the top level of its entry module (it hangs): call it from a function.
:::

## File helpers (`@miragon/bpmn-cli/node`) {#file-helpers-miragon-bpmn-cli-node}

| helper | runs |
| --- | --- |
| `mutateFile(file, ops, opts)` | what every mutating command runs |
| `layoutFile(file, opts)` | `bpmn layout` |
| `checkFile(file, { platform, validators })` | `bpmn validate` |
| `loadDoc(file, { force })` | read a file with the lossy-import guard |
| `writeAtomic(file, text)` | write a temp file, then rename it |

They add `out`, `dryRun` and `backup`, and run the project's `.bpmnlintrc` as an advisory
validator like the CLI ([bpmnlint](bpmnlint.md)). Plugins the project installed run only with
`lintProjectCode: true`.

## Building blocks

A host that keeps a parsed model between calls uses the pipeline on a `Doc`:
`Doc.fromXml(xml)`, then `mutateDoc(doc, ops, opts)`, `layoutDoc`, `checkDoc`. They never write.
Every other part (views, metrics, format ops, the platform profile) is exported too.

::: warning Load the profile rules before runProfile
`runProfile` and `validateDoc(doc, { platform })` are synchronous: call `await loadProfiles()`
once before them, otherwise they throw `E_PROFILE_NOT_LOADED` on a Camunda 7 / 8 document.
`mutateDoc`, `checkDoc` and the in-memory API load the rules themselves.
:::

### bpmnlint as a validator

A bpmnlint configuration as an advisory validator ([Validators](validators.md#advisory-validators)).
In Node `bpmnlintEngine()` gives the engine; a browser host bundles bpmnlint's `Linter` itself.

```ts
import { applyToXml, bpmnlintValidator, resolveBpmnlintConfig } from '@miragon/bpmn-cli';
import { bpmnlintEngine } from '@miragon/bpmn-cli/node';

const engine = bpmnlintEngine();
const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended' });
const lint = bpmnlintValidator(engine, resolved, { detail: 'our rules' });
const edit = await applyToXml(xml, ops, { validators: [lint] });
edit.result.warnings.added; // the bpmnlint findings the change added, an error with severity 'error'
```

### Declared id conventions

A host whose lint runs `@miragon/rules/element-id-naming` passes the same configuration's
conventions, or its lint reports bpmn-cli's new ids. A table of your own works too
([bpmnlint](bpmnlint.md#id-conventions) has the rules):

```ts
const automation = await resolveBpmnlintConfig(engine, engine.plugin.getDefaultLintConfig({ preset: 'automation' }));
const { conventions, notes } = idConventionsFromLint(automation.rules[ID_NAMING_RULE], engine.plugin.naming, { source: 'our rules' });
const named = await applyToXml(xml, ops, { validators: [bpmnlintValidator(engine, automation, { notes })], conventions });
named.result.conventions; // { ids: [...], source: 'our rules' }: the new ids that follow the rule, not the file's style
await applyToXml(xml, ops, { conventions: { prefixes: { 'bpmn:ServiceTask': 'serviceTask_', 'bpmn:SequenceFlow': 'flow_' }, case: 'camelCase' } });
```

## Browser bundles

The core runs in a browser; CI fails on anything Node-only. The Camunda 7 and 8 rules are
chunks of their own, fetched the first time a document of that platform is validated
(`loadProfile('c7')` prefetches). PNG rendering and bpmnlint live in `@miragon/bpmn-cli/node`
only.

| bundle (minified / gzip) | size |
| --- | ---: |
| everything `@miragon/bpmn-cli` exports | 1087.6 / 341.6 KB |
| `applyToXml` only | 783.3 / 244.5 KB |
| Camunda 7 rules, on demand | 62.9 / 18.6 KB |
| Camunda 8 rules, on demand | 85.5 / 24.6 KB |

`node tools/iso/check.mjs --table` prints the current sizes.

## Next steps

- [Validators](validators.md): block or report with your own rules.
- [Ops JSON](ops.md#ops-json-bpmn-apply): every op `applyToXml` takes.
- [Guarantees and limits](contract.md): what a write changes.
