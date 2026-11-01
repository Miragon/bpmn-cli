# 13. #123's parity models go into the corpus

Accepted, 2026-11-01.

## Context

The 1,076 parity models of Miragon/bpmn-cli#123, from its 109 rule specs, cover 1,077 rule cases, but its tests build them from template strings at run time.

## Decision

They go into `corpus/engine/`: synthetic, one per rule case, the cases of main's Camunda check tests written as files.

## Consequences

The checks step runs #123's tests once on its branch and writes each model out.
