# Getting started

Install bpmn-cli, then build, look at and validate a first model.

**Requirements:** Node.js 22.12 or later (Homebrew brings it). For the plugin, also
[Claude Code](https://code.claude.com/docs).

::: tip Let Claude do the modelling
With the [plugin](./claude-code-plugin.md), Claude runs these commands for you. Ask in plain words,
for example _"Model the order process with lanes for sales, warehouse and accounting."_
:::

## 1. Install

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

```txt [Claude Code]
/plugin marketplace add Miragon/bpmn-cli
/plugin install bpmn-cli@miragon-bpmn
```

:::

Check it with `bpmn --version`.

## 2. Build a first model

```sh
bpmn new order.bpmn --name "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
bpmn add order.bpmn end "Done" --after Activity_CheckInvoice
```

Each command prints the ids it created for the next one to use. The last one prints:

```txt
created endEvent Event_Done "Done" - after Activity_CheckInvoice
created sequenceFlow Flow_CheckInvoiceToDone - Activity_CheckInvoice -> Event_Done
...
resolved: W_NO_END Process_OrderHandling, W_DEAD_END Activity_CheckInvoice
...
written: order.bpmn
```

A warning carries the command that fixes it; `resolved:` lists the ones this change fixed.

## 3. Look at it

`order.bpmn` opens in Camunda Modeler and bpmn-js. `bpmn show` prints it as text:

```sh
bpmn show order.bpmn
```

```txt
process Process_OrderHandling "Order handling" executable
  startEvent Event_OrderReceived "Order received" -> Activity_CheckInvoice (Flow_OrderReceivedToCheckInvoice)
  userTask Activity_CheckInvoice "Check invoice" -> Event_Done (Flow_CheckInvoiceToDone)
  endEvent Event_Done "Done"
problems: none
```

`bpmn render` draws it:

```sh
bpmn render order.bpmn -o order.png
```

<figure class="diagram">
  <img src="/shots/getting-started-order.svg" alt="The order process: start event Order received, user task Check invoice, end event Done" />
  <figcaption>order.bpmn, drawn by <code>bpmn render</code></figcaption>
</figure>

## 4. Validate

```sh
bpmn validate order.bpmn
```

```txt
platform: none (no executionPlatform and no vendor namespace)
layout: ok
valid, 0 warning(s)
```

For an executable model, pass `--target camunda7` or `--target camunda8` to `bpmn new`.
`validate` then checks the engine's deploy rules ([Camunda 7 and Camunda 8](./camunda.md)).

## Troubleshooting

::: details `bpmn: command not found` after `npm install -g`
Add the `bin` folder of `npm prefix -g` to your `PATH`, or use `npx -y @miragon/bpmn-cli`.
:::

::: details `bpmn` fails at start
Check `node --version`: bpmn-cli needs 22.12 or later. Or install with Homebrew.
:::

::: details Claude edits the `.bpmn` XML by hand
The plugin is not active. See [Check that it works](./claude-code-plugin.md#check-that-it-works).
:::

## Next steps

- [A worked session](./walkthrough.md): a gateway, a batch and two pools.
- [Camunda 7 and Camunda 8](./camunda.md): make the model deployable.
- [Commands](./commands.md): every command. `bpmn guide --short` prints the cheat sheet.
