# Library use

bpmn-cli as a package, for tools that embed it, such as a modeler or a modelling workspace. Agents and
scripts use the CLI.

## Quick start

```sh
npm install @miragon/bpmn-cli
```

The functions take the XML as a string and return the new XML with what the CLI prints:

```ts
import { applyToXml, BpmnError, newXml, showXml } from '@miragon/bpmn-cli';

let xml = await newXml({ name: 'Order handling' });
const edit = await applyToXml(xml, [
  { op: 'add', kind: 'start', name: 'Order received' },
  {
    op: 'add',
    kind: 'userTask',
    name: 'Check invoice',
    after: 'startEvent_orderReceived',
  },
  { op: 'add', kind: 'end', name: 'Done', after: 'userTask_checkInvoice' },
]);
if (!edit.unchanged) {
  xml = edit.xml;
}

edit.created.map((change) => change.id);
// ['startEvent_orderReceived', 'userTask_checkInvoice',
//  'flow_orderReceivedToCheckInvoice', 'endEvent_done',
//  'flow_checkInvoiceToDone']

edit.state;
// { errors: 0, warnings: 0 }

(await showXml(xml)).text;
// the text of `bpmn show`

try {
  await applyToXml(xml, [
    { op: 'add', kind: 'userTask', name: 'Ship', after: 'userTask_check' },
  ]);
} catch (error) {
  if (!(error instanceof BpmnError)) {
    throw error;
  }
  error.code;               // 'E_NOT_FOUND'
  error.category;           // 'model'
  error.details.candidates; // ['userTask_checkInvoice']
}
```

A failure throws a `BpmnError` (`code`, `category`, `details`). Nothing is half done: the caller still
has its input. The categories are `usage`, `model`, `layout`, `io` and `internal`.

## The contract

`@miragon/bpmn-cli` exports ten things at run time: eight functions, one per command that is not an
operation, plus `OPS_SCHEMA` and `BpmnError`. The package has one entry, and it runs in Node and in the
browser. `./package.json` is exported too, for the version.

```ts
export function applyToXml(xml: string, operations: Operation[], options?: EditOptions): Promise<EditResult>;
export function showXml(xml: string, options?: ShowOptions): Promise<ShowResult>;
export function findXml(xml: string, options?: FindOptions): Promise<FindResult>;
export function diagramXml(xml: string): Promise<DiagramResult>;
export function renderXml(xml: string, options?: RenderOptions): Promise<RenderedImage>;
export function validateXml(xml: string, options?: ValidateOptions): Promise<ValidationReport>;
export function newXml(options?: NewOptions): Promise<string>;
export function kindsJson(options?: { conventions?: IdConventions }): KindTableResult;

export const OPS_SCHEMA: JsonSchema;

export class BpmnError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly details: ErrorDetails;
}
```

| function | like |
| --- | --- |
| `applyToXml` | `bpmn apply`, and every edit and draw command |
| `showXml` | `bpmn show` |
| `findXml` | `bpmn find` |
| `diagramXml` | `bpmn diagram` |
| `renderXml` | `bpmn render`, as SVG; PNG is the CLI's |
| `validateXml` | `bpmn validate`, without the project's lint unless you pass it as a validator |
| `newXml` | `bpmn new` |
| `kindsJson` | the tables of `bpmn guide kinds` and `bpmn guide triggers`, as data, each kind with the pattern of its new ids |

## Options

```ts
interface EditOptions {
  validators?: Validator[];
  force?: boolean;
  conventions?: IdConventions;
}

interface ShowOptions {
  id?: string;
  in?: string;
  around?: string;
  depth?: number;
}

interface FindOptions {
  text?: string;
  kind?: string;
  in?: string;
}

interface RenderOptions {
  ids?: string[];
  around?: string;
  depth?: number;
  path?: [from: string, to: string];
  problems?: boolean;
}

interface ValidateOptions {
  validators?: Validator[];
}

interface NewOptions {
  name?: string;
  id?: string;
  target?: 'camunda8' | 'camunda7' | 'none';
  conventions?: IdConventions;
}
```

