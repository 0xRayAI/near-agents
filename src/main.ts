import "./style.css";
import {
  HOLD_MS,
  STEPS,
  beginHold,
  canFinish,
  canHold,
  canOpen,
  cancelHold,
  completeHold,
  createDeck,
  fieldStatus,
  finish,
  holdCue,
  nextStep,
  railStatus,
  receiptPreview,
  selectStep,
  setValue,
  type DeckState,
  type StepId,
} from "./deck.ts";
import { publicWalletError } from "./account.ts";
import { readTestnetAccount, shellId, type AccountView } from "./deploy.ts";
import { foundryMessage } from "./foundry-message.ts";
import { loadFlow, saveFlow } from "./flow-state.ts";
import { FieldView, type StepMark } from "./field.ts";
import { MAILBOX, claimWindowOpen, publicClaimError, readMailboxJobs, usdcLabel, type MailJob } from "./jobs.ts";
import { createWalletSession } from "./wallet.ts";

function isStep(value: string | undefined): value is StepId {
  return value === "name" || value === "account" || value === "foundry" || value === "job";
}

function reduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error("This page is missing a control.");
  return node;
}

const canvas = must<HTMLCanvasElement>("#field");
const holdBtn = must<HTMLButtonElement>("#hold");
const holdLabel = must<HTMLElement>("#hold-label");
const meter = must<HTMLElement>("#meter");
const receipt = must<HTMLElement>("#receipt");
const railNote = document.querySelector<HTMLElement>("#rail-note");
const fieldState = document.querySelector<HTMLElement>("#field-state");
const nodeFocus = document.querySelector<HTMLElement>("#node-focus");
const deployPanel = document.querySelector<HTMLElement>("#deploy");
const deployLead = document.querySelector<HTMLElement>("#deploy-lead");
const deployCommandEl = document.querySelector<HTMLElement>("#deploy-command");
const deployNote = document.querySelector<HTMLElement>("#deploy-note");
const copyBtn = document.querySelector<HTMLButtonElement>("#copy-command");
const retryBtn = document.querySelector<HTMLButtonElement>("#retry-record");
const jobsPanel = document.querySelector<HTMLElement>("#jobs");
const jobList = document.querySelector<HTMLElement>("#job-list");
const jobsStatus = document.querySelector<HTMLElement>("#jobs-status");

const accountIdEl = document.querySelector<HTMLElement>("#account-id");
const accountStatus = document.querySelector<HTMLElement>("#account-status");
const connectBtn = document.querySelector<HTMLButtonElement>("#connect-wallet");
const disconnectBtn = document.querySelector<HTMLButtonElement>("#disconnect-wallet");
const checkBtn = document.querySelector<HTMLButtonElement>("#check-account");

let state: DeckState = createDeck();
let holdGen = 0;
let painted = "";
let connecting = false;
let pointerDown = false;
let accountView: AccountView = "idle";
let accountNear = "";
let lookupGen = 0;
let signing = false;
let deployError = "";
let walletLive = false;
let recorded: { id: string; account: string; text: string } | null = null;
let jobs: MailJob[] = [];
let jobsError = "";
let jobsLoading = false;
let jobsFor = "";
let jobsGen = 0;
let claimingId: number | null = null;
const shownJobs = new Set<number>();
const sentJobs = new Set<number>();

const field = new FieldView(canvas, {
  onPick(id) {
    if (!isStep(id)) return;
    openStep(id);
  },
});

function sayAccount(text: string): void {
  if (accountStatus) accountStatus.textContent = text;
}

function accountLine(): string {
  if (accountView === "present") {
    const figure = accountNear === "under 0.0001" ? "less than 0.0001 NEAR" : `${accountNear} NEAR`;
    return `On testnet. ${figure}.`;
  }
  if (accountView === "absent") {
    return "That account is not on testnet yet. Create it in the wallet, then fund it from the faucet.";
  }
  if (accountView === "unknown") return "The account check did not answer.";
  return "";
}

