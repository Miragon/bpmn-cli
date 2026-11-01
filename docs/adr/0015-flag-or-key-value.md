# 15. What a flag says, and what a key says

Accepted, 2026-11-01.

## Context

443 flag slots mix where an element goes with what it holds.

## Decision

A flag says where an element goes, what is made with it (its id, the flow into it, a lane's members) and how the command runs; what the element holds is a `key=value`, with the keys of `bpmn set`.

## Consequences

`add` and `retype` lose their event flags, `connect` its `--name` and `--condition`, `layout` its `--expand` and `--collapse`.
