---
type: regex
pattern: '^(?=[\s\S]*<zeebe:taskDefinition\b[^>]*type="create-credit-note")(?=[\s\S]*<zeebe:taskDefinition\b[^>]*type="send-rejection-mail")'
target: { source: file, path: retoure.bpmn }
---