async function lookupAccount(id: string): Promise<void> {
  const gen = ++lookupGen;
  accountView = "unknown";
  accountNear = "";
  sayAccount("Checking the account on testnet.");
  renderUi();
  const read = await readTestnetAccount(id);
  if (gen !== lookupGen) return;
  accountView = read.view;
  accountNear = read.near;
  sayAccount(accountLine());
  const before = state.active;
  if (state.values.account === id) advanceAccountIfReady();
  renderUi();
  if (state.active !== before) focusStep(state.active);
}

const wallets = createWalletSession((id) => {
  walletLive = Boolean(id);
  state = setValue(state, "account", id ?? "");
  if (state.phase === "edit") {
    recorded = null;
    deployError = "";
  }
  accountView = "idle";
  accountNear = "";
  if (!id) {
    lookupGen += 1;
    sayAccount("");
    renderUi();
    return;
  }
  void lookupAccount(id);
});

function paintReceipt(lines: string[]): void {
  const text = lines.join("\n");
  if (text === painted) return;
  painted = text;
  receipt.replaceChildren();
  if (lines.length === 0) {
    const quiet = document.createElement("p");
    quiet.className = "quiet";
    quiet.textContent = "The rehearsal prints here while you hold.";
    receipt.append(quiet);
    return;
  }
  lines.forEach((line, index) => {
    const row = document.createElement("p");
    if (index === 0 && line === "TESTNET REHEARSAL") row.className = "slip-head";
    row.textContent = line;
    receipt.append(row);
  });
}

function setMeter(progress: number): void {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  meter.style.width = `${pct}%`;
  meter.setAttribute("aria-valuenow", String(pct));
}

function stepMark(step: StepId): StepMark {
  if (state.phase === "rehearsed" || state.done.includes(step)) return "done";
  if (state.active === step) return "open";
  return "idle";
}

function foundryId(): string {
  return shellId(state.values.foundry);
}

function readyToHold(): boolean {
  return canHold(state) && accountView === "present" && foundryId().length > 0;
}

function recordText(id: string, account: string): string {
  return `Foundry: ${id}\nReceiver: ${account}\nListing: pending`;
}

function renderDeploy(): void {
  if (!deployPanel || !deployLead || !deployCommandEl || !deployNote) return;
  const show = state.phase === "rehearsed";
  deployPanel.hidden = !show;
  if (!show) return;
  if (recorded) {
    deployLead.textContent = `Foundry ${recorded.id} is recorded for ${recorded.account}. Listing stays pending.`;
    deployCommandEl.textContent = recorded.text;
    deployNote.textContent = "No agent id was assigned. No payment was sent. This page did not send a chain transaction.";
  } else if (signing) {
    deployLead.textContent = "Confirm the foundry in the wallet.";
    deployCommandEl.textContent = "";
    deployNote.textContent = "The signature stays in the wallet. This page does not take a key.";
  } else {
    deployLead.textContent = "The foundry is not recorded yet.";
    deployCommandEl.textContent = "";
    deployNote.textContent = deployError || "Sign with the wallet to record it for this account.";
  }
  if (copyBtn) copyBtn.hidden = !recorded;
  if (retryBtn) retryBtn.hidden = Boolean(recorded) || signing;
}

function rememberPosted(list: MailJob[]): void {
  for (const job of list) {
    if (job.status === "posted") shownJobs.add(job.id);
  }
}

function visibleJobs(): MailJob[] {
  return jobs.filter((job) => job.status === "posted" || shownJobs.has(job.id) || sentJobs.has(job.id));
}

