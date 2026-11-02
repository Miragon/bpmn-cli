# 7. What a flag says, and what a key says

Accepted, 2026-11-01.

## Context

Flags that mix where an element goes with what it holds multiply over the commands and say the same thing in several ways.

## Decision

A flag says where an element goes, what is made with it (its id, the flow into it, a lane's members) and how the command runs; what the element holds is a `key=value`, with the keys of `bpmn set`.

## Consequences

`add`, `retype` and `connect` take an element's content as `key=value`, and a new property of an element becomes a key of `bpmn set`, not a flag.
