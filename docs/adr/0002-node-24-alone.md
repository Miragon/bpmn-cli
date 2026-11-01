# 2. Node 24 and later only

Accepted, 2026-11-01.

## Context

bpmnlint 12 asks for Node 24, and project lint moves to bpmnlint 12.

## Decision

1.0 runs on Node 24 and later only; every workflow runs Node 24 alone.

## Consequences

`engines` is `>=24`, the CI job on Node 22.12 is gone, and the migration note says so.
