import assert from "node:assert/strict";
import test from "node:test";
import { drawingLabel } from "../src/drawing-label.ts";

test("a typed name is the drawing label", () => {
  assert.equal(drawingLabel("Orbitscout", 2, 1), "Orbitscout");
});

test("saved work replaces a blank name on the drawing", () => {
  assert.equal(drawingLabel("  ", 2, 1), "2 foundries, 1 gig saved");
  assert.equal(drawingLabel("", 1, 0), "1 foundry saved");
  assert.equal(drawingLabel("", 0, 2), "2 gigs saved");
  assert.equal(drawingLabel("", 0, 0), "");
});
