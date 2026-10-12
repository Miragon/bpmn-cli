# Ops JSON (`bpmn apply`)

`bpmn apply <file> ops.json` (or `-` for stdin) runs many operations as one transaction. The whole
batch is checked first, the model ops are applied in memory, the result is validated and laid out,
the format ops run on the drawing in batch order, and the file is written once. If any op fails,
nothing is written and the error names the op (`ops[3] (add): ...`, `"op": 3` in `--json`).

Use one batch per change. Steps that are invalid on their own (an event sub-process before its start
event, a start event before its path) pass because only the final state is validated, the warnings
are those of the final state, and the diagram is laid out once.

An op is an object with `"op"` and the flags of the matching command in lowerCamelCase
(`--flow-name` -> `flowName`, `--if-absent` -> `ifAbsent`). The input is an array of ops or
`{"ops": [...]}`. This batch assumes `bpmn new order.bpmn --name "Order handling" --target camunda8`
followed by a start event, a "Check invoice" user task and an end event:

```json
{
  "ops": [
    { "op": "split", "after": "Activity_CheckInvoice", "kind": "exclusiveGateway", "name": "Invoice ok?", "as": "$ok",
      "branches": [
        { "flowName": "yes", "condition": "= ok",
          "nodes": [{ "kind": "serviceTask", "name": "Book invoice", "as": "$book" }] },
        { "flowName": "no", "default": true,
          "nodes": [{ "kind": "userTask", "name": "Clarify invoice", "as": "$clarify",
                      "set": { "doc": "Call the customer and clarify the open positions." } }] }
      ] },
    { "op": "add", "kind": "boundaryEvent:timer", "name": "Reminder", "on": "$clarify", "timer": "P2D",
      "nonInterrupting": true, "as": "$reminder" },
    { "op": "add", "kind": "sendTask", "name": "Remind customer", "after": "$reminder", "as": "$remind" },
    { "op": "add", "kind": "endEvent", "name": "Reminder sent", "in": "Process_OrderHandling", "as": "$sent" },
    { "op": "connect", "source": "$remind", "target": "$sent" },
    { "op": "set", "id": "$book", "values": { "name": "Book invoice in ERP", "doc": "Posts the invoice to the ledger." } },
    { "op": "ext", "id": "$book", "action": "add", "type": "zeebe:taskDefinition",
      "attrs": { "type": "book-invoice", "retries": "3" } },
    { "op": "ext", "id": "$remind", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "remind-customer" } }
  ]
}
```

`bpmn kinds --json` -> `opsExample` returns this object; the result is a valid Camunda 8 file.

| op | required | other keys (selection) |
| --- | --- | --- |
| `add` | `kind` | `name`, `id`, placement (`after`, `before`, `flow`, `in`, `on`, `to`), `lane`, flow keys (`flowName`, `condition`, `default`), trigger keys (`timer`, `message`, `error`, ...), `set` (map), `ifAbsent` |
| `connect` | `source`, `target` | `name`, `id`, `condition`, `default`, `message`, `ifAbsent` |
| `set` | `id` | `values` (map), `unset` (list); at least one of the two |
| `remove` | `ids` | `bridge` (default true), `bridgeAll`, `withBranch`, `ifExists` |
| `retype` | `id`, `kind` | trigger keys |
| `move` | `ids` | `after`, `before`, `flow`, `in`, `on`, `lane`, flow keys |
| `order` | `id` | exactly one of `flows`, `lanes`, `pools` |
| `ext` | `id`, `action` (`add` / `remove`) | `type` (add: type; remove: selector or index from `ext list`), `attrs` (map), `body`, `xml`, `replace`, `slot` |
| `split` | `after`, `branches` | `kind` (default `exclusiveGateway`), `name`, `id`, `join` (default true), `joinId`, `joinName`; a branch: `flowName`, `condition`, `default`, `nodes` (add-like objects without placement) |
| `place` | | `ids`, at most one of `rowOf` / `below` / `above` and one of `columnOf` / `after` / `before`; or `side` (`top` / `bottom`) with exactly one boundary event id |
| `align` | `axis` (`row` / `column`) | `ids`, `to` (reference; default the first id) |
| `color` | `color` | `ids`; `blue`, `orange`, `green`, `red`, `purple`, `default` |
| `label` | `id`, `side` | `above`, `below`, `left`, `right` |
| `route` | `id` | `exit`, `entry` (`right` / `top` / `bottom` / `left`) |
| `space` | one of `after` / `below` | `by` (`"column"`, `"row"` or pixels; negative closes space) |
| `tidy` | | `ids` (default every shape) |
| `compact` | | `ids` (pools, lanes, expanded sub-processes; default the whole drawing) |

`place`, `align`, `color` and `tidy` also take selectors instead of `ids`: `path` (`[fromId, toId]`),
`via` (flow ids, with `path`), `kind`, `branch` (a sequence flow id).

**`split`** has no CLI command. It places a gateway after the anchor, creates every branch (the first
node gets the branch's flow options, further nodes are chained) and a join gateway of the same kind
(`<gatewayId>_join`) that the branch ends connect to. When the anchor had a successor, the join
continues to it. An empty `nodes` list is a direct flow from gateway to join. A branch that ends in
an end event stops there; with fewer than two branches left to join, no join gateway is created.

**Aliases.** `"as": "$name"` names what an op creates (`add`, `connect`, `split`, split nodes), and
later ops use `$name` wherever an id goes, so a batch never guesses a generated id
([Ids](reference.md#ids)). `"flowAs"` names the flow into a new node, `"joinAs"` the join of a split,
and `"refAs"` the message, error, signal or escalation the element references, for example to give a
new message its `zeebe:subscription`. An alias is defined once and used only after its op
(`E_UNKNOWN_ALIAS`, `E_DUPLICATE_ALIAS`); it follows its element through a rename. The result lists
alias and final id (`aliases: $ok = Gateway_InvoiceOk, ...`, `"aliases"` in `--json`).

**Checks.** Unknown ops and keys (with a suggestion for typos such as `colour`), wrong value types,
conflicting placements, flow options without a flow-creating placement, `default` together with
`condition` and unknown kinds are rejected before anything runs. Numbers and booleans inside
`values`, `set` and `attrs` maps become strings; `null` counts as absent.

All ops with every key: `bpmn guide ops`. The JSON Schema (draft 2020-12): `bpmn kinds --json` ->
`ops`. Kinds, triggers and set keys: `bpmn kinds` and [Reference](reference.md).