function renderJobs(): void {
  if (!jobsPanel || !jobList || !jobsStatus) return;
  const show = Boolean(recorded) && state.phase === "rehearsed";
  jobsPanel.hidden = !show;
  if (!show) {
    jobsFor = "";
    return;
  }
  ensureJobs();
  const account = state.values.account.trim();
  const matches = Boolean(recorded && account === recorded.account);
  const visible = visibleJobs();
  jobList.replaceChildren();
  for (const job of visible) {
    const card = document.createElement("article");
    card.className = "job-card";
    const brief = document.createElement("p");
    brief.className = "job-brief";
    brief.textContent = job.brief;
    const amount = document.createElement("p");
    amount.className = "job-meta";
    const label = usdcLabel(job.amount);
    amount.textContent = label ? `${label} USDC` : job.amount;
    card.append(brief, amount);
    const open = job.status === "posted"
      && !sentJobs.has(job.id)
      && claimWindowOpen(job.expiresAt, BigInt(Date.now()) * 1_000_000n);
    if (open) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "claim-job";
      button.dataset.claim = String(job.id);
      button.textContent = "Claim";
      button.disabled = !walletLive || !matches || claimingId !== null || connecting || signing;
      card.append(button);
    } else if (job.status === "posted") {
      const status = document.createElement("p");
      status.className = "job-status";
      status.textContent = "The claim window has passed.";
      card.append(status);
    } else if (/^[a-z][a-z-]{0,24}$/i.test(job.status)) {
      const status = document.createElement("p");
      status.className = "job-status";
      status.textContent = `Status: ${job.status}`;
      card.append(status);
    }
    jobList.append(card);
  }
  if (claimingId !== null) jobsStatus.textContent = "Confirm the claim in the wallet.";
  else if (jobsError) jobsStatus.textContent = jobsError;
  else if (jobsLoading) jobsStatus.textContent = "Reading posted jobs.";
  else if (!walletLive) jobsStatus.textContent = "Connect the wallet to claim.";
  else if (!matches) jobsStatus.textContent = "Claim stays off until this wallet is the recorded receiver.";
  else if (visible.length === 0) jobsStatus.textContent = "No posted job yet.";
  else jobsStatus.textContent = "";
}

function ensureJobs(): void {
  if (!recorded || state.phase !== "rehearsed") {
    jobsFor = "";
    return;
  }
  const key = `${recorded.id}:${recorded.account}`;
  if (jobsFor === key) return;
  jobsFor = key;
  jobs = [];
  jobsError = "";
  shownJobs.clear();
  sentJobs.clear();
  void loadJobs();
}

async function loadJobs(): Promise<void> {
  const gen = ++jobsGen;
  jobsLoading = true;
  jobsError = "";
  renderUi();
  try {
    const list = await readMailboxJobs(MAILBOX);
    if (gen !== jobsGen) return;
    jobs = list;
    rememberPosted(list);
  } catch {
    if (gen !== jobsGen) return;
    jobsError = "The job list did not answer.";
  } finally {
    if (gen === jobsGen) {
      jobsLoading = false;
      renderUi();
    }
  }
}

async function claimPosted(jobId: number): Promise<void> {
  if (!recorded || claimingId !== null || signing) return;
  const account = state.values.account.trim();
  if (account !== recorded.account) return;
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const job = jobs.find((item) => (
    item.id === jobId
    && item.status === "posted"
    && !sentJobs.has(item.id)
    && claimWindowOpen(item.expiresAt, nowNs)
  ));
  if (!job) return;
  claimingId = jobId;
  jobsError = "";
  renderUi();
  try {
    await wallets.claim(account, jobId);
    sentJobs.add(jobId);
    shownJobs.add(jobId);
    try {
      const list = await readMailboxJobs(MAILBOX);
      jobs = list;
      rememberPosted(list);
      jobsError = "";
    } catch {
      jobsError = "The claim was sent. The job list did not answer.";
    }
  } catch (error) {
    jobsError = publicClaimError(error);
  } finally {
    claimingId = null;
    renderUi();
  }
}

