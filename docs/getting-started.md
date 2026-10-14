# Getting started

You need Node.js 22.12 or later (Homebrew installs it for you). To let Claude do the modelling, add
the plugin in Claude Code. To work at the shell yourself, install the CLI and build a first model.

::: code-group

```txt [Claude Code]
/plugin marketplace add Miragon/bpmn-cli
/plugin install bpmn-cli@miragon-bpmn
```

```sh [Shell]
npm install -g @miragon/bpmn-cli   # or: brew install miragon/tap/bpmn-cli
bpmn new order.bpmn --name "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
bpmn add order.bpmn end "Done" --after Activity_CheckInvoice
bpmn show order.bpmn
bpmn validate order.bpmn
bpmn render order.bpmn -o order.png
```

:::

## In Claude Code

The plugin's skill `bpmn` makes Claude use the CLI for every request that touches a `.bpmn` file.
It runs `bpmn` from your PATH, or else `npx` pinned to the plugin's version. Ask in plain words, in
English or German, for example _"Model the order process with lanes for sales, warehouse and
accounting."_ [Claude Code plugin](./claude-code-plugin.md) covers updates and a setup for your
whole team.

## At the shell

The commands above write `order.bpmn`, a normal BPMN file with a laid-out diagram that opens in
Camunda Modeler and bpmn-js. `bpmn show` prints the model as text, without coordinates:

```txt
process Process_OrderHandling "Order handling" executable
  startEvent Event_OrderReceived "Order received" -> Activity_CheckInvoice (Flow_OrderReceivedToCheckInvoice)
  userTask Activity_CheckInvoice "Check invoice" -> Event_Done (Flow_CheckInvoiceToDone)
  endEvent Event_Done "Done"
problems: none
```

`bpmn validate` checks the model, and `bpmn render` draws it as a PNG without a browser.
`npx -y @miragon/bpmn-cli` works in place of `bpmn` without installing. `bpmn guide --short` prints
the cheat sheet, and [A worked session](./walkthrough.md) builds a larger process step by step.

## For Camunda 7 or Camunda 8

For an executable model, add `--target camunda7` (also for CIB seven and Operaton) or
`--target camunda8` to `bpmn new`. The CLI then sets the engine's details by name and
`bpmn validate` checks its deploy rules, as [Camunda 7 and Camunda 8](./camunda.md) shows.
