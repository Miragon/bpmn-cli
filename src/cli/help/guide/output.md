# Output

A write prints what it did in at most 1 KB, then the layout score and the state:

```text
layout quality: score 4 -> 9; added: crossings flow_7 x flow_9
state: 0 errors, 4 warnings (bpmn validate lists them and runs the project's lint)
```

`--json` prints the result as data on any read or write; `--json` is never cut. `-o <file>` writes elsewhere, `-o -` to stdout. `--dry-run` runs everything and writes nothing. A failure prints the code, the message and a hint; `bpmn guide exit-codes` has the exit codes.
