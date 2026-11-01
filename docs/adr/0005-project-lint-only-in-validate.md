# 5. Project lint runs only in `bpmn validate`

Accepted, 2026-11-01.

## Context

A write that runs a project's `.bpmnlintrc` loads bpmnlint and takes over a second. The blueprints' CI lints with bpmnlint 12.

## Decision

Project lint happens only in `bpmn validate`, on bpmnlint 12 as in the blueprints' CI, in the private package `packages/lint`.

## Consequences

A write runs no project lint. Lint imports nothing of the core and can be published as it is.
