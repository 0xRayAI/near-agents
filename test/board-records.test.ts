import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const deck = html.slice(html.indexOf('id="deck"'), html.indexOf('id="yours"'));
const yours = html.slice(html.indexOf('id="yours"'), html.indexOf('id="how"'));

test("saved foundries and gigs sit on the board as tabs", () => {
  assert.match(deck, /id="board-records"/);
  assert.match(deck, /data-record-tab="foundries"/);
  assert.match(deck, /data-record-tab="gigs"/);
  assert.match(deck, /data-gig-side="opened"/);
  assert.match(deck, /data-gig-side="bought"/);
  assert.match(deck, /data-foundry-list/);
  assert.match(deck, /data-opened-list/);
  assert.match(deck, /data-bought-list/);
  assert.match(deck, /data-records-status/);
});

test("the same tabs stay under Your records", () => {
  assert.match(yours, /id="foundry-list"/);
  assert.match(yours, /id="gig-list"/);
  assert.match(yours, /data-record-tab="foundries"/);
  assert.match(yours, /data-record-tab="gigs"/);
  assert.match(yours, /data-gig-side="opened"/);
  assert.match(yours, /data-gig-side="bought"/);
  assert.match(yours, /data-foundry-list/);
  assert.match(yours, /data-opened-list/);
  assert.match(yours, /data-bought-list/);
  assert.match(yours, /data-records-status/);
});
