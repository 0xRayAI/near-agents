import assert from "node:assert/strict";
import test from "node:test";
import { drawingLabel } from "../src/drawing-label.ts";

test("a typed name is the drawing label", () => {
  assert.equal(drawingLabel("Orbitscout", 2), "Orbitscout");
});

test("saved work replaces a blank name on the drawing", () => {
  assert.equal(drawingLabel("  ", 2), "2 saved");
  assert.equal(drawingLabel("", 1), "1 saved");
  assert.equal(drawingLabel("", 0), "");
});
