// AUTHORED-BY Codex
import { expect, it } from "vitest";
import {
  acknowledgeTitle,
  editTitle,
  mergeTitle,
  observeTitle,
  resolveTitle,
  type TitleState,
} from "../src/apps/docs/lib/editor/title-merge";

const states: TitleState[] = [];
for (const base of [undefined, "", "A", "B", "C"])
  for (const local of [null, "", "A", "B", "C"])
    for (const remote of ["", "A", "B", "C"]) states.push({ base, local, remote, sequence: 2 });

it.each(states)("merges the complete title equality table %j", (state) => {
  const conflict =
    state.local !== null && state.remote !== state.base && state.remote !== state.local;
  expect(mergeTitle(state)).toEqual({
    conflict,
    title: state.local ?? state.remote,
    snapshotTitle: conflict ? state.remote : (state.local ?? state.remote),
  });
  for (const title of ["", "A", "B", "C"]) {
    expect(editTitle(state, title)).toEqual({
      ...state,
      local: title,
      sequence: state.sequence + 1,
    });
    expect(observeTitle(state, title)).toEqual({
      ...state,
      base: state.local === null ? title : state.base,
      remote: title,
    });
    for (const sequence of [state.sequence - 1, state.sequence, state.sequence + 1])
      expect(acknowledgeTitle(state, title, sequence)).toEqual({
        ...state,
        base: title,
        local: state.sequence > sequence ? state.local : null,
        remote: title,
      });
  }
  for (const keepMine of [true, false])
    expect(resolveTitle(state, keepMine)).toEqual({
      ...state,
      base: state.remote,
      local: keepMine ? state.local : null,
      sequence: state.sequence + 1,
    });
});

it("preserves the acknowledged base across body saves and repeated remote rebases", () => {
  let state: TitleState = { base: "Plan", local: null, remote: "Plan", sequence: 0 };
  state = editTitle(state, "My title");
  state = observeTitle(state, "Remote title");
  state = observeTitle(state, mergeTitle(state).snapshotTitle);
  state = editTitle(state, "My newer title");
  expect(state.base).toBe("Plan");
  expect(mergeTitle(state)).toEqual({
    conflict: true,
    title: "My newer title",
    snapshotTitle: "Remote title",
  });
  state = resolveTitle(state, true);
  expect(mergeTitle(state).conflict).toBe(false);
  state = acknowledgeTitle(state, "My newer title", state.sequence);
  state = editTitle(state, "Next title");
  expect(state.base).toBe("My newer title");
  expect(mergeTitle(state).conflict).toBe(false);
});

it("retains a revert to the baseline while its own title save is in flight", () => {
  let state: TitleState = { base: "Plan", local: null, remote: "Plan", sequence: 0 };
  state = editTitle(state, "B");
  const sequence = state.sequence;
  const saved = mergeTitle(state).snapshotTitle;
  state = editTitle(state, "Plan");
  state = acknowledgeTitle(state, saved, sequence);
  expect(mergeTitle(state)).toEqual({
    conflict: false,
    title: "Plan",
    snapshotTitle: "Plan",
  });
  expect(state.local).toBe("Plan");
});

const flights = ["", "Plan", "A", "B"].flatMap((base) =>
  ["", "A", "B"].flatMap((saving) =>
    [[], [base], ["A", "B", "A"], [saving], ["B", "A"]].flatMap((edits) =>
      [base, "Remote rename"].map((remote) => ({ base, saving, edits, remote })),
    ),
  ),
);
it.each(flights)("retains newer intent across an in-flight title save %j", (flight) => {
  let state: TitleState = {
    base: flight.base,
    local: null,
    remote: flight.base,
    sequence: 0,
  };
  state = editTitle(state, flight.saving);
  const saving = state;
  for (const title of flight.edits) state = editTitle(state, title);
  state = observeTitle(state, flight.remote);
  expect(state.base).toBe(flight.base);
  state = acknowledgeTitle(state, flight.saving, saving.sequence);
  const newest = flight.edits.at(-1);
  expect(state.local).toBe(newest ?? null);
  expect(state.sequence).toBe(1 + flight.edits.length);
  expect(mergeTitle(state).title).toBe(newest ?? flight.saving);
  expect(state.base).toBe(flight.saving);
  // A subsequent observation can still expose a remote rename; a newer local
  // edit, including A→B→A and revert-to-base, must survive until its own save.
  state = observeTitle(state, flight.remote);
  expect(mergeTitle(state).conflict).toBe(
    newest !== undefined && flight.remote !== flight.saving && flight.remote !== newest,
  );
  state = resolveTitle(state, true);
  const title = mergeTitle(state).title;
  state = acknowledgeTitle(state, title, state.sequence);
  expect(state.local).toBeNull();
  expect(mergeTitle(state)).toEqual({ conflict: false, title, snapshotTitle: title });
});
