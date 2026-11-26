// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  BUILTIN_TEMPLATES,
  type TemplateApp,
  TemplateImageError,
  type UserTemplate,
} from "@jeswr/suite-templates";
import { Button, TemplateGallery, type TemplateGalleryItem, toast } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type PodSession, usePodSessionState } from "@/lib/session/pod-session";
import { createFromTemplate, type SuiteTemplate } from "@/lib/templates/create";
import { templatesForSession } from "@/lib/templates/store";
export function TemplatePicker({
  session,
  app,
  open,
  onOpenChange,
  beforeOpen,
}: {
  session: PodSession;
  app?: TemplateApp | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beforeOpen?: (() => Promise<void>) | undefined;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<UserTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries collection loading
  useEffect(() => {
    const token = ++generation.current;
    setUsers([]);
    if (!open) return;
    setLoading(true);
    setError(undefined);
    void templatesForSession(session)
      .then((store) => store.list(app))
      .then((items) => {
        if (token === generation.current) setUsers(items);
      })
      .catch(() => {
        if (token === generation.current)
          setError("Couldn't load your templates. Built-in templates are still available.");
      })
      .finally(() => {
        if (token === generation.current) setLoading(false);
      });
    return () => {
      ++generation.current;
    };
  }, [session, app, open, attempt]);
  const templates: SuiteTemplate[] = [
    ...BUILTIN_TEMPLATES.filter((item) => !app || item.app === app),
    ...users,
  ];
  const items: TemplateGalleryItem[] = templates.map((item) =>
    item.source === "builtin" ? item : { id: item.id, source: "user", ...item.data },
  );
  const run = async (work: () => Promise<void>) => {
    const token = generation.current;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      if (generation.current === token)
        toast.error(
          error instanceof TemplateImageError
            ? error.message
            : "Couldn't complete the template action. Please try again.",
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <TemplateGallery
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      loading={loading}
      busy={busy}
      error={error}
      onRetry={() => setAttempt((value) => value + 1)}
      onChoose={(item) => {
        const template = templates.find((value) => value.id === item.id);
        if (!template) return;
        void run(async () => {
          const token = generation.current;
          const content =
            template.source === "user"
              ? await (await templatesForSession(session)).content(template)
              : undefined;
          const href = await createFromTemplate(session, template, content);
          await beforeOpen?.();
          if (generation.current !== token) return;
          onOpenChange(false);
          router.push(href);
        });
      }}
      onDelete={(item) => {
        const template = users.find((value) => value.id === item.id);
        if (template)
          void run(async () => {
            await (await templatesForSession(session)).delete(template);
            setUsers((current) => current.filter((value) => value.id !== template.id));
          });
      }}
    />
  );
}
export function TemplateLauncher({
  app,
  label = "From template…",
  session: provided,
  beforeOpen,
}: {
  app?: TemplateApp;
  label?: string;
  session?: PodSession;
  beforeOpen?: () => Promise<void>;
}) {
  const state = usePodSessionState();
  const session = provided ?? (state.status === "ready" ? state.session : undefined);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" disabled={!session} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {session && (
        <TemplatePicker
          key={`${session.webId}:${session.storageUrl}`}
          session={session}
          app={app}
          beforeOpen={beforeOpen}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
