# @miragon/bpmn-lint

Runs a project's `.bpmnlintrc` through bpmnlint, for `bpmn validate`.

## Why a package of its own

- bpmnlint and its plugins are Node-only. Kept here, they load only for `validate`, never on a write or in a browser.
- Only the CLI imports it, so the core holds no knowledge of a project's lint setup.
- It has an API of its own (`api-report/`), so what the CLI hands in stays small.

It stays private and is bundled into bpmn-cli ([ADR 0005](../../docs/adr/0005-render-and-lint-stay-private.md)).
