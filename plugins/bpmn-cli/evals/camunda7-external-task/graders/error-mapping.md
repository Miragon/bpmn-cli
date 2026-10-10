---
type: regex
pattern: '^(?=[\s\S]*<camunda:errorEventDefinition\b(?=[^>]*errorRef="[^"]+")(?=[^>]*expression="\$\{declined\}"))(?=[\s\S]*<bpmn:error\b[^>]*errorCode="CARD_DECLINED")'
target: { source: file, path: payment.bpmn }
---
