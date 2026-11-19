import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { foundryMessage } from "./src/foundry-message.ts";

export { foundryMessage };
export const RECIPIENT = "near-agents.0xray";
const TAG = 2147484061;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const HOSTS = new Set([
  "near-agents-production.up.railway.app",
  "localhost",
  "127.0.0.1",
]);

const SAFE_ID = /^[a-z][a-z0-9-]{1,30}$/;
const IMPLICIT = /^[0-9a-f]{64}$/;
const PART = /^[a-z\d]+(?:[-_][a-z\d]+)*$/;

export function isTestnetAccount(id) {
  if (typeof id !== "string" || id.length < 2 || id.length > 64) return false;
  if (id.endsWith(".near")) return false;
  if (IMPLICIT.test(id)) return true;
  if (!id.endsWith(".testnet")) return false;
  return id.split(".").every((part) => part.length >= 2 && PART.test(part));
}

export function shellId(value) {
  if (typeof value !== "string") return "";
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return SAFE_ID.test(id) ? id : "";
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function text(value) {
  const body = Buffer.from(value, "utf8");
  return Buffer.concat([u32(body.length), body]);
}

export function foundryPayload(input, callbackUrl) {
  const nonce = Buffer.from(input.nonce);
  if (nonce.length !== 32) return null;
  const parts = [
    u32(TAG),
    text(input.message),
    nonce,
    text(RECIPIENT),
    callbackUrl ? Buffer.concat([Buffer.from([1]), text(callbackUrl)]) : Buffer.from([0]),
  ];
  return Buffer.concat(parts);
}

export function decodeBase58(value) {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return null;
  const bytes = [0];
  for (const char of value) {
    let carry = ALPHABET.indexOf(char);
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  for (const char of value) {
    if (char !== "1") break;
    zeros += 1;
  }
  while (zeros > 0) {
    bytes.push(0);
    zeros -= 1;
  }
  return Buffer.from(bytes.reverse());
}

export function encodeBase58(bytes) {
  const source = Buffer.from(bytes);
  let zeros = 0;
  while (zeros < source.length && source[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < source.length; i += 1) {
    let carry = source[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]];
  return out;
}

function ed25519Key(raw) {
  return createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(raw).toString("base64url"),
    },
    format: "jwk",
  });
}

export function signatureMatches(input, rawPublic, rawSignature) {
  const hashOf = (callbackUrl) => {
    const payload = foundryPayload(input, callbackUrl);
    if (!payload) return null;
    return createHash("sha256").update(payload).digest();
  };
  const key = ed25519Key(rawPublic);
  const hashes = [hashOf(null)];
  if (input.callbackUrl) hashes.push(hashOf(input.callbackUrl));
  return hashes.some((hash) => hash && verify(null, hash, key, rawSignature));
}

function allowedCallback(value) {
  if (!value) return "";
  if (typeof value !== "string" || value.length > 200) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!HOSTS.has(url.hostname)) return null;
  return value;
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  const textValue = value.trim();
  if (!textValue || textValue.length > max) return "";
  if (/[\r\n]/.test(textValue)) return "";
  return textValue;
}

export function readFoundryBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "The foundry was not recorded." };
  const name = cleanText(body.name, 32);
  const job = cleanText(body.job, 80);
  const account = cleanText(body.account, 64);
  const foundry = shellId(body.foundry);
  const callbackUrl = allowedCallback(body.callbackUrl);
  if (!name || !job || !foundry || !isTestnetAccount(account) || callbackUrl === null) {
    return { ok: false, error: "The foundry was not recorded." };
  }
  if (typeof body.publicKey !== "string" || !body.publicKey.startsWith("ed25519:")) {
    return { ok: false, error: "The wallet signature did not match this foundry." };
  }
  const rawPublic = decodeBase58(body.publicKey.slice("ed25519:".length));
  const rawSignature = typeof body.signature === "string" ? Buffer.from(body.signature, "base64") : null;
  const nonce = typeof body.nonce === "string" ? Buffer.from(body.nonce, "base64") : null;
  if (!rawPublic || rawPublic.length !== 32 || !rawSignature || rawSignature.length !== 64 || !nonce || nonce.length !== 32) {
    return { ok: false, error: "The wallet signature did not match this foundry." };
  }
  return {
    ok: true,
    record: {
      name,
      job,
      account,
      foundry,
      callbackUrl,
      publicKey: body.publicKey,
      message: foundryMessage({ name, account, foundry, job }),
      nonce,
      rawPublic,
      rawSignature,
    },
  };
}

