// AUTHORED-BY Codex GPT-6.1-Sol
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { makeSession } from "../../test/session-harness";
import { SessionContext } from "@/lib/session/context";
import { ManualMeal } from "./manual-meal";

it("shows a short discovery failure while retaining the meal for retry", async () => {
  const { value, store } = makeSession();
  value.storage = async () => {
    throw Object.assign(new Error("GET https://private.example/storage failed"), {
      name: "CapabilitiesError", code: "network", url: "https://private.example/storage",
    });
  };
  render(<SessionContext.Provider value={value}><ManualMeal initialName="Rice" /></SessionContext.Provider>);
  await userEvent.click(screen.getByRole("button", { name: "Ate it now" }));
  expect(await screen.findByText("Couldn't sync: Failed to fetch (will retry)")).toBeInTheDocument();
  expect((await store.pending()).meals[0]).toMatchObject({ sync: "error", error: "Failed to fetch" });
});
