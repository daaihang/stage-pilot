import test from "node:test";
import assert from "node:assert/strict";
import { createDetailSurfaceState, transitionDetailSurface } from "./detail-surface-state.js";

const open = (state) => transitionDetailSurface(state, { type: "open" });
const settleOpen = (state, sequence) => transitionDetailSurface(state, { type: "open-settled", sequence });
const close = (state) => transitionDetailSurface(state, { type: "close" });
const settleClose = (state, sequence) => transitionDetailSurface(state, { type: "close-settled", sequence });

test("surface opens through opening to open", () => {
  const opening = open(createDetailSurfaceState());
  assert.deepEqual(opening, { mounted: true, phase: "opening", sequence: 1 });
  assert.deepEqual(settleOpen(opening, opening.sequence), { mounted: true, phase: "open", sequence: 1 });
});

test("opening can be cancelled by close", () => {
  const opening = open(createDetailSurfaceState());
  const closing = close(opening);
  assert.equal(closing.phase, "closing");
  assert.deepEqual(settleClose(closing, closing.sequence), { mounted: false, phase: "idle", sequence: 2 });
});

test("reopening during close invalidates the old close sequence", () => {
  const opened = settleOpen(open(createDetailSurfaceState()), 1);
  const closing = close(opened);
  const reopening = open(closing);
  assert.equal(reopening.phase, "opening");
  assert.equal(reopening.sequence, 3);
  assert.deepEqual(settleClose(reopening, closing.sequence), reopening);
  assert.deepEqual(settleOpen(reopening, reopening.sequence), { mounted: true, phase: "open", sequence: 3 });
});

test("stale open and close callbacks never change the latest sequence", () => {
  const opening = open(createDetailSurfaceState());
  const closing = close(opening);
  const reopening = open(closing);
  assert.deepEqual(settleOpen(reopening, opening.sequence), reopening);
  assert.deepEqual(settleClose(reopening, closing.sequence), reopening);
});

test("repeated toggles settle on the final user intent", () => {
  let state = createDetailSurfaceState();
  for (let index = 0; index < 20; index += 1) {
    state = open(state);
    if (index % 2 === 0) state = close(state);
  }
  assert.equal(state.phase, "opening");
  state = settleOpen(state, state.sequence);
  assert.deepEqual(state, { mounted: true, phase: "open", sequence: 30 });

  const closing = close(state);
  const reopening = open(closing);
  assert.equal(reopening.phase, "opening");
  assert.deepEqual(settleClose(reopening, closing.sequence), reopening);
  assert.deepEqual(settleOpen(reopening, reopening.sequence), { mounted: true, phase: "open", sequence: 32 });
});
