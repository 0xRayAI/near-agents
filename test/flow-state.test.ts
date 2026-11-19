import assert from "node:assert/strict";
import { test } from "node:test";
import { completeHold, createDeck, finish, setValue, beginHold, type DeckState } from "../src/deck.ts";
import { FLOW_KEY, loadFlow, saveFlow, type KeyValueStore } from "../src/flow-state.ts";

function memory(): KeyValueStore & { dump: () => string | null } {
  const box = new Map<string, string>();
  return {
    getItem(key) {
      return box.get(key) ?? null;
    },
    setItem(key, value) {
      box.set(key, value);
    },
    removeItem(key) {
      box.delete(key);
    },
    dump() {
      return box.get(FLOW_KEY) ?? null;
    },
  };
}

function filled(): DeckState {
  let state = createDeck();
  state = setValue(state, "name", "ada");
  state = finish(state);
  state = setValue(state, "account", "ada.testnet");
  state = finish(state);
  state = setValue(state, "foundry", "adaworks");
  state = finish(state);
  state = setValue(state, "job", "paint a sign");
  state = finish(state);
  return completeHold(beginHold(state));
}

test("a hard refresh restores the step, the fields, and the record", () => {
  const store = memory();
  const state = filled();
  saveFlow({ state, recorded: { id: "adaworks", account: "ada.testnet" } }, store);
  const loaded = loadFlow(store);
  assert.equal(loaded?.state.phase, "rehearsed");
  assert.equal(loaded?.state.active, "job");
  assert.deepEqual(loaded?.state.done, ["name", "account", "foundry", "job"]);
  assert.equal(loaded?.state.values.foundry, "adaworks");
  assert.equal(loaded?.state.values.job, "paint a sign");
  assert.deepEqual(loaded?.recorded, { id: "adaworks", account: "ada.testnet" });
  assert.equal(loaded?.state.receipt[0], "TESTNET REHEARSAL");
});

function armed(): DeckState {
  let state = createDeck();
  state = finish(setValue(state, "name", "ada"));
  state = finish(setValue(state, "account", "ada.testnet"));
  state = finish(setValue(state, "foundry", "adaworks"));
  state = finish(setValue(state, "job", "paint a sign"));
  return state;
}

test("a hold in progress is stored as the edit step, not a frozen hold", () => {
  const store = memory();
  const held = beginHold(armed());
  assert.equal(held.phase, "holding");
  saveFlow({ state: held, recorded: null }, store);
  const loaded = loadFlow(store);
  assert.equal(loaded?.state.phase, "edit");
  assert.equal(loaded?.state.active, "job");
  assert.equal(loaded?.state.holdStep, null);
  assert.deepEqual(loaded?.state.receipt, []);
  assert.equal(loaded?.state.values.name, "ada");
  assert.equal(loaded?.state.values.job, "paint a sign");
});

test("the open step comes back after a refresh", () => {
  const store = memory();
  const state = finish(setValue(createDeck(), "name", "ada"));
  assert.equal(state.active, "account");
  saveFlow({ state, recorded: null }, store);
  const loaded = loadFlow(store);
  assert.equal(loaded?.state.active, "account");
  assert.deepEqual(loaded?.state.done, ["name"]);
  assert.equal(loaded?.state.values.name, "ada");
  assert.equal(loaded?.state.phase, "edit");
});

test("a bad store and a mainnet account are ignored", () => {
  const store = memory();
  assert.equal(loadFlow(store), null);
  store.setItem(FLOW_KEY, "{");
  assert.equal(loadFlow(store), null);
  saveFlow({
    state: setValue(createDeck(), "account", "someone.near"),
    recorded: null,
  }, store);
  assert.equal(loadFlow(store), null);
  saveFlow({ state: createDeck(), recorded: null }, store);
  assert.equal(store.dump(), null);
});

test("a record for a different account is dropped", () => {
  const store = memory();
  const state = filled();
  saveFlow({ state, recorded: { id: "adaworks", account: "other.testnet" } }, store);
  const loaded = loadFlow(store);
  assert.equal(loaded?.recorded, null);
  assert.equal(loaded?.state.values.account, "ada.testnet");
});
