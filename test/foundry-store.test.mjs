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