function renderUi(): void {
  const holding = state.phase === "holding";
  const rehearsed = state.phase === "rehearsed";

  for (const step of STEPS) {
    const item = document.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (!item) continue;
    item.classList.toggle("is-active", state.active === step);
    item.classList.toggle("is-done", state.done.includes(step));
    const tab = item.querySelector<HTMLButtonElement>(".step-tab");
    tab?.setAttribute("aria-current", state.active === step ? "step" : "false");
    tab?.setAttribute("aria-disabled", canOpen(state, step) ? "false" : "true");
    const next = item.querySelector<HTMLButtonElement>("[data-next]");
    if (next) next.disabled = state.active !== step || !canFinish(state);
    const val = item.querySelector<HTMLElement>("[data-val]");
    if (val) val.textContent = state.values[step].trim();
    const input = item.querySelector<HTMLInputElement>("input");
    if (input) {
      input.disabled = holding;
      if (document.activeElement !== input && input.value !== state.values[step]) {
        input.value = state.values[step];
      }
    }
  }

  const armed = readyToHold();
  holdBtn.disabled = rehearsed || (!holding && !armed);
  holdBtn.classList.toggle("is-hot", holding);
  holdBtn.classList.toggle("is-done", rehearsed);
  if (signing) holdLabel.textContent = "Confirm in the wallet";
  else if (recorded) holdLabel.textContent = "Foundry recorded";
  else if (holding || rehearsed || armed) holdLabel.textContent = holdCue(state);
  else if (canHold(state) && accountView !== "present") holdLabel.textContent = "Account, then hold";
  else if (canHold(state)) holdLabel.textContent = "Foundry, then hold";
  else holdLabel.textContent = holdCue(state);

  if (!holding) {
    if (rehearsed) {
      paintReceipt(state.receipt);
      setMeter(1);
      field.setLocked(true);
      field.setTighten(reduced() ? 0 : 0.12);
    } else {
      paintReceipt([]);
      setMeter(0);
      field.setLocked(false);
      field.setTighten(0);
    }
  }

  const hasAccount = state.values.account.trim().length > 0;
  if (accountIdEl) accountIdEl.textContent = hasAccount ? state.values.account.trim() : "";
  if (connectBtn) {
    connectBtn.hidden = walletLive;
    connectBtn.disabled = holding || connecting;
    connectBtn.textContent = connecting ? "Opening" : "Connect wallet";
  }
  if (disconnectBtn) {
    disconnectBtn.hidden = !walletLive;
    disconnectBtn.disabled = holding || connecting || claimingId !== null;
  }
  if (checkBtn) {
    checkBtn.hidden = !hasAccount || accountView === "present" || accountView === "idle";
    checkBtn.disabled = holding || connecting;
  }

  field.setAgentLabel(state.values.name);
  field.setSteps({
    name: stepMark("name"),
    account: stepMark("account"),
    foundry: stepMark("foundry"),
    job: stepMark("job"),
  });
  if (fieldState) {
    if (signing) fieldState.textContent = "Confirm in the wallet";
    else if (recorded) fieldState.textContent = "Foundry recorded";
    else fieldState.textContent = fieldStatus(state);
    fieldState.classList.toggle("is-locked", rehearsed);
  }
  if (railNote) {
    if (signing) {
      railNote.textContent = "Confirm the foundry in the wallet.";
    } else if (recorded) {
      railNote.textContent = "Foundry recorded. Listing stays pending.";
    } else if (!holding && !rehearsed && canHold(state) && accountView === "absent") {
      railNote.textContent = "That account is not on testnet yet.";
    } else if (!holding && !rehearsed && canHold(state) && accountView !== "present") {
      railNote.textContent = "The account check did not answer.";
    } else if (!holding && !rehearsed && canHold(state) && foundryId().length === 0) {
      railNote.textContent = "Use letters and numbers for the id.";
    } else {
      railNote.textContent = railStatus(state, reduced());
    }
  }
  renderDeploy();
  renderJobs();
  saveFlow({
    state,
    recorded: recorded ? { id: recorded.id, account: recorded.account } : null,
  }, localStorage);
}

