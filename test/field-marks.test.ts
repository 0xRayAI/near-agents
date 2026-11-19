import assert from "node:assert/strict";
import test from "node:test";
import { linkLive, spokeLabel } from "../src/field-marks.ts";

test("each spoke shows the typed field", () => {
  assert.equal(spokeLabel("name", ""), "NAME");
  assert.equal(spokeLabel("name", "  orbitscout "), "ORBITSCOUT");
  assert.equal(spokeLabel("account", "ada.testnet"), "ADA.TESTNET");
  assert.equal(spokeLabel("foundry", "orbitworks"), "ORBITWORKS");
  assert.equal(spokeLabel("job", ""), "JOB");
  assert.equal(spokeLabel("job", "make maps"), "MAKE MAPS");
  assert.equal(spokeLabel("job", "summarize new proposals today"), "SUMMARIZE NEW PROPOSAL");
});

test("a spoke lights when that step is open or done", () => {
  const start = { name: "open" as const, account: "idle" as const, foundry: "idle" as const, job: "idle" as const };
  assert.equal(linkLive("agent", "name", start), true);
  assert.equal(linkLive("agent", "account", start), false);
  assert.equal(linkLive("name", "account", start), false);
  const mid = { name: "done" as const, account: "open" as const, foundry: "idle" as const, job: "done" as const };
  assert.equal(linkLive("agent", "account", mid), true);
  assert.equal(linkLive("name", "account", mid), true);
  assert.equal(linkLive("account", "foundry", mid), false);
  assert.equal(linkLive("foundry", "job", mid), false);
});
