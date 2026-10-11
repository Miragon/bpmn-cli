---
type: regex
pattern: 'bpmnElement="Gateway_InvoiceCorrect"[^>]*>\s*<dc:Bounds [^>]*>\s*<bpmndi:BPMNLabel[^>]*>\s*<dc:Bounds (?:x="(?:3[7-9]\d|4[0-6]\d)(?:\.\d+)?" y="(?:\d|[1-9]\d|1[0-5]\d|16[01])(?:\.\d+)?"|x="\d+(?:\.\d+)?" y="(?:\d|[1-9]\d|1[0-3]\d|14[0-5])(?:\.\d+)?"|x="46[1-9](?:\.\d+)?" y="(?:22[6-9]|2[3-7]\d|28[0-5])(?:\.\d+)?"|x="(?:\d|[1-9]\d|[12]\d\d|3[0-6]\d|37[0-8])(?:\.\d+)?" y="(?:24[1-9]|2[5-7]\d|28[0-5])(?:\.\d+)?")'
target: { source: file, path: invoice-approval.bpmn }
---