function advanceAccountIfReady(): void {
  if (state.active === "account" && accountView === "present" && canFinish(state)) {
    state = finish(state);
  }
}

function tryFinish(): void {
  if (!canFinish(state)) return;
  state = finish(state);
  advanceAccountIfReady();
  renderUi();
  if (readyToHold()) {
    holdBtn.focus();
    return;
  }
  focusStep(state.active);
}

function openStep(step: StepId): void {
  if (state.phase === "holding") return;
  if (step !== state.active && step === nextStep(state) && canFinish(state)) {
    tryFinish();
    return;
  }
  const next = selectStep(state, step);
  if (next === state) return;
  state = next;
  renderUi();
  focusStep(state.active);
}

function focusStep(step: StepId): void {
  const input = document.querySelector<HTMLInputElement>(`[data-field="${step}"]`);
  if (input) {
    input.focus();
    return;
  }
  if (step !== "account") return;
  const target = walletLive ? disconnectBtn : connectBtn;
  target?.focus();
}

function startHold(): void {
  if (state.phase === "holding" || !readyToHold()) return;
  const gen = ++holdGen;
  state = beginHold(state);
  const started = performance.now();
  renderUi();
  const pump = (now: number) => {
    if (gen !== holdGen || state.phase !== "holding") return;
    const progress = Math.min(1, (now - started) / HOLD_MS);
    field.setTighten(reduced() ? 0 : progress);
    paintReceipt(receiptPreview(state, progress));
    setMeter(progress);
    if (progress >= 1) {
      state = completeHold(state);
      field.setLocked(true);
      field.setTighten(reduced() ? 0 : 0.12);
      renderUi();
      void recordFoundry();
      return;
    }
    requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
}

function endHold(): void {
  if (state.phase !== "holding") return;
  holdGen += 1;
  state = cancelHold(state);
  field.setTighten(0);
  field.setLocked(false);
  renderUi();
}

document.querySelectorAll<HTMLButtonElement>("[data-select]").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.getAttribute("aria-disabled") === "true") return;
    if (!isStep(tab.dataset.select)) return;
    openStep(tab.dataset.select);
  });
});

connectBtn?.addEventListener("click", () => {
  if (connecting || state.phase === "holding") return;
  connecting = true;
  sayAccount("Opening the wallet list.");
  renderUi();
  void wallets.connect().then(
    () => {
      connecting = false;
      renderUi();
    },
    (error: unknown) => {
      connecting = false;
      sayAccount(publicWalletError(error));
      renderUi();
    },
  );
});

disconnectBtn?.addEventListener("click", () => {
  if (connecting || state.phase === "holding") return;
  connecting = true;
  renderUi();
  void wallets.disconnect().then(
    () => {
      connecting = false;
      accountView = "idle";
      accountNear = "";
      sayAccount("Disconnected. The account is no longer on this page.");
      renderUi();
    },
    (error: unknown) => {
      connecting = false;
      sayAccount(publicWalletError(error));
      renderUi();
    },
  );
});

checkBtn?.addEventListener("click", () => {
  const id = state.values.account.trim();
  if (!id || state.phase === "holding") return;
  void lookupAccount(id);
});

async function recordFoundry(): Promise<void> {
  if (signing || recorded || state.phase !== "rehearsed") return;
  const id = foundryId();
  const account = state.values.account.trim();
  if (!id || !account) return;
  const fields = {
    name: state.values.name.trim(),
    account,
    foundry: id,
    job: state.values.job.trim(),
  };
  signing = true;
  deployError = "";
  renderUi();
  try {
    const signed = await wallets.sign(foundryMessage(fields), account);
    const response = await fetch("/api/foundry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...fields,
        publicKey: signed.publicKey,
        signature: signed.signature,
        nonce: signed.nonce,
        callbackUrl: window.location.href,
      }),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; record?: { id: string; account: string } };
    if (!response.ok || !body.record) {
      throw new Error(body.error || "The foundry was not recorded.");
    }
    recorded = {
      id: body.record.id,
      account: body.record.account,
      text: recordText(body.record.id, body.record.account),
    };
  } catch (error) {
    deployError = publicWalletError(error);
  } finally {
    signing = false;
    renderUi();
  }
}

