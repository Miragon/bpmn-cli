# 14. Operations are parsed strictly

Accepted, 2026-11-01.

## Context

Element keys move under `set`, so an old call could lose its meaning silently.

## Decision

Operations are parsed strictly, as today: a key an operation does not take is refused, never dropped.

## Consequences

A batch or design-iq call that still sends `"timer": "P2D"` on `add` answers `E_USAGE` with the keys `add` takes, instead of a timer event without its timer. No table keeps retired inputs.
