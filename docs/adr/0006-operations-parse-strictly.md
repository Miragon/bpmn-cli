# 6. Operations are parsed strictly

Accepted, 2026-11-01.

## Context

A key that an operation silently drops changes what a call means without telling the caller.

## Decision

Operations are parsed strictly: a key an operation does not take is refused, never dropped.

## Consequences

A call with an unknown key, such as `"timer": "P2D"` on `add`, answers `E_USAGE` with the keys the operation takes, instead of a timer event without its timer. No table keeps retired inputs.
