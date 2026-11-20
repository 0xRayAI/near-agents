import assert from "node:assert/strict";
import test from "node:test";
import { agentPrompt } from "../src/agent-prompt.ts";

const banned = ["mill", "forge", "nibbler", "arch1", "blaze", "critic", "hangar", "groover", "packet", "plane", "raci", "launch"];

test("the agent prompt names the note and keeps the skill", () => {
  const text = agentPrompt({
    name: "Orbitscout",
    account: "ada.testnet",
    id: "orbitworks",
    job: "summarize new proposals",
  });
  assert.match(text, /Orbitscout/);
  assert.match(text, /ada\.testnet/);
  assert.match(text, /orbitworks/);
  assert.match(text, /summarize new proposals/);
  assert.match(text, /testnet/);
  assert.match(text, /No payment was sent/);
  assert.match(text, /# AI agent on NEAR/);
  const lower = text.toLowerCase();
  for (const word of banned) {
    assert.equal(lower.includes(word), false, word);
  }
});
