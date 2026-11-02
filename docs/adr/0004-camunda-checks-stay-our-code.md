# 4. The Camunda checks stay bpmn-cli's own code

Accepted, 2026-11-01.

## Context

The experiment Miragon/bpmn-cli#123 runs the checks as bpmnlint rules, on top of plugin Miragon/bpmnlint-rules#113. That would load bpmnlint on every write.

## Decision

The Camunda checks stay bpmn-cli's own code. #123 and #113 stay open; the refactoring does not need them.

## Consequences

Each Camunda rule stays a class over the moddle object, so bpmnlint can run it later if someone wants that.
