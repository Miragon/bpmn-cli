# Commands

`bpmn <command> --help` lists each command's flags. Every write takes `-o`, `--dry-run`, `--force`, `--json`.

```text
bpmn show <file> [id] [--in <id>] [--around <id> [--depth <n>]]
bpmn find <file> [text] [--kind <kind>] [--in <id>]
bpmn diagram <file>
bpmn conventions <file>
bpmn validate <file> [--strict]
bpmn new <file> [name] [--id <id>] [--target <target>]
bpmn add <file> <kind> [name] [key=value…]
bpmn connect <file> <sourceId> <targetId> [key=value…]
bpmn set <file> <id> [key=value…]
bpmn remove <file> <ids…> [--bridge none|all] [--with-branch]
bpmn retype <file> <id> <kind> [key=value…]
bpmn move <file> <ids…>
bpmn order <file> <id> <ids…>
bpmn apply <file> [operations]
bpmn ext add <file> <id> <type> [key=value…]
bpmn ext remove <file> <id> <selector>
bpmn layout <file>
bpmn tidy <file> [ids…]
bpmn compact <file> [ids…]
bpmn place <file> [ids…]
bpmn color <file> [ids…]
bpmn label <file> <id>
bpmn route <file> <flowId>
bpmn space <file>
bpmn render <file> [ids…]
bpmn guide [topics…]
```

```text
bpmn connect order.bpmn userTask_check endEvent_done name=done
bpmn remove order.bpmn userTask_check --bridge none
bpmn remove order.bpmn gateway_ok --with-branch
bpmn retype order.bpmn userTask_check serviceTask
bpmn order order.bpmn gateway_ok flow_okToRejected flow_okToCharge
```
