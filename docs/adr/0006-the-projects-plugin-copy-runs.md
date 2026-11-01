# 6. The project's copy of a bpmnlint plugin runs

Accepted, 2026-11-01.

## Context

Today bpmn-cli's own copy of a plugin answers first, so `bpmn validate` can pass a file that the project's CI, on a newer plugin, fails.

## Decision

When a project installs a bpmnlint plugin that bpmn-cli also ships, such as `@miragon/bpmnlint-plugin-rules`, the project's copy runs; bpmn-cli's copy runs only when the project has none installed.

## Consequences

`bpmn validate` lints like the project's CI; a test compares lint with bpmnlint 12's CLI on the blueprints' configs.
