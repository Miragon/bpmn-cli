# Evals of the bpmn-cli plugin

Cases for [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals). Each case is a
request a user would type (none names the skill) plus graders on the produced `.bpmn` file and on
the transcript. Every case runs with the plugin and without it (the no-plugin baseline), so the
report shows what the skill adds.

| case | request | what the graders check |
| --- | --- | --- |
| `build-order-to-cash` | an order-to-cash model from scratch: lanes Vertrieb / Lager / Buchhaltung, a customer pool, message flows | file created; lane set and the three lanes; two pools and four message flows; a diagram; speaking ids; built with `bpmn new` / `apply` / `add`; validated with the CLI and clean (`valid, 0 warning(s)`); no hand-written XML (no Write / Edit of a .bpmn, no XML in a shell command); a judge on the reply |
| `edit-hand-drawn-model` | insert a manager approval and a 3-day non-interrupting reminder into a model drawn in Camunda Modeler (scaffold) | the approval (a user task, found by its name, whatever its id) sits on the "yes" flow before "Order goods", directly or after its decision gateway; the timer boundary event on it and its path; start, check and gateway did not move, "Order goods" kept its row; new ids speak; no task with two incoming flows (implicit join); validated with the CLI; no hand-written XML; a judge on the reply |
| `camunda7-external-task` | Camunda 7: external task, input mapping, error mapping, error boundary path; must pass `bpmn validate --strict` (scaffold) | `camunda:type` / `topic`; `camunda:inputParameter`; `camunda:errorEventDefinition` + `bpmn:error` code; boundary path; `validate --strict` ran and printed `valid, 0 warning(s)`; no hand-written XML |
| `format-happy-path` | colour the happy path green and move the rejection branch below the main line (scaffold) | the path's shapes and flows are green (the bpmn-js green the CLI writes, or another common green); the rejection branch is not and lies below; the main line did not move; flows and nodes unchanged; validated with the CLI; no hand-written XML |
| `camunda8-retoure-german` | a German request: a deployable Camunda 8 returns process | Camunda 8 file; both job types; the `lager` candidate group; a gateway with FEEL conditions; speaking ASCII ids; validated, 0 deploy findings; no hand-written XML |
| `ignores-python-question` | an unrelated Python question | the skill is not invoked (scored in both arms); a judge on the answer |

`skill-used` graders (`tool_used: Skill`) are plugin-fired indicators: they show whether the skill
triggered and do not count toward the score of a two-arm run.

What happened during a run is checked deterministically (`tool_used` on the commands, `regex` on
the trace or the file); the judges (`llm`) read only the final reply (`focus: last_message`). A
judge with `focus: trace` sees just the first and the last 12 messages of a run, so on a real
session it misses the commands that built the model.

## Running them

The agent under test runs `bpmn` from `PATH` (the skill's fallback, `npx`, cannot download inside
the eval sandbox). The evaluator therefore puts a `bpmn` on `PATH` before the run:

- `npm install -g @miragon/bpmn-cli@<version>` (the version the skill pins), or
- from a checkout: `npm ci && npm run build`, then a shim such as
  `printf '#!/bin/sh\nexec node "%s/bin/bpmn.js" "$@"\n' "$PWD" > <dir on PATH>/bpmn && chmod +x <dir on PATH>/bpmn`.

Shell commands of an eval run execute in Claude Code's sandbox, which hides the home directory
and the temporary directories (`/tmp` and `$TMPDIR`): `bpmn`, the CLI's files and `node` itself
must be readable from outside them. A global install under `/usr/local` or `/opt` works; a Node
from volta / nvm or a checkout below `$HOME` does not, and neither does a shim in `/tmp`. On macOS
the per-user cache directory works for a copy of node, the built CLI and the shim:
`$(getconf DARWIN_USER_CACHE_DIR)bpmn-cli-eval/`. Check it with the cheap case first, then the
suite:

```
claude plugin eval plugins/bpmn-cli --case build-order-to-cash --runs 1 --ablation none --scaffold --allow-tools Bash Write Edit
claude plugin eval plugins/bpmn-cli --scaffold --allow-tools Bash Write Edit --judge-model sonnet
```

- `--scaffold` runs the cases' `scaffold.sh` (it writes the fixture model into the empty
  workspace; the fixtures are embedded in the scripts).
- `--allow-tools Bash Write Edit` grants the shell (for `bpmn`) and the file tools, so the
  baseline can do what an agent without the skill would do (write XML) and the graders can tell
  the difference.
- The cases run twice per arm (`runs: 2`), with modest turn and time limits; `--runs 1` for a
  quick look, `--max-cost-usd` as a ceiling.
- Results go to `evals/results/<timestamp>/` (`report.html`, `aggregate-result.json`), which git
  ignores.
- The baseline arm sees the same `bpmn` on `PATH`. An agent without the skill sometimes finds it
  (`which bpmn`) and learns it from `bpmn guide`, so the delta is smaller than for a user who has
  neither the plugin nor the CLI.

`test/plugin.test.ts` checks the suite without a model: every case is well-formed, every regex
compiles, a reference solution made with the CLI passes every file grader, the untouched fixture
fails the graders that check the change, and the transcript graders match what the CLI prints.
