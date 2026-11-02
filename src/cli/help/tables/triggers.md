# Triggers

`bpmn add <file> <kind>:<trigger> [key=value…]`. `timer=`: `R/PT1H` a cycle, `PT5M` a duration, a date a date. Without `message=`: no `messageRef` (connector throw events).

- `none`: start, end, throw
- `message` `message=`: start, end, catch, throw, boundary, send, receive
- `timer` `timer=`: start, catch, boundary
- `error` `error=` `errorCode=`: start, end, boundary
- `signal` `signal=`: start, end, catch, throw, boundary
- `escalation` `escalation=` `escalationCode=`: start, end, throw, boundary
- `conditional` `when=`: start, catch, boundary
- `link` `link=`: catch, throw
- `compensate`: start, end, throw, boundary
- `terminate`: end
- `cancel`: end, boundary
