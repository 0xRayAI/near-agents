import { shellId } from "./deploy.ts";

const GIG_ID = /^[a-z][a-z0-9-]{1,30}$/;

/** Stable id from the note itself. The server recomputes this and will not take a different one. */
export function gigPublicId(input: {
  title: string;
  details: string;
  foundry: string;
  account: string;
}): string {
  const stem = (shellId(input.title) || "gig").slice(0, 20);
  const stamp = fnv32(
    `${input.account.trim()}\n${input.foundry.trim()}\n${input.title.trim()}\n${input.details.trim()}`,
  ).toString(16).padStart(8, "0").slice(0, 6);
  const id = `${stem}-${stamp}`;
  return GIG_ID.test(id) ? id : "";
}

export function gigMessage(input: {
  title: string;
  details: string;
  foundry: string;
  account: string;
  id: string;
}): string {
  return [
    "Post this gig",
    `Title: ${input.title.trim()}`,
    `Details: ${input.details.trim()}`,
    `Foundry: ${input.foundry.trim()}`,
    `Account: ${input.account.trim()}`,
    `Gig: ${input.id.trim()}`,
  ].join("\n");
}

function fnv32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
