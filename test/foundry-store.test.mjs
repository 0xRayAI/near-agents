import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isTestnetAccount as clientAccount } from "../src/account.ts";
import { shellId as clientShell } from "../src/deploy.ts";
import {
  createFoundryStore,
  decodeBase58,
  encodeBase58,
  foundryMessage,
  foundryPayload,
  isTestnetAccount,
  readFoundryBody,
  shellId,
  signatureMatches,
} from "../foundry-store.mjs";
import { createHash } from "node:crypto";

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { publicKey: privateKey, rawPublic, privateKey };
}

function signPayload(privateKey, payload) {
  const hash = createHash("sha256").update(payload).digest();
  return sign(null, hash, privateKey);
}

test("account rules match the page", () => {
  for (const id of ["alpha.testnet", "aa.testnet", "f".repeat(64), "alice.near", "Alice.testnet", ""]) {
    assert.equal(isTestnetAccount(id), clientAccount(id), id);
  }
  assert.equal(shellId("Ada Works!"), clientShell("Ada Works!"));
});

test("a full-access signature records the wallet account", async () => {
  const { rawPublic, privateKey } = keyPair();
  const nonce = Buffer.alloc(32, 7);
  const fields = {
    name: "ada",
    account: "ada.testnet",
    foundry: "adabuilds",
    job: "make gizmos",
  };
  const message = foundryMessage(fields);
  const payload = foundryPayload({ message, nonce }, null);
  const signature = signPayload(privateKey, payload);
  const body = readFoundryBody({
    ...fields,
    publicKey: `ed25519:${encodeBase58(rawPublic)}`,
    signature: signature.toString("base64"),
    nonce: nonce.toString("base64"),
  });
  assert.equal(body.ok, true);
  assert.equal(signatureMatches(body.record, rawPublic, signature), true);
  assert.equal(decodeBase58(encodeBase58(rawPublic)).equals(rawPublic), true);

  const dir = mkdtempSync(join(tmpdir(), "foundry-"));
  const store = createFoundryStore(join(dir, "book.json"), async () => {
    return new Response(JSON.stringify({ result: { permission: "FullAccess" } }), { status: 200 });
  });
  const saved = await store.put(body.record);
  assert.equal(saved.ok, true);
  assert.equal(saved.record.account, "ada.testnet");
  assert.equal(saved.record.listing, "pending");
  assert.equal((await store.put(body.record)).ok, false);

  const other = { ...body.record, account: "other.testnet" };
  const taken = await store.put(other);
  assert.equal(taken.ok, false);
});

test("a list returns that account only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "foundry-list-"));
  const store = createFoundryStore(join(dir, "book.json"), async () => {
    return new Response(JSON.stringify({ result: { permission: "FullAccess" } }), { status: 200 });
  });
  const { rawPublic, privateKey } = keyPair();
  const first = await store.put(signedFoundry(privateKey, rawPublic, {
    name: "ada",
    account: "ada.testnet",
    foundry: "adabuilds",
    job: "make gizmos",
  }, 4));
  const second = await store.put(signedFoundry(privateKey, rawPublic, {
    name: "ada",
    account: "ada.testnet",
    foundry: "adaworks",
    job: "paint a sign",
  }, 5));
  const otherKey = keyPair();
  await store.put(signedFoundry(otherKey.privateKey, otherKey.rawPublic, {
    name: "bea",
    account: "bea.testnet",
    foundry: "beaworks",
    job: "keep watch",
  }, 6));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const rows = store.list("ada.testnet");
  assert.deepEqual(rows.map((row) => row.id).sort(), ["adabuilds", "adaworks"]);
  assert.equal(rows.every((row) => row.account === "ada.testnet" && row.name === "ada" && row.listing === "pending"), true);
  assert.equal(JSON.stringify(rows).includes("nonce"), false);
  assert.equal(store.list("bea.testnet").map((row) => row.id).join(), "beaworks");
  assert.equal(store.list(""), null);
  assert.equal(store.list("alice.near"), null);
});

function signedFoundry(privateKey, rawPublic, fields, byte) {
  const nonce = Buffer.alloc(32, byte);
  const message = foundryMessage(fields);
  const payload = foundryPayload({ message, nonce }, null);
  const signature = signPayload(privateKey, payload);
  return readFoundryBody({
    ...fields,
    publicKey: `ed25519:${encodeBase58(rawPublic)}`,
    signature: signature.toString("base64"),
    nonce: nonce.toString("base64"),
  }).record;
}

test("a mainnet account and a bad signature are refused", async () => {
  const rejected = readFoundryBody({
    name: "ada",
    account: "alice.near",
    foundry: "adabuilds",
    job: "make gizmos",
    publicKey: "ed25519:1",
    signature: "aa",
    nonce: "aa",
  });
  assert.equal(rejected.ok, false);

  const { rawPublic, privateKey } = keyPair();
  const nonce = Buffer.alloc(32, 3);
  const fields = {
    name: "ada",
    account: "ada.testnet",
    foundry: "adabuilds",
    job: "make gizmos",
  };
  const payload = foundryPayload({ message: foundryMessage(fields), nonce }, "https://evil.example/callback");
  const signature = signPayload(privateKey, payload);
  const body = readFoundryBody({
    ...fields,
    publicKey: `ed25519:${encodeBase58(rawPublic)}`,
    signature: signature.toString("base64"),
    nonce: nonce.toString("base64"),
    callbackUrl: "https://evil.example/callback",
  });
  assert.equal(body.ok, false);
  assert.equal(signatureMatches({
    message: foundryMessage(fields),
    nonce,
    callbackUrl: "https://evil.example/callback",
  }, rawPublic, signature), true);
});
