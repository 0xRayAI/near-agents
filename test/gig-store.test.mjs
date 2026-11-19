import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGigStore, readGigBody } from "../gig-store.mjs";
import {
  createFoundryStore,
  encodeBase58,
  foundryMessage,
  foundryPayload,
  readFoundryBody,
} from "../foundry-store.mjs";
import { gigMessage, gigPublicId } from "../src/gig-message.ts";

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { rawPublic, privateKey };
}

function signPayload(privateKey, payload) {
  const hash = createHash("sha256").update(payload).digest();
  return sign(null, hash, privateKey);
}

function fullAccess() {
  return async () => new Response(JSON.stringify({ result: { permission: "FullAccess" } }), { status: 200 });
}

async function savedFoundry(dir) {
  const { rawPublic, privateKey } = keyPair();
  const foundries = createFoundryStore(join(dir, "foundries.json"), fullAccess());
  const fields = {
    name: "ada",
    account: "ada.testnet",
    foundry: "adabuilds",
    job: "make gizmos",
  };
  const nonce = Buffer.alloc(32, 9);
  const message = foundryMessage(fields);
  const payload = foundryPayload({ message, nonce }, null);
  const signature = signPayload(privateKey, payload);
  const body = readFoundryBody({
    ...fields,
    publicKey: `ed25519:${encodeBase58(rawPublic)}`,
    signature: signature.toString("base64"),
    nonce: nonce.toString("base64"),
  });
  const saved = await foundries.put(body.record);
  assert.equal(saved.ok, true);
  return { foundries, rawPublic, privateKey };
}

function gigRecord(privateKey, rawPublic, fields, byte) {
  const id = gigPublicId(fields);
  const message = gigMessage({ ...fields, id });
  const nonce = Buffer.alloc(32, byte);
  const payload = foundryPayload({ message, nonce }, null);
  const signature = signPayload(privateKey, payload);
  return readGigBody({
    ...fields,
    publicKey: `ed25519:${encodeBase58(rawPublic)}`,
    signature: signature.toString("base64"),
    nonce: nonce.toString("base64"),
  });
}

test("a signed gig is stored on that foundry and account", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gig-"));
  const { foundries, rawPublic, privateKey } = await savedFoundry(dir);
  const gigs = createGigStore(join(dir, "gigs.json"), foundries, fullAccess());
  const fields = {
    title: "Summarize proposals",
    details: "Read the new notes and write a short brief.",
    foundry: "adabuilds",
    account: "ada.testnet",
  };
  const body = gigRecord(privateKey, rawPublic, fields, 11);
  assert.equal(body.ok, true);
  assert.equal(body.record.id, gigPublicId(fields));
  assert.equal(body.record.message.includes("Post this gig"), true);
  const saved = await gigs.put(body.record);
  assert.equal(saved.ok, true);
  assert.deepEqual(Object.keys(saved.record).sort(), ["account", "details", "foundry", "id", "recordedAt", "title"]);
  assert.equal(saved.record.foundry, "adabuilds");
  assert.equal(saved.record.account, "ada.testnet");
  assert.equal("amount" in saved.record, false);
  assert.equal("agent" in saved.record, false);
  const listed = gigs.list("ada.testnet");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, fields.title);
  assert.equal(listed[0].foundry, "adabuilds");
  assert.equal(gigs.list("bea.testnet").length, 0);
  assert.equal(gigs.list(""), null);
  assert.equal((await gigs.put(body.record)).ok, false);
});

test("a foundry this account does not own cannot take a gig", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gig-owner-"));
  const { foundries } = await savedFoundry(dir);
  const gigs = createGigStore(join(dir, "gigs.json"), foundries, fullAccess());
  const other = keyPair();
  const body = gigRecord(other.privateKey, other.rawPublic, {
    title: "Summarize proposals",
    details: "Read the new notes.",
    foundry: "adabuilds",
    account: "bea.testnet",
  }, 12);
  assert.equal(body.ok, true);
  const saved = await gigs.put(body.record);
  assert.equal(saved.ok, false);
  assert.equal(saved.error, "Choose a foundry you created.");
  assert.equal(gigs.list("ada.testnet").length, 0);
});

test("a signature over a different gig id is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gig-id-"));
  const { foundries, rawPublic, privateKey } = await savedFoundry(dir);
  const gigs = createGigStore(join(dir, "gigs.json"), foundries, fullAccess());
  const fields = {
    title: "Summarize proposals",
    details: "Read the new notes.",
    foundry: "adabuilds",
    account: "ada.testnet",
  };
  const nonce = Buffer.alloc(32, 13);
  const message = gigMessage({ ...fields, id: "not-the-gig" });
  const payload = foundryPayload({ message, nonce }, null);
  const signature = signPayload(privateKey, payload);
  const body = readGigBody({
    ...fields,
    publicKey: `ed25519:${encodeBase58(rawPublic)}`,
    signature: signature.toString("base64"),
    nonce: nonce.toString("base64"),
  });
  assert.equal(body.ok, true);
  assert.notEqual(body.record.message, message);
  const saved = await gigs.put(body.record);
  assert.equal(saved.ok, false);
  assert.equal(gigs.list("ada.testnet").length, 0);
});
