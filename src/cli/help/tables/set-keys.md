# Set keys

`bpmn set <file> <id> key=value`, also on `add`, `retype`, `connect`; `--unset <key>` removes (`set`, `retype`). The trigger keys, such as `timer=`: `bpmn guide triggers`.

any:
- `id`: Rename the element
- `name`: Display name
- `doc`: Documentation text
- `<prefix>:<attr>`: Vendor attribute
- `<property>`: Any attribute of the BPMN type by property name

sequenceFlow:
- `condition`: Condition expression
- `language`: Expression language of the condition
- `default`: true|false: make this flow the default flow of its source gateway/activity
- `source`: Redirect the flow: new source node id
- `target`: Redirect the flow: new target node id
- `condition.<key>`: Attribute of the condition expression

flowNode:
- `default`: Id of the default outgoing flow of a gateway/activity
- `lane`: Lane id the node belongs to

event:
- `trigger`: Event trigger: none|message|timer|error|signal|escalation|conditional|link|compensate|terminate|cancel
- `nonInterrupting`: true|false: boundary events and event sub-process start events
- `definition.<key>`: Attribute of the event definition

activity:
- `loop`: none|standard|parallel|sequential
- `cardinality`: Multi-instance loop cardinality expression
- `completion`: Multi-instance completion condition expression
- `loop.<key>`: Attribute of the loop characteristics

subProcess:
- `expanded`: true|false: draw the sub-process expanded or collapsed
- `triggeredByEvent`: true|false: event sub-process

sendTask, receiveTask:
- `message`: Message name of a send / receive task

messageFlow:
- `message`: Message name of a message flow

businessRuleTask:
- `calledDecision`: The decision the task calls

conditionalEvent:
- `condition.<key>`: Attribute of the condition expression of a conditional event

textAnnotation:
- `text`: Annotation text
