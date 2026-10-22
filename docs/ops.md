# Ops JSON (`bpmn apply`)

`bpmn apply <file> ops.json` (or `-` for stdin) runs many changes as one transaction. Use it
whenever a change touches more than one element.

::: tip From the CLI
`bpmn guide ops` prints every op with every key; `bpmn kinds --json` -> `ops` is the JSON Schema.
:::

## Running a batch

- If any op fails, nothing is written and the error names the op (`ops[3] (add): ...`).
- Only the final state is validated and laid out. Steps that are invalid alone (an event sub-process
  before its start event) pass.
- An op is an object with `"op"` and the flags of the matching command in lowerCamelCase
  (`--flow-name` -> `flowName`). The input is an array of ops or `{"ops": [...]}`.

## A first batch

`"as": "$book"` names the new task, so later ops never guess its id.

```json [book.json]
[
  { "op": "add", "kind": "serviceTask", "name": "Book invoice",
    "after": "Activity_CheckInvoice", "as": "$book" },
  { "op": "set", "id": "$book",
    "values": { "doc": "Posts the invoice to the ledger." } },
  { "op": "ext", "id": "$book", "action": "add",
    "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice" } }
]
```

```console
$ bpmn apply order.bpmn book.json --summary
created serviceTask: Activity_BookInvoice
created sequenceFlow: Flow_BookInvoiceToInvoiceHandled
aliases: $book = Activity_BookInvoice
changed: Flow_CheckInvoiceToBookInvoice
renamed: Flow_CheckInvoiceToInvoiceHandled -> Flow_CheckInvoiceToBookInvoice
layout: full, score 0 -> 0
written: order.bpmn
```

## The ops

| op | required keys |
| --- | --- |
| `add` | `kind` |
| `connect` | `source`, `target` |
| `set` | `id`, and `values` or `unset` |
| `remove` | `ids` |
| `retype` | `id`, `kind` |
| `move` | `ids` |
| `order` | `id` |
| `ext` | `id`, `action` (`add` / `remove`) |
| `split` | `after`, `branches` |
| `place`, `align`, `color`, `label`, `route`, `space`, `tidy`, `compact` | see `bpmn guide ops` |

## `split`

`split` exists only in a batch. It places a gateway after the anchor, creates every branch and a join
gateway of the same kind. An empty `nodes` list is a direct flow to the join. A branch that ends in an
end event stops there.

## Aliases

| key | names | on |
| --- | --- | --- |
| `"as"` | what the op creates | `add`, `connect`, `split`, split nodes |
| `"flowAs"` | the flow into a new node | `add` that appends or prepends, split nodes |
| `"outAs"` | the one flow an `add` creates out of the new node | `add` that splices, prepends or has `"to"` |
| `"joinAs"` | the join of a split | `split` |
| `"refAs"` | the message, error, signal or escalation | `add` with a trigger |

An alias is defined once and used only after its op. It follows its element through a rename and a
retype. On a splice `"flowAs"` names the flow into the new node and `"outAs"` the flow the splice
creates (new node -> old successor), so the same batch can give it a condition:

```json
{"op": "add", "kind": "exclusiveGateway", "name": "Valid?", "flow": "Flow_CheckToOk", "as": "$valid", "outAs": "$yes"}
```

## Flow ids in a batch

With `apply --keep-flow-ids` a flow the file had keeps its id through the whole batch unless an op
removes it, and the result names stale ids with `W_FLOW_ID_STALE` instead of renaming them.
A `move` puts the moved node's out-flow back at its new place, so a flow between nodes moved
together stays theirs.

## A full example

After a start event, a "Check invoice" user task and an end event in a Camunda 8 file, this batch
splits after the check, adds a reminder timer with its own path and gives both tasks a job type.
`bpmn kinds --json` -> `opsExample` returns it.

```json [ops.json]
{
  "ops": [
    { "op": "split", "after": "Activity_CheckInvoice",
      "kind": "exclusiveGateway", "name": "Invoice ok?", "as": "$ok",
      "branches": [
        { "flowName": "yes", "condition": "= ok",
          "nodes": [
            { "kind": "serviceTask", "name": "Book invoice", "as": "$book" }
          ] },
        { "flowName": "no", "default": true,
          "nodes": [
            { "kind": "userTask", "name": "Clarify invoice", "as": "$clarify",
              "set": {
                "doc": "Call the customer and clarify the open positions."
              } }
          ] }
      ] },
    { "op": "add", "kind": "boundaryEvent:timer", "name": "Reminder",
      "on": "$clarify", "timer": "P2D", "nonInterrupting": true,
      "as": "$reminder" },
    { "op": "add", "kind": "sendTask", "name": "Remind customer",
      "after": "$reminder", "as": "$remind" },
    { "op": "add", "kind": "endEvent", "name": "Reminder sent",
      "in": "Process_OrderHandling", "as": "$sent" },
    { "op": "connect", "source": "$remind", "target": "$sent" },
    { "op": "set", "id": "$book",
      "values": { "name": "Book invoice in ERP",
                  "doc": "Posts the invoice to the ledger." } },
    { "op": "ext", "id": "$book", "action": "add",
      "type": "zeebe:taskDefinition",
      "attrs": { "type": "book-invoice", "retries": "3" } },
    { "op": "ext", "id": "$remind", "action": "add",
      "type": "zeebe:taskDefinition",
      "attrs": { "type": "remind-customer" } }
  ]
}
```

<figure class="diagram">
  <img src="/shots/ops-batch-result.svg" alt="The order process after the batch: the gateway Invoice ok? with the branches Book invoice in ERP and Clarify invoice, a join, and a non-interrupting reminder timer on Clarify invoice that leads to Remind customer and Reminder sent" />
  <figcaption>The result of the batch, laid out in one pass</figcaption>
</figure>

## Next steps

- [Commands](commands.md): the command behind each op, with its options.
- [Camunda 7 and Camunda 8](camunda.md): the extension elements the `ext` ops write.
- [A worked session](walkthrough.md): a batch inside a whole modelling session.
