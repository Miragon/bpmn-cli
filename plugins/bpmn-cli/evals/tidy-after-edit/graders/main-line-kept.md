---
type: regex
pattern: '^(?=[\s\S]*bpmnElement="Event_InvoiceReceived"[^>]*>\s*<dc:Bounds x="172" y="182")(?=[\s\S]*bpmnElement="Activity_CheckInvoice"[^>]*>\s*<dc:Bounds x="270" y="160")(?=[\s\S]*bpmnElement="Gateway_InvoiceCorrect"[^>]*>\s*<dc:Bounds x="435" y="175")(?=[\s\S]*bpmnElement="Activity_ApproveInvoice"[^>]*>\s*<dc:Bounds x="550" y="160")(?=[\s\S]*bpmnElement="Activity_PayInvoice"[^>]*>\s*<dc:Bounds x="720" y="160")(?=[\s\S]*bpmnElement="Event_InvoicePaid"[^>]*>\s*<dc:Bounds x="892" y="182")'
target: { source: file, path: invoice-approval.bpmn }
---
