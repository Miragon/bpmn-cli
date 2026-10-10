---
description: 'An unrelated Python question: the BPMN skill must not fire'
tags: [negative]
runs: 2
max_turns: 5
timeout_seconds: 180
allowed_tools: [Skill, Read]
---

Quick Python question. What is the actual difference between

```python
squares = [x * x for x in range(10_000_000)]
```

and

```python
squares = (x * x for x in range(10_000_000))
```

and when should I use which?
