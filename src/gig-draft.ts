import { shellId } from "./deploy.ts";

export const GIG_DRAFT_KEY = "near-agents.gig.v1";

export interface GigDraft {
  title: string;
  details: string;
  foundry: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return text.length > max ? text.slice(0, max) : text;
}

export function loadGigDraft(store: KeyValueStore): GigDraft {
  const empty = { title: "", details: "", foundry: "" };
  try {
    const text = store.getItem(GIG_DRAFT_KEY);
    if (!text) return empty;
    const parsed = JSON.parse(text) as { title?: unknown; details?: unknown; foundry?: unknown };
    return {
      title: clean(parsed.title, 80),
      details: clean(parsed.details, 240),
      foundry: shellId(typeof parsed.foundry === "string" ? parsed.foundry : ""),
    };
  } catch {
    return empty;
  }
}

export function saveGigDraft(draft: GigDraft, store: KeyValueStore): void {
  const next = {
    title: clean(draft.title, 80),
    details: clean(draft.details, 240),
    foundry: shellId(draft.foundry),
  };
  try {
    if (!next.title && !next.details && !next.foundry) {
      store.removeItem(GIG_DRAFT_KEY);
      return;
    }
    store.setItem(GIG_DRAFT_KEY, JSON.stringify(next));
  } catch {
    /* A full or blocked store still leaves the page usable. */
  }
}
