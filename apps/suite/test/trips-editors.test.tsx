// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { BookingEditor } from "../src/apps/trips/components/editors";
import { ReadNotice } from "../src/apps/trips/components/read-notice";

const addBooking = vi.fn();
vi.mock("../src/apps/trips/state/trips-context", () => ({
  useTrips: () => ({ state: { addBooking } }),
}));
vi.mock("@jeswr/suite-ui", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrapper,
    DialogContent: Wrapper,
    DialogTitle: Wrapper,
    DialogDescription: Wrapper,
    Input: (props: React.ComponentProps<"input">) => <input {...props} />,
    Label: (props: React.ComponentProps<"label">) => (
      <label {...props} htmlFor={props.htmlFor}>
        {props.children}
      </label>
    ),
    Button: (props: React.ComponentProps<"button">) => <button {...props} />,
    Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
    Select: Wrapper,
    SelectContent: Wrapper,
    SelectItem: Wrapper,
    SelectTrigger: Wrapper,
    SelectValue: Wrapper,
  };
});
const trip = {
  id: "https://pod.example/trips/one#it",
  name: "Example",
  startDate: "2026-12-01",
  endDate: "2026-12-02",
  reservations: [],
};
const host = document.createElement("div");
document.body.append(host);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = undefined;
  vi.clearAllMocks();
});
async function mount() {
  root = createRoot(host);
  const close = vi.fn();
  await act(() => root?.render(<BookingEditor trip={trip} close={close} />));
  return close;
}
function field(name: string) {
  return host.querySelector<HTMLInputElement>(`input[name="${name}"]`) as HTMLInputElement;
}
async function submit() {
  await act(() =>
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("uses datetime-local controls and preserves a separately entered optional offset", async () => {
  const close = await mount();
  expect(field("start").type).toBe("datetime-local");
  expect(field("end").type).toBe("datetime-local");
  field("start").value = "2026-12-01T09:30";
  field("startOffset").value = "+02:00";
  field("end").value = "2026-12-01T12:30";
  field("endOffset").value = "+01:00";
  field("title").value = "My onward flight";
  await submit();
  expect(addBooking).toHaveBeenCalledWith(
    trip.id,
    expect.objectContaining({
      title: "My onward flight",
      start: "2026-12-01T09:30:00+02:00",
      end: "2026-12-01T12:30:00+01:00",
      trust: "verified",
    }),
  );
  expect(close).toHaveBeenCalledOnce();
});
it("leaves the time zone unspecified when the confirmation has no offset", async () => {
  await mount();
  await submit();
  expect(addBooking).toHaveBeenCalledWith(
    trip.id,
    expect.objectContaining({ start: "2026-12-01T12:00:00", end: undefined }),
  );
});
it("explains invalid offsets and backwards times without creating bookings", async () => {
  const close = await mount();
  field("startOffset").value = "+25:00";
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Optional UTC offsets");
  field("startOffset").value = "";
  field("end").value = "2026-11-30T12:00";
  await submit();
  expect(addBooking).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
it("shows skipped counts and distinguishes capped partial scans from ordinary load failures", () => {
  expect(renderToString(<ReadNotice notice={{ skipped: 0, capped: false }} />)).toBe("");
  const partial = renderToString(<ReadNotice notice={{ skipped: 3, capped: true }} scan />);
  expect(partial).toContain("Some sources skipped");
  expect(partial).toContain("3");
  expect(partial).toContain("scan limit");
  expect(partial).toContain("partial results");
  const load = renderToString(<ReadNotice notice={{ skipped: 2, capped: false }} />);
  expect(load).toContain("saved items could not be loaded");
  expect(load).toContain("2");
  expect(load).not.toContain("scan limit");
});
