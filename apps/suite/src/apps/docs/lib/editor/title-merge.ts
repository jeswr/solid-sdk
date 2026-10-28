// AUTHORED-BY Codex
/** The acknowledged pod title, pending local intent, and latest pod observation. */
export interface TitleState {
  base: string | undefined;
  local: string | null;
  remote: string;
  /** Monotonic identity of local input/choice events, even when their values repeat. */
  sequence: number;
}

export function mergeTitle(state: TitleState) {
  const conflict =
    state.local !== null && state.remote !== state.base && state.remote !== state.local;
  return {
    conflict,
    title: state.local ?? state.remote,
    snapshotTitle: conflict ? state.remote : (state.local ?? state.remote),
  };
}

export function editTitle(state: TitleState, title: string): TitleState {
  return { ...state, local: title, sequence: state.sequence + 1 };
}

/** Observing a remote value acknowledges it only when there is no local intent. */
export function observeTitle(state: TitleState, remote: string): TitleState {
  return { ...state, base: state.local === null ? remote : state.base, remote };
}

/** A save acknowledges only the edits captured when it started; newer input survives. */
export function acknowledgeTitle(state: TitleState, title: string, sequence: number): TitleState {
  return {
    ...state,
    base: title,
    local: state.sequence > sequence ? state.local : null,
    remote: title,
  };
}

export function resolveTitle(state: TitleState, keepMine: boolean): TitleState {
  return {
    ...state,
    base: state.remote,
    local: keepMine ? state.local : null,
    sequence: state.sequence + 1,
  };
}
