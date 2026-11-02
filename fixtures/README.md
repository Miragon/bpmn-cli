# fixtures

Every BPMN input of the tests, the fuzz, the bench and the live engine run. All of it is synthetic or public.

## Why a folder of its own

Four consumers read it: `test/`, `tools/verify/fuzz`, `tools/verify/bench` and `tools/verify/live-engines.mjs`. Under `test/` it would belong to one of them.

Read [docs/testing.md](../docs/testing.md#the-fixtures) for what each subfolder holds.
