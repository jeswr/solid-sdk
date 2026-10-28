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
    for (const remote of ["", "A", "B", "C"]) states.push({ base, local, remote });

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
      local: title === state.base ? null : title,
    });
    expect(observeTitle(state, title)).toEqual({
      ...state,
      base: state.local === null ? title : state.base,
      remote: title,
    });
    expect(acknowledgeTitle(state, title)).toEqual({
      base: title,
      local: state.local === title ? null : state.local,
      remote: title,
    });
  }
  for (const keepMine of [true, false])
    expect(resolveTitle(state, keepMine)).toEqual({
      ...state,
      base: state.remote,
      local: keepMine ? state.local : null,
    });
});

it("preserves the acknowledged base across body saves and repeated remote rebases", () => {
  let state: TitleState = { base: "Plan", local: null, remote: "Plan" };
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
  state = acknowledgeTitle(state, "My newer title");
  state = editTitle(state, "Next title");
  expect(state.base).toBe("My newer title");
  expect(mergeTitle(state).conflict).toBe(false);
});
