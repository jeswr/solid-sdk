<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# TSK-L5 conservative interpretations

1. **Depth and placement** (06-tasks §4.6; TSK-L5 tree brief): the first-cut UI has one level,
   while this parity core asks for trees. Options: enforce one level or support arbitrary depth.
   Implement arbitrary-depth forests. Indent appends under the preceding sibling; outdent places
   the whole subtree immediately after its former parent. Moves use a post-removal sibling index
   and the shared base-62 ordering keys, as requested by this brief rather than numeric RDF positions.
2. **Completion policy** (06-tasks §4.3; TSK-L5): options include upward completion only or
   also reopening ancestors and recalculating completion after structural edits. Implement only
   the requested explicit downward completion and configured upward completion. Both default off.
   Upward completion follows the edited task's ancestor chain when every direct child is done;
   reopening changes only the requested task. Moves/deletes do not change completion states.
3. **Progress depth** (06-tasks §2.8, §9 scenario 6; TSK-L5): count direct children or all
   descendants. Default to direct children (the existing UI contract), with an explicit descendants
   scope for nested progress. Exclude the parent; empty groups have zero counts and are not complete.
4. **Projection boundary** (00-sdk-assumptions §10; pure-library brief): this core operates on
   complete task forests with IDs, parent IDs, state and ordering keys. Persistence, timestamps,
   recurring occurrence creation and project/section adapters remain with the data layer. Callers
   must resolve recurrence before applying a tree completion transition; this is not a replacement
   for the existing recurring-completion planner.
