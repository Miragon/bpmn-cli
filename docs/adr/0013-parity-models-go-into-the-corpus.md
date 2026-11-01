# 13. #123's parity models go into the corpus

Accepted, 2026-11-01.

## Context

The 321 parity models of Miragon/bpmn-cli#123 cover one rule case each, but its tests build them from template strings at run time.

## Decision

They go into `corpus/engine/`: synthetic, one per rule case, the cases of main's Camunda check tests written as files.

## Consequences

The checks step runs #123's tests once on its branch and writes each model out.
