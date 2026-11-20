import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const line = "Creating the agent account costs at least 0.007 NEAR. The faucet pays that. This page sends no NEAR. A contract also needs storage: 0.00001 NEAR per byte, kept on the account.";
const banned = ["mill", "forge", "nibbler", "arch1", "blaze", "critic", "hangar", "groover", "packet", "plane", "raci", "launch"];

test("the page states the protocol minimum to create an agent account", () => {
  const hits = html.split(line).length - 1;
  assert.equal(hits, 4, "description, form, cost answer, and the how-much answer");
  assert.match(html, /Agent account: at least 0\.007 NEAR\. Contract storage: 0\.00001 NEAR per byte\./);
  assert.match(html, /<b>0\.007<\/b> NEAR, faucet pays/);
  assert.match(html, /<b>0\.00001<\/b> NEAR per byte stored/);
  assert.match(html, /id="near-min"/);
  assert.match(html, /100,000 bytes locks 1 NEAR/);
  assert.match(html, /does not deploy a contract/);
  assert.match(html, /770 bytes/);
  const lower = html.toLowerCase();
  for (const word of banned) {
    assert.equal(lower.includes(word), false, word);
  }
});
