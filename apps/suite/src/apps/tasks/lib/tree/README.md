<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Task trees

Pure operations over complete, unfiltered forests of `TreeTask` projections. No RDF, I/O,
React, clocks or third-party dependencies. Missing parents, duplicate IDs, cycles, invalid
states/keys and sibling key collisions throw `TaskTreeError` before returning any changes.
Root tasks omit `parentId`; IDs are opaque and never normalised. Pass one ordering domain
(project/section) at a time; cross-project persistence is outside this library.

`moveTask(tasks, id, parentId, index)` uses an index among destination siblings sorted by
ordinary string comparison, after removing the moved task. `undefined` means root. Keys use
`src/lib/order`'s base-62 fractional scheme. A move changes only the moved root's parent/key;
its descendants travel with it. Indent appends to the previous sibling's children. Outdent
inserts immediately after the former parent. Boundary operations reject with a typed error.
`deleteSubtree` removes the root and all descendants.

`setTaskCompletion(tasks, id, state, options)` defaults to changing only the requested state.
`completeDescendants: true` explicitly completes the entire subtree. `completeAncestors: true`
completes successive ancestors whose direct children are all completed. Reopening affects only
the target; requesting cascading reopening is rejected. Structural operations never change
completion states. Call the recurring-completion planner separately before applying projected
state changes; the caller owns occurrence creation, timestamps and conditional persistence.

`getProgress(tasks, id)` counts direct children. Pass `"descendants"` for all depths. The parent
is excluded and empty groups are not complete.

Every operation returns a new array in the original snapshot order, preserving extra fields
and unchanged task objects. The array's order is not display order: sort each sibling group by
`orderKey`. Inputs are never mutated. Apply/persist the returned snapshot atomically with the
data layer's concurrency checks; retain the previous snapshot for undo.
