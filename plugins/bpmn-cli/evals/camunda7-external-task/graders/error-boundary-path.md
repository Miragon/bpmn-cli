---
type: regex
pattern: '^(?=[\s\S]*<bpmn:boundaryEvent\b[^>]*attachedToRef="Activity_ChargeCreditCard"[^>]*>[\s\S]*?<bpmn:errorEventDefinition\b)(?=[\s\S]*<bpmn:userTask\b[^>]*name="Inform customer")(?=[\s\S]*<bpmn:endEvent\b[^>]*name="Payment failed")'
target: { source: file, path: payment.bpmn }
---
