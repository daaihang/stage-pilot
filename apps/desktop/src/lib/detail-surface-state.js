export const DETAIL_SURFACE_PHASES = Object.freeze(["idle", "opening", "open", "closing"]);

export function createDetailSurfaceState({ mounted = false, phase = "idle", sequence = 0 } = {}) {
  return {
    mounted: Boolean(mounted),
    phase: DETAIL_SURFACE_PHASES.includes(phase) ? phase : "idle",
    sequence: Number.isFinite(sequence) ? sequence : 0,
  };
}

export function transitionDetailSurface(state, event) {
  const current = createDetailSurfaceState(state);
  if (!event?.type) return current;

  if (event.type === "open") {
    return {
      mounted: true,
      phase: current.mounted && current.phase === "open" ? "open" : "opening",
      sequence: current.sequence + 1,
    };
  }

  if (event.type === "open-settled") {
    if (event.sequence !== current.sequence || current.phase !== "opening") return current;
    return { ...current, phase: "open" };
  }

  if (event.type === "close") {
    return {
      mounted: current.mounted,
      phase: current.mounted ? "closing" : "idle",
      sequence: current.sequence + 1,
    };
  }

  if (event.type === "close-settled") {
    if (event.sequence !== current.sequence || current.phase !== "closing") return current;
    return { mounted: false, phase: "idle", sequence: current.sequence };
  }

  return current;
}
