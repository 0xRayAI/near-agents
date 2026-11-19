import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const deck = html.slice(html.indexOf('id="deck"'), html.indexOf('id="yours"'));
const yours = html.slice(html.indexOf('id="yours"'), html.indexOf('id="how"'));

test("saved foundries and gigs sit on the board", () => {
  assert.match(deck, /id="board-records"/);
  assert.match(deck, /data-foundry-list/);
  assert.match(deck, /data-gig-list/);
  assert.match(deck, /data-records-status/);
  assert.match(deck, /Foundries you created/);
  assert.match(deck, /Gigs you posted/);
});

test("the same records stay under Your records", () => {
  assert.match(yours, /id="foundry-list"/);
  assert.match(yours, /id="gig-list"/);
  assert.match(yours, /data-foundry-list/);
  assert.match(yours, /data-gig-list/);
  assert.match(yours, /data-records-status/);
});
