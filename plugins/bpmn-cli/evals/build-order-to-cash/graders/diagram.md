---
type: regex
pattern: '<bpmndi:BPMNDiagram\b[\s\S]*<bpmndi:BPMNShape\b[\s\S]*<bpmndi:BPMNEdge\b'
target: { source: file, path: order-to-cash.bpmn }
---
