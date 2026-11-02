# Errors

Each refusal names a fix; the file stays as it was.

- `E_NOT_FOUND`: use a listed candidate; `bpmn find` lists ids.
- `E_HAS_SUCCESSOR`: several outgoing flows: `--flow <flowId>`.
- `E_AMBIGUOUS_SCOPE`: several processes: `--in <processId>`.
- `E_CROSS_SCOPE`: between pools `connect` makes a message flow.
- `E_UNKNOWN_KEY`: the message lists the keys; vendor keys take a prefix.
- `E_WRONG_HOST`: the attribute belongs elsewhere; the hint names the key.
- `E_TRIGGER_REQUIRED`: name it, `boundaryEvent:timer`.
- `E_DUPLICATE_EXTENSION`: `--replace`.
- `E_VALIDATION`: lists the new errors; do it in one `apply` that ends valid.
- `E_IMPORT_LOSSY`: the CLI cannot keep what the file holds; `--force` loses it.
