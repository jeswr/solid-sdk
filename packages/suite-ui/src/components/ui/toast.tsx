// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { isValidElement } from "react";
import { type ExternalToast, toast as sonnerToast, type ToastT } from "sonner";

export const toastDurations = {
  default: 5000,
  undo: 8000,
  error: Number.POSITIVE_INFINITY,
} as const;
type ToastId = string | number;
type ToastState = { hasUndo: boolean; explicitDuration: number | undefined };
type PolicyOptions = Pick<
  ExternalToast,
  "id" | "action" | "cancel" | "duration" | "onAutoClose" | "onDismiss"
>;
const toastStates = new Map<ToastId, ToastState>();
let nextPromiseId = 0;

function buttons(data: PolicyOptions, getId: () => ToastId | undefined) {
  const wrapped: Pick<ExternalToast, "action" | "cancel"> = {};
  for (const key of ["action", "cancel"] as const) {
    if (!(key in data)) continue;
    const button = data[key];
    wrapped[key] =
      button && typeof button === "object" && "label" in button
        ? {
            ...button,
            onClick: (event) => {
              button.onClick?.(event);
              // Sonner removes button-dismissed toasts without lifecycle callbacks.
              const id = getId();
              if (!event.defaultPrevented && id !== undefined) toastStates.delete(id);
            },
          }
        : button;
  }
  return wrapped;
}
function options(data: PolicyOptions = {}, error = false, getId = () => data.id) {
  const previous = data.id === undefined ? undefined : toastStates.get(data.id);
  const action = data.action;
  const state: ToastState = {
    hasUndo:
      "action" in data
        ? !!(action && typeof action === "object" && "label" in action && action.label === "Undo")
        : (previous?.hasUndo ?? false),
    // Replacing an action resets its selected window unless a new duration is supplied.
    explicitDuration:
      data.duration ?? (!("action" in data) ? previous?.explicitDuration : undefined),
  };
  const duration =
    state.explicitDuration ?? (state.hasUndo ? toastDurations.undo : toastDurations.default);
  const lifecycle = {
    // Omitted callbacks retain the lifecycle wrappers already installed on this ID.
    ...(!previous || "onAutoClose" in data
      ? {
          onAutoClose: (entry: ToastT) => {
            toastStates.delete(entry.id);
            data.onAutoClose?.(entry);
          },
        }
      : {}),
    ...(!previous || "onDismiss" in data
      ? {
          onDismiss: (entry: ToastT) => {
            toastStates.delete(entry.id);
            data.onDismiss?.(entry);
          },
        }
      : {}),
  };
  return {
    state,
    lifecycle,
    options: {
      duration: error ? toastDurations.error : duration,
      ...(error ? { closeButton: true, dismissible: true } : {}),
      // Sonner retains dismissed entries; a fresh record must not inherit their actions.
      ...(!previous && !("action" in data) ? { action: undefined } : {}),
      ...buttons(data, getId),
      ...lifecycle,
    },
  };
}
function publish(
  create: (data: ExternalToast) => ToastId,
  data: ExternalToast = {},
  error = false,
) {
  let id: ToastId;
  const prepared = options(data, error, () => id);
  id = create({ ...data, ...prepared.options });
  toastStates.set(id, prepared.state);
  return id;
}
type Message = Parameters<typeof sonnerToast>[0];
function announcement(message: Message, error = false) {
  return (
    <span role={error ? "alert" : "status"}>
      {typeof message === "function" ? message() : message}
    </span>
  );
}
const notify = (message: Message, data?: ExternalToast) =>
  publish((options) => sonnerToast(announcement(message), options), data);

/** Suite durations apply to all Sonner entry points, including resolved/rejected promises. */
export const toast: typeof sonnerToast = Object.assign(notify, sonnerToast, {
  success: (message: Message, data?: ExternalToast) =>
    publish((options) => sonnerToast.success(announcement(message), options), data),
  info: (message: Message, data?: ExternalToast) =>
    publish((options) => sonnerToast.info(announcement(message), options), data),
  warning: (message: Message, data?: ExternalToast) =>
    publish((options) => sonnerToast.warning(announcement(message), options), data),
  message: (message: Message, data?: ExternalToast) =>
    publish((options) => sonnerToast.message(announcement(message), options), data),
  error: (message: Message, data?: ExternalToast) =>
    publish((options) => sonnerToast.error(announcement(message, true), options), data, true),
  loading: (message: Message, data?: ExternalToast) =>
    publish((options) => sonnerToast.loading(announcement(message), options), data),
  custom: (jsx: Parameters<typeof sonnerToast.custom>[0], data?: ExternalToast) =>
    publish((options) => sonnerToast.custom(jsx, options), data),
  dismiss: (id?: ToastId) => {
    if (id === undefined) toastStates.clear();
    else toastStates.delete(id);
    return sonnerToast.dismiss(id);
  },
  promise: (<T,>(
    promise: Parameters<typeof sonnerToast.promise<T>>[0],
    data?: Parameters<typeof sonnerToast.promise<T>>[1],
  ) => {
    if (!data) return sonnerToast.promise(promise);
    // A stable ID also lets us track promises that create their first toast on settlement.
    const id = data.id ?? `suite-ui-promise-${++nextPromiseId}`;
    const initial = options({ ...data, id });
    toastStates.set(id, initial.state);
    let hasResult = false;
    const result = async (value: unknown, kind: "success" | "error") => {
      const renderer = data[kind];
      const rendered = typeof renderer === "function" ? await renderer(value as T) : renderer;
      const extended =
        rendered && typeof rendered === "object" && "message" in rendered
          ? rendered
          : { message: rendered };
      const resultId = extended.id ?? id;
      const prepared = options({ ...extended, id: resultId }, kind === "error");
      toastStates.set(resultId, prepared.state);
      hasResult = true;
      return {
        // Without a loading toast, shared actions and lifecycle handlers are first
        // installed when the promise settles rather than inherited from a prior toast.
        ...(data.loading === undefined
          ? { ...initial.lifecycle, ...buttons(data, () => resultId) }
          : {}),
        ...extended,
        ...prepared.options,
        id: resultId,
        message: announcement(extended.message, kind === "error"),
      };
    };
    const observe = (pending: Promise<T>) =>
      pending.then((value) => {
        // Sonner displays resolved React elements without invoking a result renderer.
        if (isValidElement(value)) hasResult = true;
        return value;
      });
    return sonnerToast.promise(
      typeof promise === "function" ? () => observe(promise()) : observe(promise),
      {
        ...data,
        ...initial.options,
        id,
        ...(data.loading !== undefined ? { loading: announcement(data.loading) } : {}),
        ...(data.success !== undefined ? { success: (value: T) => result(value, "success") } : {}),
        ...(data.error !== undefined ? { error: (value: unknown) => result(value, "error") } : {}),
        finally: () => {
          // Sonner dismisses unresolved loading toasts internally, bypassing our dismiss().
          if (!hasResult) toastStates.delete(id);
          return data.finally?.();
        },
      },
    );
  }) satisfies typeof sonnerToast.promise,
});
