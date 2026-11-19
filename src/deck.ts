export const STEPS = ["name", "account", "foundry", "job"] as const;

export type StepId = (typeof STEPS)[number];

export type Phase = "edit" | "holding" | "rehearsed";

export interface DeckValues {
  name: string;
  account: string;
  foundry: string;
  job: string;
}

export interface DeckState {
  active: StepId;
  values: DeckValues;
  done: StepId[];
  phase: Phase;
  holdStep: StepId | null;
  receipt: string[];
}

export const HOLD_MS = 4000;

export function createDeck(): DeckState {
  return {
    active: "name",
    values: { name: "", account: "", foundry: "", job: "" },
    done: [],
    phase: "edit",
    holdStep: null,
    receipt: [],
  };
}

export function setValue(state: DeckState, step: StepId, value: string): DeckState {
  if (state.phase === "holding") return state;
  const values: DeckValues = { ...state.values, [step]: value };
  let done = state.done;
  let active = state.active;
  if (value.trim().length === 0) {
    const cut = STEPS.indexOf(step);
    done = state.done.filter((item) => STEPS.indexOf(item) < cut);
    active = step;
  }
  const changed = value !== state.values[step];
  const clearSlip = changed && state.phase === "rehearsed";
  return {
    ...state,
    values,
    done,
    active,
    phase: clearSlip ? "edit" : state.phase,
    receipt: clearSlip ? [] : state.receipt,
    holdStep: null,
  };
}

export function canFinish(state: DeckState): boolean {
  if (state.phase !== "edit") return false;
  const step = state.active;
  if (state.done.includes(step)) return false;
  const index = STEPS.indexOf(step);
  for (let i = 0; i < index; i += 1) {
    const earlier = STEPS[i];
    if (!earlier || !state.done.includes(earlier)) return false;
  }
  return state.values[step].trim().length > 0;
}

export function finish(state: DeckState): DeckState {
  if (!canFinish(state)) return state;
  const index = STEPS.indexOf(state.active);
  const done = [...state.done, state.active];
  const next = STEPS[index + 1];
  return {
    ...state,
    done,
    active: next ?? state.active,
  };
}

export function selectStep(state: DeckState, step: StepId): DeckState {
  if (state.phase === "holding") return state;
  const index = STEPS.indexOf(step);
  for (let i = 0; i < index; i += 1) {
    const earlier = STEPS[i];
    if (!earlier || !state.done.includes(earlier)) return state;
  }
  return { ...state, active: step };
}

export function canHold(state: DeckState): boolean {
  if (state.phase !== "edit") return false;
  return STEPS.every(
    (step) => state.done.includes(step) && state.values[step].trim().length > 0,
  );
}

export function beginHold(state: DeckState): DeckState {
  if (!canHold(state)) return state;
  return {
    ...state,
    phase: "holding",
    holdStep: state.active,
    receipt: [],
  };
}

export function cancelHold(state: DeckState): DeckState {
  if (state.phase !== "holding") return state;
  return {
    ...state,
    phase: "edit",
    active: state.holdStep ?? state.active,
    holdStep: null,
    receipt: [],
  };
}

export function makeReceipt(state: DeckState): string[] {
  const values = state.values;
  return [
    "TESTNET REHEARSAL",
    `Name: ${values.name.trim()}`,
    `Account: ${values.account.trim()}`,
    `Foundry: ${values.foundry.trim()}`,
    `Job: ${values.job.trim()}`,
    "The chain transaction has not been sent.",
    "No agent id was assigned.",
    "Testnet only. No payment was made.",
  ];
}

export function receiptPreview(state: DeckState, progress: number): string[] {
  const lines = makeReceipt(state);
  if (progress <= 0) return [];
  if (progress >= 1) return lines;
  const count = Math.max(1, Math.ceil(progress * lines.length));
  return lines.slice(0, count);
}

export function completeHold(state: DeckState): DeckState {
  if (state.phase !== "holding") return state;
  return {
    ...state,
    phase: "rehearsed",
    active: state.holdStep ?? state.active,
    holdStep: null,
    receipt: makeReceipt(state),
  };
}

const STEP_LABEL: Record<StepId, string> = {
  name: "Name",
  account: "Account",
  foundry: "Foundry",
  job: "Job",
};

export function holdCue(state: DeckState): string {
  if (state.phase === "holding") return "Holding";
  if (state.phase === "rehearsed") return "Nothing was sent";
  if (canHold(state)) return "Hold to run";
  const missing = STEPS.find((step) => !state.done.includes(step)) ?? "name";
  return `${STEP_LABEL[missing]}, then hold`;
}

export function railStatus(state: DeckState, reducedMotion: boolean): string {
  if (state.phase === "holding") {
    return reducedMotion
      ? "Printing the slip. Release to cancel."
      : "Holding. Let go to cancel.";
  }
  if (state.phase === "rehearsed") return "Nothing was sent.";
  if (canHold(state)) return "Hold for four seconds. Let go to cancel.";
  if (state.active === "name" && state.values.name.trim().length === 0) return "Type a name.";
  if (state.active === "account" && state.values.account.trim().length === 0) {
    return "Connect a testnet wallet.";
  }
  if (state.active === "foundry" && state.values.foundry.trim().length === 0) return "Type an id.";
  if (state.active === "job" && state.values.job.trim().length === 0) return "Type what it will do.";
  return "Press Enter to set this step.";
}

export function fieldStatus(state: DeckState): string {
  if (state.phase === "holding") return "Holding";
  if (state.phase === "rehearsed") return "Nothing was sent";
  return "Open";
}
