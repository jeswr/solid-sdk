// AUTHORED-BY Codex
/** The acknowledged pod title, pending local intent, and latest pod observation. */
export interface TitleState {
  base: string | undefined;
  local: string | null;
  remote: string;
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
  return { ...state, local: title === state.base ? null : title };
}

/** Observing a remote value acknowledges it only when there is no local intent. */
export function observeTitle(state: TitleState, remote: string): TitleState {
  return { ...state, base: state.local === null ? remote : state.base, remote };
}

/** Only a successful write of our chosen title (or an explicit choice) advances its base. */
export function acknowledgeTitle(state: TitleState, title: string): TitleState {
  return { base: title, local: state.local === title ? null : state.local, remote: title };
}

export function resolveTitle(state: TitleState, keepMine: boolean): TitleState {
  return { ...state, base: state.remote, local: keepMine ? state.local : null };
}
