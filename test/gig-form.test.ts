import assert from "node:assert/strict";
import { test } from "node:test";
import { gigSaveEnabled, gigSaveLabel, showGigControl } from "../src/gig-form.ts";

test("the gig control follows the open fields", () => {
  const bare = { connected: true, title: "", details: "", ownedCount: 0, foundryId: "", signing: false };
  assert.equal(gigSaveLabel(bare), "Add a title");
  assert.equal(gigSaveEnabled(gigSaveLabel(bare)), false);
  assert.equal(gigSaveLabel({ ...bare, title: "Summarize" }), "Add details");
  assert.equal(gigSaveLabel({ ...bare, title: "Summarize", details: "Read the notes." }), "Save a foundry first");
  assert.equal(gigSaveEnabled("Save a foundry first"), true);
  assert.equal(gigSaveLabel({
    ...bare,
    title: "Summarize",
    details: "Read the notes.",
    ownedCount: 1,
    foundryId: "",
  }), "Choose a foundry");
  const ready = gigSaveLabel({
    ...bare,
    title: "Summarize",
    details: "Read the notes.",
    ownedCount: 1,
    foundryId: "adabuilds",
  });
  assert.equal(ready, "Sign and save gig");
  assert.equal(gigSaveEnabled(ready), true);
  assert.equal(gigSaveLabel({ ...bare, connected: false, title: "Summarize", details: "Read" }), "Connect a wallet");
  assert.equal(gigSaveLabel({
    connected: true,
    title: "Summarize",
    details: "Read the notes.",
    ownedCount: 1,
    foundryId: "adabuilds",
    signing: true,
  }), "Confirm in the wallet");
});

test("a foundry this account does not own has no gig control", () => {
  assert.equal(showGigControl("ada.testnet", "ada.testnet"), true);
  assert.equal(showGigControl("ada.testnet", "bea.testnet"), false);
  assert.equal(showGigControl("ada.testnet", ""), false);
  assert.equal(showGigControl("", "ada.testnet"), false);
});
