# @miragon/bpmn-render

Paints BPMN as SVG, PNG optional, headless.

## Why a package of its own

- It never imports the core: it reads BPMN on its own, so the rules of the core cannot leak into the picture.
- It runs in a browser and in Node. PNG sits behind its own entry `./png`, and `./text` stays light enough for the core's layout to measure labels with.
- It has an API of its own (`api-report/`), so a change to the picture is a reviewed change.

It stays private and is bundled into bpmn-cli ([ADR 0005](../../docs/adr/0005-render-and-lint-stay-private.md)).
