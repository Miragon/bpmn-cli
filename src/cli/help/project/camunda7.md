# Camunda 7

Also CIB seven and Operaton. Attributes take `set` with the `camunda:` prefix, nested elements a slot (`bpmn guide nested-keys`), the rest `ext add`.

```text
bpmn new claim.bpmn Claim --target camunda7
bpmn set invoice.bpmn serviceTask_charge camunda:type=external camunda:topic=charge-card
bpmn set invoice.bpmn userTask_review 'loop.camunda:collection=${items}' loop.camunda:elementVariable=item
bpmn ext add invoice.bpmn serviceTask_charge camunda:inputParameter name=amount 'body=${order.total}'
bpmn ext remove invoice.bpmn serviceTask_charge 'camunda:inputParameter[name=amount]'
```

Before deploying, `bpmn validate <file>`; each hint is the command.
