import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginHold,
  canFinish,
  cancelHold,
  anotherRound,
  completeHold,
  createDeck,
  finish,
  holdCue,
  railStatus,
  canOpen,
  continuation,
  nextStep,
  selectStep,
  setValue,
  type DeckState,
} from "../src/deck.ts";

function arm(): DeckState {
  let state = createDeck();
  state = setValue(state, "name", "Keeper");
  state = finish(state);
  state = setValue(state, "account", "alpha.testnet");
  state = finish(state);
  state = setValue(state, "foundry", "desk");
  state = finish(state);
  state = setValue(state, "job", "Watch the board");
  state = finish(state);
  return state;
}

test("empty name cannot finish Name", () => {
  const start = createDeck();
  assert.equal(canFinish(start), false);
  assert.equal(finish(start).active, "name");
  assert.deepEqual(finish(start).done, []);

  const spaces = setValue(start, "name", "   ");
  assert.equal(canFinish(spaces), false);
  assert.equal(finish(spaces).active, "name");
  assert.deepEqual(finish(spaces).done, []);
});

test("Account, Foundry, and Job follow Name", () => {
  let state = setValue(createDeck(), "account", "alpha.testnet");
  assert.equal(finish(state).active, "name");

  state = setValue(createDeck(), "name", "Keeper");
  state = finish(state);
  assert.equal(state.active, "account");
  assert.deepEqual(state.done, ["name"]);
  assert.equal(canFinish(state), false);
  assert.equal(finish(state).active, "account");

  state = setValue(state, "account", "alpha.testnet");
  state = finish(state);
  assert.equal(state.active, "foundry");
  assert.equal(finish(state).active, "foundry");

  state = setValue(state, "foundry", "desk");
  state = finish(state);
  assert.equal(state.active, "job");
  assert.equal(finish(state).active, "job");

  state = setValue(state, "job", "Watch the board");
  state = finish(state);
  assert.equal(state.active, "job");
  assert.deepEqual(state.done, ["name", "account", "foundry", "job"]);
});

test("cancel returns to the step that was active", () => {
  let state = arm();
  assert.equal(state.active, "job");
  state = cancelHold(beginHold(state));
  assert.equal(state.active, "job");
  assert.equal(state.phase, "edit");
  assert.deepEqual(state.receipt, []);

  state = selectStep(state, "foundry");
  state = beginHold(state);
  assert.equal(state.holdStep, "foundry");
  state = cancelHold(state);
  assert.equal(state.active, "foundry");
  assert.equal(state.phase, "edit");
  assert.equal(state.receipt.length, 0);
});

test("the next step opens once the current step has a value", () => {
  const start = createDeck();
  assert.equal(canOpen(start, "account"), false);
  assert.equal(nextStep(start), "account");
  const named = setValue(start, "name", "Keeper");
  assert.equal(canOpen(named, "name"), true);
  assert.equal(canOpen(named, "account"), true);
  assert.equal(canOpen(named, "foundry"), false);
  assert.equal(railStatus(named, false), "Use the arrow for the next step.");
  const account = finish(named);
  assert.equal(canOpen(account, "foundry"), false);
  const filled = setValue(account, "account", "alpha.testnet");
  assert.equal(canOpen(filled, "foundry"), true);
  assert.equal(canOpen(filled, "name"), true);
});

test("enter moves on from a step that is already set", () => {
  const named = setValue(createDeck(), "name", "Keeper");
  assert.equal(continuation(named), "finish");
  const backed = selectStep(finish(named), "name");
  assert.equal(backed.active, "name");
  assert.equal(continuation(backed), "account");
  assert.equal(continuation(createDeck()), null);
});

test("the hold cue names the open step", () => {
  const start = createDeck();
  assert.equal(holdCue(start), "Name, then hold");
  assert.equal(railStatus(start, false), "Type a name.");
  const armed = arm();
  assert.equal(holdCue(armed), "Hold to record");
  assert.equal(railStatus(beginHold(armed), false), "Holding. Let go to cancel.");
  assert.equal(holdCue(completeHold(beginHold(armed))), "Nothing was sent");
});

test("another round clears the name and id and keeps the account", () => {
  const saved = completeHold(beginHold(arm()));
  const again = anotherRound(saved);
  assert.equal(again.phase, "edit");
  assert.equal(again.active, "name");
  assert.equal(again.values.name, "");
  assert.equal(again.values.foundry, "");
  assert.equal(again.values.job, "");
  assert.equal(again.values.account, "alpha.testnet");
  assert.deepEqual(again.done, []);
  assert.deepEqual(again.receipt, []);
  assert.equal(canFinish(again), false);
  const named = finish(setValue(again, "name", "Second"));
  assert.equal(named.active, "account");
  assert.equal(named.values.account, "alpha.testnet");
  assert.equal(named.values.foundry, "");
});

test("receipt text is a testnet rehearsal and has no transaction hash", () => {
  const state = completeHold(beginHold(arm()));
  const text = state.receipt.join("\n");
  assert.match(text, /TESTNET REHEARSAL/);
  assert.match(text, /The chain transaction has not been sent\./);
  assert.equal(/\b[0-9a-f]{32,}\b/i.test(text), false);
  assert.equal(/transaction hash/i.test(text), false);
  assert.equal(state.phase, "rehearsed");
});
