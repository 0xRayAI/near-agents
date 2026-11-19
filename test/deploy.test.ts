import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nearFromYocto,
  readTestnetAccount,
  shellId,
} from "../src/deploy.ts";

test("shell id keeps letters and drops the rest", () => {
  assert.equal(shellId("Keeper"), "keeper");
  assert.equal(shellId("My Desk!"), "my-desk");
  assert.equal(shellId("a"), "");
  assert.equal(shellId("ok; rm"), "ok-rm");
});

test("yocto amounts become a short NEAR figure", () => {
  assert.equal(nearFromYocto("0"), "0");
  assert.equal(nearFromYocto("1000000000000000000000000"), "1");
  assert.equal(nearFromYocto("1500000000000000000000000"), "1.5");
  assert.equal(nearFromYocto("1"), "under 0.0001");
  assert.equal(nearFromYocto("nope"), "");
});

test("a view call reads presence and ignores a missing account", async () => {
  const present = await readTestnetAccount("alice.testnet", async () => {
    return new Response(JSON.stringify({ result: { amount: "2000000000000000000000000" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.deepEqual(present, { view: "present", near: "2" });

  const absent = await readTestnetAccount("gone.testnet", async () => {
    return new Response(JSON.stringify({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.deepEqual(absent, { view: "absent", near: "" });

  const denied = await readTestnetAccount("alice.near", async () => {
    throw new Error("should not fetch");
  });
  assert.equal(denied.view, "unknown");
});
