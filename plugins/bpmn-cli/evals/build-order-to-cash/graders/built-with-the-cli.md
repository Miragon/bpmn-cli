---
type: llm
focus: trace
---

PASS only if all of these hold in the transcript:
1. order-to-cash.bpmn was produced by running BPMN tool commands (for example `bpmn new`, `bpmn apply`, `bpmn add`), not by writing BPMN XML by hand (no file write of XML content, no heredoc, echo or script that emits `<bpmn:` markup into the .bpmn file).
2. The model was validated with a tool and the agent reports it as valid, without errors.
3. The elements the agent created have descriptive ids that say what they are (such as Activity_CheckOrder, Gateway_OrderOk, Lane_Vertrieb), not generic or numbered ids such as Task_1, Gateway_2 or Activity_0k3x9qa.
FAIL if any of them is violated or cannot be seen in the transcript.
