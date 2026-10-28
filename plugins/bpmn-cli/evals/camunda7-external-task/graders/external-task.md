---
type: regex
pattern: '<bpmn:serviceTask\b(?=[^>]*\bid="serviceTask_chargeCreditCard")(?=[^>]*camunda:type="external")(?=[^>]*camunda:topic="charge-credit-card")'
target: { source: file, path: payment.bpmn }
---
