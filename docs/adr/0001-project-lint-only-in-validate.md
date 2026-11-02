# 1. Project lint runs only in `bpmn validate`

Accepted, 2026-11-01.

## Context

Running a project's `.bpmnlintrc` loads bpmnlint and its plugins, which costs a write over a second.

## Decision

Project lint happens only in `bpmn validate`, on bpmnlint 12, in the private package `packages/lint`. The Camunda checks that every write runs are bpmn-cli's own code and need no bpmnlint.

## Consequences

A write runs no project lint and never loads bpmnlint. Lint imports nothing of the core and could be published as it is.