The platform comes from the file's namespaces, so there is no option for it. The full signatures ship as
TypeScript types with the package.

## Results

`operations` is the JSON of [`bpmn apply`](ops.md); `OPS_SCHEMA` says what each operation takes and
`applyToXml` refuses the rest. `OPS_SCHEMA.$defs.drawingOp` lists the 8 drawing operations.

`EditResult` holds:

| field | means |
| --- | --- |
| `xml`, `unchanged` | the new text; `unchanged` is `true` when there is nothing to save |
| `created`, `changed`, `removed` | `{ id, kind, name, detail }` per element |
| `renamed` | the ids a write renamed |
| `aliases` | each `$name` of the batch with its id |
| `findings` | check findings at the touched elements, every error the change added elsewhere, plus every host-validator finding the change added |
| `preexisting` | the host-validator errors the file had before, which do not block |
| `state` | the counts of errors and warnings in the whole file |
| `score` | the layout score before and after, its counts per kind, the problems added and resolved |
| `format` | what the drawing operations did |
| `notes` | short remarks such as `appended after userTask_checkInvoice` |

Each read returns `{ text, ... }`: what the command prints, and the same answer as data, which `--json`
prints.

```ts
const outline = await showXml(xml);
outline.view.kind;                    // 'model'

const element = await showXml(xml, { id: 'userTask_checkInvoice' });
element.view.kind;                    // 'element'

const { hits, total } = await findXml(xml, { kind: 'task', in: 'orderHandling' });
hits[0];
// { id: 'userTask_checkInvoice', kind: 'userTask', name: 'Check invoice', in: 'orderHandling' }

const { score, counts, problems, rows } = await diagramXml(xml);

const { svg, width, height } = await renderXml(xml);

const { ok, findings, state, platform, validators, layout } = await validateXml(xml);
```

An option narrows a result, it never changes its type. Every id in a result comes as
`{ id, kind, name }`, an input the next call takes.

`validateXml` also draws a copy of the model in full, as `bpmn layout` would: a failure is an error, the
layout's warnings count as warnings. A write never runs this dry run.

## Redrawing

There is no separate layout function. `applyToXml(xml, [{ op: 'layout' }])` draws in full, the way out
when a write answers `E_LAYOUT_INCREMENTAL`; `{ op: 'tidy' }` and the other drawing operations go the same
way. A `set` of `expanded` collapses or expands a sub-process in place.

## Declared id conventions

Without `conventions` new ids follow the defaults of `@miragon/rules/element-id-naming`. A host whose lint
configures that rule otherwise passes the same conventions, or its lint reports bpmn-cli's new ids. The
CLI reads them from the nearest `.bpmnlintrc` ([bpmnlint](bpmnlint.md#id-conventions) has the rules); a
library host declares them:

```ts
await applyToXml(xml, operations, {
  conventions: {
    prefixes: {
      'bpmn:ServiceTask': 'st_',
      'bpmn:SequenceFlow': 'flow_',
    },
    case: 'snake_case',
  },
});
```

`kindsJson({ conventions })` adds to each kind the pattern its new ids follow; it needs no XML.

## Project lint

The library does not load bpmnlint: a write stays free of plugin code, and only `bpmn validate` runs a
project's `.bpmnlintrc`. A host that wants those rules runs bpmnlint itself and passes the result as a
[validator](validators.md).

## Browser bundles

The package runs in a browser; `npm run check-build -- . iso` fails on anything Node-only. The Camunda 7 and 8 rules are
chunks of their own, loaded the first time a document of that platform is checked, and `renderXml` loads
the painter on demand. The set `applyToXml`, `showXml`, `findXml`, `validateXml`, `kindsJson`, `OPS_SCHEMA`
and `BpmnError` weighs about 800 KB minified, held by a budget. PNG output and bpmnlint are the CLI's.

## Next steps

- [Validators](validators.md): block or report with your own rules.
- [Operations](ops.md): every operation `applyToXml` takes.
- [Guarantees and limits](contract.md): what a write changes.
- [Migrating from 0.9](migration.md): what a host changes.
