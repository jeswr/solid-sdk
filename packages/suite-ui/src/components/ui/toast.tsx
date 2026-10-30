// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { type ExternalToast, toast as sonnerToast, type ToastT } from "sonner";

export const toastDurations = {
  default: 5000,
  undo: 8000,
  error: Number.POSITIVE_INFINITY,
} as const;
function options(data: Pick<ExternalToast, "id" | "action" | "duration"> = {}, error = false) {
  // Sonner merges by ID against its history, including previously dismissed toasts.
  const previous =
    data.id === undefined
      ? undefined
      : sonnerToast
          .getHistory()
          .find((entry): entry is ToastT => entry.id === data.id && !("dismiss" in entry));
  const action = "action" in data ? data.action : previous?.action;
  const undo = action && typeof action === "object" && "label" in action && action.label === "Undo";
  // Omitted actions retain their window; replacing/removing one recalculates the default.
  const duration =
    data.duration ??
    (!("action" in data) && previous?.type !== "error" ? previous?.duration : undefined) ??
    (undo ? toastDurations.undo : toastDurations.default);
  return {
    duration: error ? toastDurations.error : duration,
    ...(error ? { closeButton: true, dismissible: true } : {}),
  };
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
  sonnerToast(announcement(message), { ...data, ...options(data) });

/** Suite durations apply to all Sonner entry points, including resolved/rejected promises. */
export const toast: typeof sonnerToast = Object.assign(notify, sonnerToast, {
  success: (message: Message, data?: ExternalToast) =>
    sonnerToast.success(announcement(message), { ...data, ...options(data) }),
  info: (message: Message, data?: ExternalToast) =>
    sonnerToast.info(announcement(message), { ...data, ...options(data) }),
  warning: (message: Message, data?: ExternalToast) =>
    sonnerToast.warning(announcement(message), { ...data, ...options(data) }),
  message: (message: Message, data?: ExternalToast) =>
    sonnerToast.message(announcement(message), { ...data, ...options(data) }),
  error: (message: Message, data?: ExternalToast) =>
    sonnerToast.error(announcement(message, true), { ...data, ...options(data, true) }),
  custom: (jsx: Parameters<typeof sonnerToast.custom>[0], data?: ExternalToast) =>
    sonnerToast.custom(jsx, { ...data, ...options(data) }),
  promise: (<T,>(
    promise: Parameters<typeof sonnerToast.promise<T>>[0],
    data?: Parameters<typeof sonnerToast.promise<T>>[1],
  ) => {
    if (!data) return sonnerToast.promise(promise);
    const result = async (value: unknown, kind: "success" | "error") => {
      const renderer = data[kind];
      const rendered = typeof renderer === "function" ? await renderer(value as T) : renderer;
      const extended =
        rendered && typeof rendered === "object" && "message" in rendered
          ? rendered
          : { message: rendered };
      return {
        ...extended,
        ...options({ ...data, ...extended }, kind === "error"),
        message: announcement(extended.message, kind === "error"),
      };
    };
    return sonnerToast.promise(promise, {
      ...data,
      ...options(data),
      ...(data.success !== undefined ? { success: (value: T) => result(value, "success") } : {}),
      ...(data.error !== undefined ? { error: (value: unknown) => result(value, "error") } : {}),
    });
  }) satisfies typeof sonnerToast.promise,
});
