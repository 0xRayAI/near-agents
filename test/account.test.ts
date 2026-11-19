import assert from "node:assert/strict";
import { test } from "node:test";
import { isTestnetAccount, publicWalletError } from "../src/account.ts";

test("accepts a named testnet account and an implicit account", () => {
  assert.equal(isTestnetAccount("alpha.testnet"), true);
  assert.equal(isTestnetAccount("aa.testnet"), true);
  assert.equal(isTestnetAccount("ab".repeat(32)), true);
  assert.equal(isTestnetAccount("f".repeat(64)), true);
  assert.equal(isTestnetAccount("alice.near"), false);
  assert.equal(isTestnetAccount("Alice.testnet"), false);
  assert.equal(isTestnetAccount("a.testnet"), false);
  assert.equal(isTestnetAccount(""), false);
  assert.equal(isTestnetAccount(`${"a".repeat(60)}.testnet`), false);
});

test("wallet errors stay free of key material", () => {
  assert.equal(publicWalletError(new Error("closed")), "closed");
  assert.equal(
    publicWalletError(new Error(`ed25519:${"ab".repeat(32)}`)),
    "The wallet did not connect.",
  );
  assert.equal(publicWalletError(new Error("x".repeat(200))), "The wallet did not connect.");
});
