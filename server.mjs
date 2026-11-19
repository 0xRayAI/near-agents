import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFoundryStore, readFoundryBody } from "./foundry-store.mjs";
import { createGigStore, readGigBody } from "./gig-store.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT) || 4321;
const dataDir = process.env.FOUNDRY_DIR || join(fileURLToPath(new URL(".", import.meta.url)), "data");
const store = createFoundryStore(join(dataDir, "foundries.json"));
const gigs = createGigStore(join(dataDir, "gigs.json"), store);

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4096) {
        reject(new Error("too big"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/foundry" && req.method === "GET") {
    if (url.searchParams.has("account")) {
      const foundries = store.list(url.searchParams.get("account") || "");
      if (!foundries) {
        sendJson(res, 400, { ok: false, error: "Connect a testnet account." });
        return;
      }
      sendJson(res, 200, { ok: true, foundries });
      return;
    }
    const record = store.get(url.searchParams.get("id") || "");
    if (!record) {
      sendJson(res, 404, { ok: false, error: "That foundry is not recorded." });
      return;
    }
    sendJson(res, 200, { ok: true, record });
    return;
  }
  if (url.pathname === "/api/gig" && req.method === "GET") {
    const rows = gigs.list(url.searchParams.get("account") || "");
    if (!rows) {
      sendJson(res, 400, { ok: false, error: "Connect a testnet account." });
      return;
    }
    sendJson(res, 200, { ok: true, gigs: rows });
    return;
  }
  if (url.pathname === "/api/gig" && req.method === "POST") {
    try {
      const parsed = readGigBody(await readBody(req));
      if (!parsed.ok) {
        sendJson(res, 400, { ok: false, error: parsed.error });
        return;
      }
      const saved = await gigs.put(parsed.record);
      sendJson(res, saved.ok ? 200 : 400, saved.ok ? { ok: true, record: saved.record } : { ok: false, error: saved.error });
    } catch {
      sendJson(res, 400, { ok: false, error: "The gig was not saved." });
    }
    return;
  }
  if (url.pathname === "/api/foundry" && req.method === "POST") {
    try {
      const parsed = readFoundryBody(await readBody(req));
      if (!parsed.ok) {
        sendJson(res, 400, { ok: false, error: parsed.error });
        return;
      }
      const saved = await store.put(parsed.record);
      sendJson(res, saved.ok ? 200 : 400, saved.ok ? { ok: true, record: saved.record } : { ok: false, error: saved.error });
    } catch {
      sendJson(res, 400, { ok: false, error: "The foundry was not recorded." });
    }
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const rel = pathname.replace(/^\/+/, "");
  if (!rel || rel.split("/").includes("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const file = join(root, rel);
  try {
    const data = await readFile(file);
    const type = types[extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`listening ${port}`);
});
