// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Textarea } from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { addIssueComment, issueComments } from "../../lib/issues/model";
import type { StoredTask } from "../../lib/model/store";
import { useTasks } from "../../state/tasks-context";

export function IssuesDetail({
  stored,
  readOnly = false,
}: {
  stored: StoredTask;
  readOnly?: boolean;
}) {
  const tasks = useTasks();
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignee, setAssignee] = useState(stored.task.assignee ?? "");
  useEffect(() => setAssignee(stored.task.assignee ?? ""), [stored.task.assignee]);
  return (
    <section aria-label="Issue properties" className="tsk-detail-stack">
      <p>State: {stored.task.state === "closed" ? "Closed" : "Open"}</p>
      <p>Priority category: {stored.task.priority ?? "None"}</p>
      {!readOnly && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void tasks.updateTask(stored, (task) => {
              task.assignee = assignee.trim() || undefined;
            });
          }}
        >
          <Input
            type="url"
            aria-label="Issue assignee"
            placeholder="Assignee WebID"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          />
          <Button type="submit" variant="outline">
            Save assignee
          </Button>
        </form>
      )}
      {!readOnly && (
        <Button
          variant="outline"
          onClick={() => {
            void tasks.updateTask(stored, (task) => {
              task.state = task.state === "closed" ? "open" : "closed";
            });
          }}
        >
          {stored.task.state === "closed" ? "Reopen issue" : "Close issue"}
        </Button>
      )}
      <h3>Comments</h3>
      <ol>
        {issueComments(stored.task).map((entry) => (
          <li key={entry.id}>
            <p>{entry.content}</p>
            <small>
              {entry.author === tasks.webId ? "You" : (entry.author ?? "Unknown author")}{" "}
              {entry.created?.toLocaleString("en-GB")}
            </small>
          </li>
        ))}
      </ol>
      {!readOnly && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!comment.trim() || saving) return;
            const body = comment;
            const id = crypto.randomUUID(),
              now = new Date();
            setSaving(true);
            void tasks
              .updateTask(stored, (task) => addIssueComment(task, body, tasks.webId, id, now))
              .then((saved) => {
                if (saved) setComment((current) => (current === body ? "" : current));
              })
              .finally(() => setSaving(false));
          }}
        >
          <Textarea
            aria-label="Comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button type="submit" disabled={!comment.trim() || saving}>
            Add comment
          </Button>
        </form>
      )}
    </section>
  );
}
