<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-kfx.2 interpretation notes

1. **Session de-duplication** (brief, Task): the brief specifies `(issue, assignee)`,
   while the reference Announcer currently keys assignment transitions. Options:
   de-duplicate the pair, or copy the reference's transition key. Chosen: the
   explicit brief's pair, including when a user clears and later restores an assignee.
2. **Creation** (brief, Task: "a user edit changes the assignee"): options: notify
   on initial creation too, or only edits of existing issues. Chosen: existing-issue
   edits only; creation and ordinary store writes remain silent.
3. **Discovery failures** (brief, Task: injectable `onError`): the existing PM sender
   throws for missing/unreadable inboxes as well as refused targets. Options: suppress
   its `NoInboxError` as solid-issues does, or report sender failures through the hook.
   Chosen: report all sender failures, keeping PM's existing discovery contract unchanged.
