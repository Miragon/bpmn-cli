---
type: regex
pattern: '<bpmn:serviceTask\b(?=[^>]*\bid="Activity_ChargeCreditCard")(?=[^>]*camunda:type="external")(?=[^>]*camunda:topic="charge-credit-card")'
target: { source: file, path: payment.bpmn }
---
