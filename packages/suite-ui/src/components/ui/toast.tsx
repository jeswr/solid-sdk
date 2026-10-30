// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { type ExternalToast, toast as sonnerToast } from "sonner";

export const toastDurations = {
  default: 5000,
  undo: 8000,
  error: Number.POSITIVE_INFINITY,
} as const;
function options(data: Pick<ExternalToast, "action" | "duration"> = {}, error = false) {
  // React-node/localised labels opt into Undo through Sonner's existing duration option.
  const undo =
    data.duration === toastDurations.undo ||
    (data.action &&
      typeof data.action === "object" &&
      "label" in data.action &&
      data.action.label === "Undo");
  return {
    duration: error ? toastDurations.error : undo ? toastDurations.undo : toastDurations.default,
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
  message: notify,
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
