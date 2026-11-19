import assert from "node:assert/strict";
import test from "node:test";
import { parseGigSide, parseRecordTab } from "../src/record-tabs.ts";

test("records open on foundries", () => {
  assert.equal(parseRecordTab(undefined), "foundries");
  assert.equal(parseRecordTab("gigs"), "gigs");
  assert.equal(parseRecordTab("bought"), "foundries");
});

test("a gig list opens on opened", () => {
  assert.equal(parseGigSide(undefined), "opened");
  assert.equal(parseGigSide("bought"), "bought");
  assert.equal(parseGigSide("foundries"), "opened");
});
