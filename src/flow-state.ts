import { isTestnetAccount } from "./account.ts";
import {
  STEPS,
  type DeckState,
  type DeckValues,
  type Phase,
  type StepId,
} from "./deck.ts";
import { shellId } from "./deploy.ts";

export const FLOW_KEY = "near-agents.flow.v1";
const MAX_TEXT = 240;
const MAX_LINES = 12;

export interface FlowRecord {
  id: string;
  account: string;
}

export interface FlowSave {
  state: DeckState;
  recorded: FlowRecord | null;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_TEXT) return null;
  return value;
}

function isStep(value: unknown): value is StepId {
  return value === "name" || value === "account" || value === "foundry" || value === "job";
}

function readState(raw: unknown): DeckState | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as {
    active?: unknown;
    values?: unknown;
    done?: unknown;
    phase?: unknown;
    receipt?: unknown;
  };
  if (!isStep(body.active)) return null;
  if (body.phase !== "edit" && body.phase !== "rehearsed") return null;
  if (!body.values || typeof body.values !== "object") return null;
  const source = body.values as Partial<Record<StepId, unknown>>;
  const values = {} as DeckValues;
  for (const step of STEPS) {
    const text = cleanText(source[step]);
    if (text == null) return null;
    values[step] = text;
  }
  if (values.account.trim() && !isTestnetAccount(values.account.trim())) return null;
  if (!Array.isArray(body.done)) return null;
  const done: StepId[] = [];
  for (let i = 0; i < body.done.length; i += 1) {
    const step = body.done[i];
    if (!isStep(step) || step !== STEPS[i] || !values[step].trim()) return null;
    done.push(step);
  }
  const activeAt = STEPS.indexOf(body.active);
  if (done.length < activeAt) return null;
  const phase: Phase = body.phase;
  let receipt: string[] = [];
  if (phase === "rehearsed") {
    if (!Array.isArray(body.receipt) || body.receipt.length > MAX_LINES) return null;
    for (const line of body.receipt) {
      const text = cleanText(line);
      if (text == null) return null;
      receipt.push(text);
    }
  }
  return {
    active: body.active,
    values,
    done,
    phase,
    holdStep: null,
    receipt,
  };
}

function readRecord(raw: unknown, account: string): FlowRecord | null {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object") return null;
  const body = raw as { id?: unknown; account?: unknown };
  const id = cleanText(body.id);
  const owner = cleanText(body.account);
  if (!id || !owner || id !== shellId(id) || !isTestnetAccount(owner)) return null;
  if (owner !== account.trim()) return null;
  return { id, account: owner };
}

export function loadFlow(store: KeyValueStore): FlowSave | null {
  let parsed: unknown;
  try {
    const text = store.getItem(FLOW_KEY);
    if (!text) return null;
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as { state?: unknown; recorded?: unknown };
  const state = readState(body.state);
  if (!state) return null;
  return { state, recorded: readRecord(body.recorded, state.values.account) };
}

export function saveFlow(flow: FlowSave, store: KeyValueStore): void {
  const state = flow.state.phase === "holding"
    ? { ...flow.state, phase: "edit" as const, holdStep: null, receipt: [] }
    : { ...flow.state, holdStep: null };
  const blank = STEPS.every((step) => state.values[step].trim().length === 0)
    && state.done.length === 0
    && !flow.recorded;
  try {
    if (blank) {
      store.removeItem(FLOW_KEY);
      return;
    }
    const recorded = flow.recorded && flow.recorded.account === state.values.account.trim()
      ? { id: flow.recorded.id, account: flow.recorded.account }
      : null;
    store.setItem(FLOW_KEY, JSON.stringify({ state, recorded }));
  } catch {
    /* A full or blocked store still leaves the page usable. */
  }
}
