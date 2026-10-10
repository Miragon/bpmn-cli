---
description: 'German request: a deployable Camunda 8 returns process with a user task, a gateway and two job workers'
tags: [camunda8, create, german]
runs: 2
max_turns: 30
timeout_seconds: 600
allowed_tools: [Skill, Read, Glob, Grep, Bash, Write, Edit]
---

Bitte modellier unseren Retourenprozess als Camunda-8-Prozess in `retoure.bpmn`:

1. Start: Retoure angemeldet.
2. Das Lager prüft die zurückgeschickte Ware (User Task für die Gruppe `lager`).
3. Ist die Ware in Ordnung, erstellt ein Job Worker die Gutschrift (Job-Typ `create-credit-note`); danach ist die Retoure abgeschlossen.
4. Ist die Ware beschädigt, wird die Gutschrift abgelehnt: ein Job Worker schickt dem Kunden eine Ablehnungsmail (Job-Typ `send-rejection-mail`), dann endet der Prozess mit "Retoure abgelehnt".

Der Prozess muss sich so in Camunda 8 deployen lassen.
