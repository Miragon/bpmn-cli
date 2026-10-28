---
type: regex
pattern: '^(?=[\s\S]*bpmnElement="startEvent_invoiceReceived"[^>]*>\s*<dc:Bounds x="172" y="182")(?=[\s\S]*bpmnElement="userTask_checkInvoice"[^>]*>\s*<dc:Bounds x="270" y="160")(?=[\s\S]*bpmnElement="gateway_invoiceCorrect"[^>]*>\s*<dc:Bounds x="435" y="175")(?=[\s\S]*bpmnElement="userTask_approveInvoice"[^>]*>\s*<dc:Bounds x="550" y="160")(?=[\s\S]*bpmnElement="serviceTask_payInvoice"[^>]*>\s*<dc:Bounds x="720" y="160")(?=[\s\S]*bpmnElement="endEvent_invoicePaid"[^>]*>\s*<dc:Bounds x="892" y="182")'
target: { source: file, path: invoice-approval.bpmn }
---
