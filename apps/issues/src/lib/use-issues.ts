"use client";

import { useCallback, useEffect, useState } from "react";
import { IssuesDocument, type NewIssueInput, type IssuePatch } from "@/lib/issues-document";
import { ConflictError } from "@/lib/errors";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { Issue, IssueState } from "@/lib/issue";

/** A plain, render-friendly snapshot of an issue (decoupled from the RDF wrapper). */
export interface IssueView {
  id: string;
  title: string;
  description?: string;
  state: IssueState;
  created?: Date;
  modified?: Date;
  assignee?: string;
  dateDue?: Date;
}

function toView(issue: Issue): IssueView {
  return {
    id: issue.id,
    title: issue.title ?? "(untitled)",
    description: issue.description,
    state: issue.state,
    created: issue.created,
    modified: issue.modified,
    assignee: issue.assignee,
    dateDue: issue.dateDue,
  };
}

function describe(e: unknown): string {
  if (e instanceof ConflictError) return e.message;
  if (e instanceof RdfFetchError) {
    if (e.status === 401 || e.status === 403) return "You don't have access to this pod resource.";
    return `Could not read the issue list (HTTP ${e.status ?? "?"}).`;
  }
  if (e instanceof Error) return e.message;
  return "Unexpected error.";
}

export interface UseIssues {
  issues: IssueView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: Omit<NewIssueInput, "creator">) => Promise<void>;
  update: (id: string, patch: IssuePatch) => Promise<void>;
  setState: (id: string, state: IssueState) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * Loads and mutates the issue list. Every mutation re-opens the document so the
 * ETag is current, then conditionally PUTs and refreshes — a {@link ConflictError}
 * (412) is rethrown for the caller to surface and retry.
 */
export function useIssues(issuesUrl: string | null, creator: string | null): UseIssues {
  const [issues, setIssues] = useState<IssueView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!issuesUrl) return;
    setLoading(true);
    setError(null);
    try {
      const doc = await IssuesDocument.open(issuesUrl);
      setIssues(doc.list().map(toView));
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoading(false);
    }
  }, [issuesUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (apply: (doc: IssuesDocument) => void) => {
      if (!issuesUrl) throw new Error("Not signed in.");
      const doc = await IssuesDocument.open(issuesUrl);
      apply(doc);
      await doc.save();
      await refresh();
    },
    [issuesUrl, refresh],
  );

  return {
    issues,
    loading,
    error,
    refresh,
    create: (input) => mutate((d) => d.create({ ...input, creator: creator ?? undefined })),
    update: (id, patch) => mutate((d) => d.update(id, patch)),
    setState: (id, state) => mutate((d) => d.setState(id, state)),
    remove: (id) => mutate((d) => d.remove(id)),
  };
}
