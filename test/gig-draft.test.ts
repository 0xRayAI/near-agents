import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGigDraft, saveGigDraft, type KeyValueStore } from "../src/gig-draft.ts";

function memory(): KeyValueStore {
  const bag = new Map<string, string>();
  return {
    getItem: (key) => bag.get(key) ?? null,
    setItem: (key, value) => {
      bag.set(key, value);
    },
    removeItem: (key) => {
      bag.delete(key);
    },
  };
}

test("a gig draft keeps the title and the foundry", () => {
  const store = memory();
  saveGigDraft({ title: "Summarize", details: "Read the notes.", foundry: "Ada Builds" }, store);
  const loaded = loadGigDraft(store);
  assert.equal(loaded.title, "Summarize");
  assert.equal(loaded.details, "Read the notes.");
  assert.equal(loaded.foundry, "ada-builds");
  saveGigDraft({ title: "", details: "", foundry: "" }, store);
  assert.deepEqual(loadGigDraft(store), { title: "", details: "", foundry: "" });
});
