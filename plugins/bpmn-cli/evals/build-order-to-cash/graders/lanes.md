---
type: regex
pattern: '^(?=[\s\S]*<bpmn:laneSet\b)(?=[\s\S]*<bpmn:lane\b[^>]*name="Vertrieb")(?=[\s\S]*<bpmn:lane\b[^>]*name="Lager")(?=[\s\S]*<bpmn:lane\b[^>]*name="Buchhaltung")'
target: { source: file, path: order-to-cash.bpmn }
---
