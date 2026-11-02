# Getting started

Install bpmn-cli, build a first model, look at it and validate it. Requires Node.js 24 or later
(Homebrew brings it).

## Install

::: code-group

```sh [npm]
npm install -g @miragon/bpmn-cli
```

```sh [Homebrew]
brew install miragon/tap/bpmn-cli
```

```sh [npx (no install)]
# then use `npx -y @miragon/bpmn-cli` in place of `bpmn`
npx -y @miragon/bpmn-cli --version
```

:::

Check it with `bpmn --version`. `bpmn guide` prints the core of the help.

## Build a first model

```sh
bpmn new order.bpmn "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived
bpmn add order.bpmn end "Done" --after userTask_checkInvoice
```

Each command prints the ids it created, for the next command to use:

```txt
created endEvent: endEvent_done
created sequenceFlow: flow_checkInvoiceToDone
note: appended after userTask_checkInvoice
layout quality: score 0 -> 0
state: 0 errors, 0 warnings (bpmn validate lists them and runs the project's lint)
written: order.bpmn
```

`layout quality` says how the drawing changed (0 means no problems), `state` how many problems the
whole file has. A warning carries the command that fixes it.

## Look at it

`order.bpmn` opens in Camunda Modeler and bpmn-js. `bpmn show` prints it as text, `bpmn render`
draws it:

```console
$ bpmn show order.bpmn
process orderHandling "Order handling" executable
  startEvent startEvent_orderReceived "Order received" -> userTask_checkInvoice (flow_orderReceivedToCheckInvoice)
  userTask userTask_checkInvoice "Check invoice" -> endEvent_done (flow_checkInvoiceToDone)
  endEvent endEvent_done "Done"
state: 0 errors, 0 warnings (bpmn validate lists them and runs the project's lint)
$ bpmn render order.bpmn -o order.png
```

<figure class="diagram">
  <img src="/shots/getting-started-order.svg" alt="The order process: start event Order received, user task Check invoice, end event Done" />
  <figcaption>order.bpmn, drawn by <code>bpmn render</code></figcaption>
</figure>

## Validate

```console
$ bpmn validate order.bpmn
platform: none (no executionPlatform and no vendor namespace)
layout: ok
valid, 0 warning(s)
```

For a model an engine runs, create it with `bpmn new --target camunda7` or `--target camunda8`;
`validate` then checks the engine's deploy rules ([Camunda 7 and 8](./camunda.md)).

## Claude Code plugin

With the plugin, Claude runs these commands for you and never writes the XML itself. Install it in
Claude Code:

```txt
/plugin marketplace add Miragon/bpmn-cli
/plugin install bpmn-cli@miragon-bpmn
```

Then ask in plain words, for example _"Add a reminder timer on Check invoice that sends a reminder
after 3 days."_ Claude changes the model, renders it to `.bpmn-render/` (add that to `.gitignore`),
looks at the picture and runs `bpmn validate` before it is done.

<figure class="diagram">
  <img src="/shots/plugin-change.svg" alt="The order process with a non-interrupting timer on Check invoice, followed by Send reminder and Reminder sent" />
  <figcaption>The reminder, added by one <code>bpmn apply</code> batch</figcaption>
</figure>

The skill runs `bpmn` when it is on your PATH, else `npx`. To update, run
`claude plugin marketplace update miragon-bpmn` and `claude plugin update bpmn-cli@miragon-bpmn`,
then restart Claude Code. To give a whole team the plugin, commit this to `.claude/settings.json`:

```json [.claude/settings.json]
{
  "extraKnownMarketplaces": {
    "miragon-bpmn": { "source": { "source": "github", "repo": "Miragon/bpmn-cli" } }
  },
  "enabledPlugins": { "bpmn-cli@miragon-bpmn": true }
}
```

## Troubleshooting

| problem | fix |
| --- | --- |
| `bpmn: command not found` after `npm install -g` | add the `bin` folder of `npm prefix -g` to your `PATH`, or use `npx -y @miragon/bpmn-cli` |
| `bpmn` fails at start | `node --version` must be 24 or later |
| Claude edits the XML by hand | restart Claude Code after an install or update; `/plugin` must list `bpmn-cli@miragon-bpmn` as enabled; or call the skill: `/bpmn-cli:bpmn <request>` |
| Claude's first command is slow | `npx` downloads the CLI; install it once with `npm install -g @miragon/bpmn-cli` |

## Next

[Model a process](./modeling.md) builds a larger model: a gateway, a batch and two pools.
