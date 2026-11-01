# Exit codes

- 0: ok, warnings allowed
- 1: usage: unknown command, flag, operation or key (`E_USAGE`)
- 2: model or validation error; `validate`: also an error of project lint
- 3: layout error (`E_LAYOUT_*`)
- 4: file, parse or render error (`E_FILE_NOT_FOUND`, `E_PARSE`, `E_IMPORT_LOSSY`)
- 5: `validate --strict` and warnings
- 70: internal error
