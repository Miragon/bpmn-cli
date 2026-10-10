---
type: regex
pattern: '^(?=[\s\S]*bpmnElement="StartEvent_1"[^>]*>\s*<dc:Bounds x="172" y="182")(?=[\s\S]*bpmnElement="Activity_0k3x9qa"[^>]*>\s*<dc:Bounds x="270" y="160")(?=[\s\S]*bpmnElement="Gateway_1hd8x2m"[^>]*>\s*<dc:Bounds x="435" y="175")(?=[\s\S]*bpmnElement="Activity_1v0w8zr"[^>]*>\s*<dc:Bounds x="[\d.]+" y="160")'
target: { source: file, path: purchase-request.bpmn }
---
