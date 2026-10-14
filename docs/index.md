---
layout: home

hero:
  name: Miragon bpmn-cli
  text: Your agent edits the model, not the XML.
  tagline: A command line tool and Claude Code plugin for BPMN 2.0. It keeps your hand-drawn layout and checks the deploy rules of Camunda 7 and Camunda 8 before the engine does.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Product page
      link: https://miragon.ai/tools/bpmn-cli/
    - theme: alt
      text: GitHub
      link: https://github.com/Miragon/bpmn-cli
---

## One command, and the drawing stays

The agent names the element and the change, and the CLI writes the XML and the diagram. A model
drawn in Camunda Modeler or bpmn-js keeps its layout, and a new element goes next to its
neighbours.

![One bpmn add command inserts a task into a small order process](./assets/demo.gif)

## Where to look

- [Getting started](./getting-started.md): install the CLI or the Claude Code plugin and build a
  first model.
- [Commands](./commands.md) and [Ops JSON](./ops.md): every command, and the batch format of
  `bpmn apply`.
- [Camunda 7 and Camunda 8](./camunda.md): set the engine details by name and check them before
  you deploy.
- [Layout and formatting](./layout.md): how a write keeps the drawing, and the commands that tidy
  it.
- [bpmnlint](./bpmnlint.md): your project's `.bpmnlintrc` in `bpmn validate` and in every write.
- [Library use](./library.md): the same edits on strings, in Node and in the browser.

## Before 1.0

bpmn-cli is pre-1.0, and a minor version can break a command or an export. Pin the version you
run, and read [Migrating](./migrating.md) before you update.
