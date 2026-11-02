# 2. The project's copy of a bpmnlint plugin runs

Accepted, 2026-11-01.

## Context

bpmn-cli ships bpmnlint plugins of its own. If its copy answers first, `bpmn validate` can pass a file that the project's CI, on a newer or older plugin, fails.

## Decision

When a project installs a bpmnlint plugin that bpmn-cli also ships, such as `@miragon/bpmnlint-plugin-rules`, the project's copy runs; bpmn-cli's copy runs only when the project has none installed.

## Consequences

`bpmn validate` lints like the project's own bpmnlint run. A rule the project's copy lacks is named, not filled in from bpmn-cli's copy.