copyBtn?.addEventListener("click", () => {
  if (!recorded || !navigator.clipboard) return;
  void navigator.clipboard.writeText(recorded.text).then(
    () => {
      if (deployNote) deployNote.textContent = "Copied.";
    },
    () => {
      if (deployNote) deployNote.textContent = "Select the record and copy it.";
    },
  );
});

retryBtn?.addEventListener("click", () => {
  void recordFoundry();
});

jobList?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button");
  if (!button || button.disabled || !button.dataset.claim) return;
  const id = Number(button.dataset.claim);
  if (!Number.isInteger(id)) return;
  void claimPosted(id);
});

document.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
  input.addEventListener("input", () => {
    if (!isStep(input.dataset.field)) return;
    state = setValue(state, input.dataset.field, input.value);
    if (state.phase === "edit") {
      recorded = null;
      deployError = "";
    }
    renderUi();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    tryFinish();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-next]").forEach((button) => {
  button.addEventListener("click", () => {
    tryFinish();
  });
});

holdBtn.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  holdBtn.focus();
  pointerDown = true;
  try {
    holdBtn.setPointerCapture(event.pointerId);
  } catch {
    /* The pointer can vanish before capture. */
  }
  startHold();
});
holdBtn.addEventListener("pointerup", () => {
  pointerDown = false;
  endHold();
});
holdBtn.addEventListener("pointercancel", () => {
  pointerDown = false;
  endHold();
});
holdBtn.addEventListener("blur", () => {
  if (pointerDown) return;
  endHold();
});
holdBtn.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (event.repeat) return;
  startHold();
});
holdBtn.addEventListener("keyup", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  endHold();
});

canvas.addEventListener("keydown", (event) => {
  const dirs = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  } as const;
  if (event.key in dirs) {
    event.preventDefault();
    const label = field.moveFocus(dirs[event.key as keyof typeof dirs]);
    if (nodeFocus) nodeFocus.textContent = label;
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (canFinish(state)) {
    tryFinish();
    return;
  }
  if (!holdBtn.disabled) holdBtn.focus();
});

const saved = loadFlow(localStorage);
if (saved) {
  state = saved.state;
  recorded = saved.recorded
    ? {
      id: saved.recorded.id,
      account: saved.recorded.account,
      text: recordText(saved.recorded.id, saved.recorded.account),
    }
    : null;
}
renderUi();
if (nodeFocus) nodeFocus.textContent = field.focusedLabel();
const restoredAccount = state.values.account.trim();
if (restoredAccount) void lookupAccount(restoredAccount);
void wallets.resume();

const sheetToggle = document.querySelector<HTMLButtonElement>("#sheet-toggle");
const sheetKey = "near-sheet";

function applySheet(sheet: string): void {
  if (sheet === "paper") document.documentElement.dataset.sheet = "paper";
  else delete document.documentElement.dataset.sheet;
  if (!sheetToggle) return;
  sheetToggle.setAttribute("aria-pressed", sheet === "paper" ? "true" : "false");
  sheetToggle.textContent = sheet === "paper" ? "Dark" : "Light";
  sheetToggle.setAttribute("aria-label", sheet === "paper" ? "Switch to dark mode" : "Switch to light mode");
}

applySheet(localStorage.getItem(sheetKey) === "paper" ? "paper" : "board");

sheetToggle?.addEventListener("click", () => {
  const next = document.documentElement.dataset.sheet === "paper" ? "board" : "paper";
  localStorage.setItem(sheetKey, next);
  applySheet(next);
});
