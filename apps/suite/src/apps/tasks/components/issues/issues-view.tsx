// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, LoadingSkeleton } from "@jeswr/suite-ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { decodeRef, encodeRef } from "@/lib/refs";
import { usePageRouteParams, useRoutePathname } from "@/lib/route-params";
import { isIssuesProject } from "../../lib/issues/model";
import type { IssuesTaskStore } from "../../lib/issues/store";
import {
  type IssueColumn,
  type IssueFilters,
  issueColumns,
  issueRow,
  issueTable,
} from "../../lib/issues/table";
import { useTasks } from "../../state/tasks-context";
import "./issues.css";

const defaults: IssueFilters = { state: "open", assignee: "anyone", label: "", text: "" };
export function IssuesView({ trackerUrl }: { trackerUrl?: string }) {
  const tasks = useTasks(),
    params = useSearchParams(),
    router = useRouter();
  const pathname = useRoutePathname();
  const issuesStore = tasks.cache.store as IssuesTaskStore;
  const [filters, setFilters] = useState(defaults);
  const [sort, setSort] = useState<IssueColumn>("created");
  const [descending, setDescending] = useState(true);
  const [board, setBoard] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState("");
  const requested = trackerUrl ?? params.get("tracker");
  useEffect(() => {
    if (!requested) return;
    let live = true;
    setOpening(true);
    setError("");
    void issuesStore
      .openTracker(requested)
      .then(async (urls) => {
        await tasks.cache.refreshProjects();
        if (live) {
          setOpening(false);
          const found = urls.find((url) =>
            tasks.cache.getSnapshot().projects.some((project) => project.url === url),
          );
          if (!found) setError("Couldn't open this tracker");
          else if (!trackerUrl) router.replace(`/tasks/issues/${encodeRef(found)}`);
        }
      })
      .catch(() => {
        if (live) {
          setOpening(false);
          setError("Couldn't open this tracker");
        }
      });
    return () => {
      live = false;
    };
  }, [requested, trackerUrl, issuesStore, tasks.cache, router]);
  const projects = tasks.projects.filter(isIssuesProject);
  const shown = trackerUrl ? projects.filter((project) => project.url === trackerUrl) : projects;
  const project = shown.find((project) => project.url === target) ?? shown[0];
  const rows = issueTable(
    shown.flatMap((project) =>
      (tasks.tasks[project.url]?.items ?? []).map((item) => issueRow(item, project)),
    ),
    filters,
    tasks.webId,
    sort,
    descending,
  );
  const labels = shown.flatMap((project) => project.tracker.labels);
  const loading =
    opening ||
    tasks.status === "loading" ||
    shown.some(
      (project) => !tasks.tasks[project.url] || tasks.tasks[project.url]?.status === "loading",
    );
  const href = (url: string) => {
    const query = new URLSearchParams(params.toString());
    query.set("task", encodeRef(url));
    return `${pathname}?${query}`;
  };
  const open = async () => {
    setOpening(true);
    setError("");
    try {
      const urls = await issuesStore.openTracker(input.trim());
      await tasks.cache.refreshProjects();
      const found = urls.find((url) =>
        tasks.cache.getSnapshot().projects.some((project) => project.url === url),
      );
      if (!found) throw new Error("No tracker");
      router.push(`/tasks/issues/${encodeRef(found)}`);
    } catch {
      setError("Couldn't open this tracker");
    } finally {
      setOpening(false);
    }
  };
  const failures = Object.entries(tasks.tasks).filter(
    ([url, load]) => load.status === "error" && (!trackerUrl || trackerUrl === url),
  );
  return (
    <div className="tsk-content tsk-issues">
      <h1>{trackerUrl ? (shown[0]?.tracker.title ?? "Issues") : "Issues"}</h1>
      <form
        className="tsk-issues-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <Input
          aria-label="WebID or tracker URL"
          placeholder="WebID or tracker URL"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button variant="outline" type="submit" disabled={!input.trim() || opening}>
          Open another tracker
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {!trackerUrl && (
        <ul aria-label="Issue trackers">
          {projects.map((project) => (
            <li key={project.url}>
              <Link href={`/tasks/issues/${encodeRef(project.url)}`}>
                {project.tracker.title ?? "Issues"}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {failures.map(([url]) => (
        <p role="alert" key={url}>
          Couldn't load tracker{" "}
          <Button
            variant="ghost"
            onClick={() => {
              void tasks.cache.retryProject(url);
            }}
          >
            Retry
          </Button>
        </p>
      ))}
      {shown.some((project) => !issuesStore.canEdit(project)) && (
        <p role="status">You can view this tracker but not edit it</p>
      )}
      {project && (
        <form
          className="tsk-issues-controls"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newTitle.trim() || creating || !issuesStore.canCreate(project)) return;
            const title = newTitle;
            setCreating(true);
            void tasks
              .createTask(project, { title })
              .then((saved) => {
                if (saved) setNewTitle((current) => (current === title ? "" : current));
              })
              .finally(() => setCreating(false));
          }}
        >
          {shown.length > 1 && (
            <label>
              Tracker{" "}
              <select
                aria-label="New issue tracker"
                value={project.url}
                onChange={(event) => setTarget(event.target.value)}
              >
                {shown.map((project) => (
                  <option key={project.url} value={project.url}>
                    {project.tracker.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Input
            aria-label="New issue title"
            placeholder="New issue"
            value={newTitle}
            disabled={!issuesStore.canCreate(project)}
            onChange={(event) => setNewTitle(event.target.value)}
          />
          <Button
            type="submit"
            disabled={!newTitle.trim() || creating || !issuesStore.canCreate(project)}
          >
            New issue
          </Button>
        </form>
      )}
      <section className="tsk-issues-controls" aria-label="Issue filters">
        <label>
          State{" "}
          <select
            value={filters.state}
            onChange={(event) =>
              setFilters({ ...filters, state: event.target.value as IssueFilters["state"] })
            }
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Assignee{" "}
          <select
            value={filters.assignee}
            onChange={(event) =>
              setFilters({ ...filters, assignee: event.target.value as IssueFilters["assignee"] })
            }
          >
            <option value="anyone">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <label>
          Label{" "}
          <select
            value={filters.label}
            onChange={(event) => setFilters({ ...filters, label: event.target.value })}
          >
            <option value="">All labels</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
        <Input
          aria-label="Filter issues"
          placeholder="Search issues"
          value={filters.text}
          onChange={(event) => setFilters({ ...filters, text: event.target.value })}
        />
        <Button variant="outline" aria-pressed={board} onClick={() => setBoard(!board)}>
          {board ? "Table" : "Board"}
        </Button>
      </section>
      <p role="status">{rows.length} issues</p>
      {loading ? (
        <LoadingSkeleton preset="list" />
      ) : !rows.length ? (
        <p>{filters.state === "open" ? "No open issues" : "No issues match these filters"}</p>
      ) : board ? (
        <div className="tsk-issues-board">
          {(["open", "closed"] as const).map((state) => (
            <section key={state} aria-label={state === "open" ? "Open" : "Closed"}>
              <h2>{state === "open" ? "Open" : "Closed"}</h2>
              <ul>
                {rows
                  .filter(({ view }) => view.state === state)
                  .map(({ view }) => (
                    <li key={view.url}>
                      <Link data-task-url={view.url} href={href(view.url)}>
                        {view.title}
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="tsk-issues-table">
          <table>
            <caption className="sr-only">Issues</caption>
            <thead>
              <tr>
                {issueColumns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={sort === column ? (descending ? "descending" : "ascending") : "none"}
                  >
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSort(column);
                        setDescending(sort === column ? !descending : false);
                      }}
                    >
                      {column[0]?.toUpperCase()}
                      {column.slice(1)}
                    </Button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ view, labels, updated }) => (
                <tr key={view.url}>
                  <td>
                    <Link data-task-url={view.url} href={href(view.url)}>
                      {view.title}
                    </Link>
                  </td>
                  <td>{view.state === "open" ? "Open" : "Closed"}</td>
                  <td>{["High", "Medium", "Low", "None"][view.priority - 1]}</td>
                  <td>{labels}</td>
                  <td>{view.assignee === tasks.webId ? "Me" : (view.assignee ?? "Unassigned")}</td>
                  <td>{view.created?.toLocaleDateString("en-GB")}</td>
                  <td>{updated?.toLocaleDateString("en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
export function IssuesRoute() {
  const params = usePageRouteParams<{ tracker: string }>("/tasks/issues/[tracker]");
  if (!params) return <LoadingSkeleton preset="list" />;
  let url: string;
  try {
    url = decodeRef(params.tracker);
  } catch {
    return <p role="alert">Couldn't open this tracker</p>;
  }
  return <IssuesView trackerUrl={url} />;
}
