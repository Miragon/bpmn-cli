---
type: llm
focus: last_message
---

PASS if the reply describes the model that was built in order-to-cash.bpmn: a company pool with the lanes Vertrieb, Lager and Buchhaltung; the customer as a separate pool; the order arriving as a message that starts the process; a check by Vertrieb with a rejection path that sends the customer a rejection and ends; picking, packing and shipping in Lager; and Buchhaltung sending the invoice and waiting for the payment before the order is complete.
FAIL if the reply says the file could not be created or is invalid, leaves out one of these parts, or describes a different process.
