# 9. Rework the docs, with a compact architecture map

Accepted, 2026-11-01.

## Context

`docs/architecture.md` walks today's layers in 377 lines, and the modules table leaves with the plan.

## Decision

The docs are reworked for 1.0, and `docs/architecture.md` becomes a compact map: per module what it does, what it holds, why it exists and what it deliberately does not do.

## Consequences

It carries the modules table on when `docs/plan/` goes, in a fixed shape that an agent check can later compare with the code.
