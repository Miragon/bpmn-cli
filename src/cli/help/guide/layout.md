# Layout

One rule: a plane with shapes is drawn incrementally, an empty one in full. On a vertical plane a write that places, moves or routes something answers `E_LAYOUT_INCREMENTAL`; `set`, `retype`, `ext` and the drawing commands pass, and `bpmn layout` redraws it horizontally.

`E_LAYOUT_INCREMENTAL`: the change found no place. Add a last `layout` operation to the batch, or run the command below; it redraws everything, so your hand-placed shapes move.

```text
bpmn layout order.bpmn
bpmn set <file> <subProcessId> expanded=false
```

Branches: the default flow continues straight, the others go below and above in declaration order. `bpmn order` changes that order, `set <flowId> default=true` the straight one.
