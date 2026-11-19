import { gigMessage, gigPublicId } from "./src/gig-message.ts";
import {
  decodeBase58,
  fullAccessOnAccount,
  isTestnetAccount,
  shellId,
  signatureMatches,
} from "./foundry-store.mjs";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function cleanLine(value, max) {
  if (typeof value !== "string") return "";
  const textValue = value.trim();
  if (!textValue || textValue.length > max) return "";
  if (/[\r\n]/.test(textValue)) return "";
  return textValue;
}

function cleanDetails(value) {
  if (typeof value !== "string") return "";
  const textValue = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!textValue || textValue.length > 240) return "";
  return textValue;
}

export function readGigBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "The gig was not saved." };
  const title = cleanLine(body.title, 80);
  const details = cleanDetails(body.details);
  const account = cleanLine(body.account, 64);
  const foundry = shellId(body.foundry);
  const callbackUrl = allowedCallback(body.callbackUrl);
  if (!title || !details || !foundry || !isTestnetAccount(account) || callbackUrl === null) {
    return { ok: false, error: "The gig was not saved." };
  }
  const id = gigPublicId({ title, details, foundry, account });
  if (!id) return { ok: false, error: "The gig was not saved." };
  if (typeof body.publicKey !== "string" || !body.publicKey.startsWith("ed25519:")) {
    return { ok: false, error: "The wallet signature did not match this gig." };
  }
  const rawPublic = decodeBase58(body.publicKey.slice("ed25519:".length));
  const rawSignature = typeof body.signature === "string" ? Buffer.from(body.signature, "base64") : null;
  const nonce = typeof body.nonce === "string" ? Buffer.from(body.nonce, "base64") : null;
  if (!rawPublic || rawPublic.length !== 32 || !rawSignature || rawSignature.length !== 64 || !nonce || nonce.length !== 32) {
    return { ok: false, error: "The wallet signature did not match this gig." };
  }
  return {
    ok: true,
    record: {
      id,
      title,
      details,
      foundry,
      account,
      callbackUrl,
      publicKey: body.publicKey,
      message: gigMessage({ title, details, foundry, account, id }),
      nonce,
      rawPublic,
      rawSignature,
    },
  };
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
  const hosts = new Set(["near-agents-production.up.railway.app", "localhost", "127.0.0.1"]);
  if (!hosts.has(url.hostname)) return null;
  return value;
}

function emptyBook() {
  return { gigs: {}, nonces: [] };
}

function publicGig(row) {
  if (!row || typeof row !== "object") return null;
  const id = typeof row.id === "string" ? row.id : "";
  const foundry = shellId(row.foundry);
  const account = typeof row.account === "string" ? row.account : "";
  if (!id || !foundry || !isTestnetAccount(account)) return null;
  return {
    id,
    title: typeof row.title === "string" ? row.title : "",
    details: typeof row.details === "string" ? row.details : "",
    foundry,
    account,
    recordedAt: typeof row.recordedAt === "string" ? row.recordedAt : "",
  };
}

export function createGigStore(file, foundries, fetchImpl = fetch) {
  function load() {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || !parsed.gigs || !Array.isArray(parsed.nonces)) {
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
    list(account) {
      if (!isTestnetAccount(account)) return null;
      return Object.values(load().gigs)
        .map(publicGig)
        .filter((row) => row && row.account === account)
        .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    },
    async put(record) {
      const owned = foundries.get(record.foundry);
      if (!owned || owned.account !== record.account) {
        return { ok: false, error: "Choose a foundry you created." };
      }
      const book = load();
      const nonceKey = Buffer.from(record.nonce).toString("base64");
      if (book.nonces.includes(nonceKey)) {
        return { ok: false, error: "The wallet signature did not match this gig." };
      }
      const existing = book.gigs[record.id];
      if (existing && existing.account !== record.account) {
        return { ok: false, error: "That gig is already recorded." };
      }
      const signed = signatureMatches(
        { message: record.message, nonce: record.nonce, callbackUrl: record.callbackUrl },
        record.rawPublic,
        record.rawSignature,
      );
      if (!signed) return { ok: false, error: "The wallet signature did not match this gig." };
      const onChain = await fullAccessOnAccount(record.account, record.publicKey, fetchImpl);
      if (onChain !== "full") {
        return {
          ok: false,
          error: onChain === "unknown"
            ? "The account check did not answer."
            : "The wallet signature did not match this gig.",
        };
      }
      book.nonces.push(nonceKey);
      if (book.nonces.length > 5000) book.nonces.splice(0, book.nonces.length - 5000);
      const saved = {
        id: record.id,
        title: record.title,
        details: record.details,
        foundry: record.foundry,
        account: record.account,
        recordedAt: new Date().toISOString(),
      };
      book.gigs[record.id] = saved;
      save(book);
      return { ok: true, record: saved };
    },
  };
}