export function isFullAccess(permission) {
  return permission === "FullAccess";
}

function emptyBook() {
  return { foundries: {}, nonces: [] };
}

function publicFoundry(row) {
  if (!row || typeof row !== "object") return null;
  const id = shellId(row.id);
  const account = typeof row.account === "string" ? row.account : "";
  if (!id || !isTestnetAccount(account)) return null;
  return {
    id,
    name: typeof row.name === "string" ? row.name : "",
    account,
    job: typeof row.job === "string" ? row.job : "",
    listing: "pending",
    recordedAt: typeof row.recordedAt === "string" ? row.recordedAt : "",
  };
}

export function createFoundryStore(file, fetchImpl = fetch) {
  function load() {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || !parsed.foundries || !Array.isArray(parsed.nonces)) {
        return emptyBook();
      }
      return parsed;
    } catch {
      return emptyBook();
    }
  }

  function save(book) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(book)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  }

  return {
    get(id) {
      const foundry = shellId(id);
      if (!foundry) return null;
      return load().foundries[foundry] || null;
    },
    list(account) {
      if (!isTestnetAccount(account)) return null;
      return Object.values(load().foundries)
        .map(publicFoundry)
        .filter((row) => row && row.account === account)
        .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    },
    async put(record) {
      const book = load();
      const nonceKey = Buffer.from(record.nonce).toString("base64");
      if (book.nonces.includes(nonceKey)) {
        return { ok: false, error: "The wallet signature did not match this foundry." };
      }
      const existing = book.foundries[record.foundry];
      if (existing && existing.account !== record.account) {
        return { ok: false, error: "That foundry id is already recorded." };
      }
      const signed = signatureMatches(record, record.rawPublic, record.rawSignature);
      if (!signed) return { ok: false, error: "The wallet signature did not match this foundry." };
      const onChain = await keyOnAccount(record.account, record.publicKey, fetchImpl);
      if (onChain !== "full") {
        return {
          ok: false,
          error: onChain === "unknown"
            ? "The account check did not answer."
            : "The wallet signature did not match this foundry.",
        };
      }
      book.nonces.push(nonceKey);
      if (book.nonces.length > 5000) book.nonces.splice(0, book.nonces.length - 5000);
      const saved = {
        id: record.foundry,
        name: record.name,
        account: record.account,
        job: record.job,
        listing: "pending",
        recordedAt: new Date().toISOString(),
      };
      book.foundries[record.foundry] = saved;
      save(book);
      return { ok: true, record: saved };
    },
  };
}

export async function fullAccessOnAccount(account, publicKey, fetchImpl = fetch) {
  return keyOnAccount(account, publicKey, fetchImpl);
}

async function keyOnAccount(account, publicKey, fetchImpl) {
  try {
    const response = await fetchImpl("https://rpc.testnet.near.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "key",
        method: "query",
        params: {
          request_type: "view_access_key",
          finality: "final",
          account_id: account,
          public_key: publicKey,
        },
      }),
    });
    if (!response.ok) return "unknown";
    const body = await response.json();
    if (isFullAccess(body?.result?.permission)) return "full";
    if (body?.result?.permission) return "other";
    return "missing";
  } catch {
    return "unknown";
  }
}
