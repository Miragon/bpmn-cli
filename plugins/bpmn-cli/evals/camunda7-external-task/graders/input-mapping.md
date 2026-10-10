---
type: regex
pattern: '<camunda:inputParameter name="amount">\$\{order\.total\}</camunda:inputParameter>'
target: { source: file, path: payment.bpmn }
---
