# Operations

`bpmn apply <file> <ops.json>`: `[{"op": "<name>", …}]`; `*` required. Keys are the flags in lowerCamelCase, `set` holds the `key=value`s. `as`, `flowAs`, `outAs`, `refAs`, `joinAs` name what an operation creates, `"as": "$check"`, for later ones.

- `add`: kind* name id as flowAs outAs refAs after before flow in on to lane flowName flowId condition language default ifAbsent set process blackBox members
- `connect`: source* target* id as refAs ifAbsent set
- `set`: id* set unset refAs
- `remove`: ids* bridge withBranch ifExists
- `retype`: id* kind* set unset refAs
- `move`: ids* after before flow in on lane
- `order`: id* flows lanes pools
- `ext`: id* action* type attrs body xml replace index slot
- `split`: after* kind name id as join joinId joinAs joinName branches*
- `layout`: -
- `tidy`: ids
- `compact`: ids
- `place`: ids path branch rowOf below above columnOf after before side
- `color`: ids path branch color*
- `label`: id* side*
- `route`: id* exit entry
- `space`: after below by
- split `branches`: nodes* flowName flowId condition language default
- split `nodes`: kind* name id as flowAs refAs lane flowName flowId condition language default set process blackBox members
