// AUTHORED-BY Claude Sonnet 5
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SafetyContext } from "@/lib/inference/types";
import { SafetyContextForm } from "./safety-context-form";

describe("SafetyContextForm", () => {
  it("reflects the current value's toggles + alarm flags", () => {
    const value: SafetyContext = {
      coeliacDiagnosed: true,
      strictAdherence: false,
      alarmFlags: { giBleeding: true },
    };
    render(<SafetyContextForm value={value} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/confirmed coeliac diagnosis/i)).toBeChecked();
    expect(screen.getByLabelText(/follow my diet strictly/i)).not.toBeChecked();
    expect(screen.getByLabelText(/gastrointestinal bleeding/i)).toBeChecked();
    expect(screen.getByLabelText(/unintended weight loss/i)).not.toBeChecked();
  });

  it("feeds EXACTLY the SafetyContext fields on change — never inventing a new field", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SafetyContextForm value={{}} onChange={onChange} />);
    // The <details> content is present but the toggle is still operable via testing-library
    // (jsdom doesn't hide <details> content from queries).
    await user.click(screen.getByLabelText(/confirmed coeliac diagnosis/i));
    expect(onChange).toHaveBeenLastCalledWith({ coeliacDiagnosed: true });

    await user.click(screen.getByLabelText(/follow my diet strictly/i));
    expect(onChange).toHaveBeenLastCalledWith({ strictAdherence: true });

    await user.click(screen.getByLabelText(/anaemia/i));
    expect(onChange).toHaveBeenLastCalledWith({ alarmFlags: { anaemia: true } });
  });

  it("never persists a network call — this is a pure controlled input", () => {
    // Sanity check: the component makes no fetch/XHR of its own.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<SafetyContextForm value={{}} onChange={vi.fn()} />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
