import "./style.css";
import {
  HOLD_MS,
  STEPS,
  beginHold,
  canFinish,
  canHold,
  canOpen,
  cancelHold,
  continuation,
  anotherRound,
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
import { loadGigDraft, saveGigDraft, type GigDraft } from "./gig-draft.ts";
import { gigSaveEnabled, gigSaveLabel, showGigControl } from "./gig-form.ts";
import { gigMessage, gigPublicId } from "./gig-message.ts";
import { drawingLabel } from "./drawing-label.ts";
import { FieldView, type StepMark } from "./field.ts";
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
const noticeGig = document.querySelector<HTMLButtonElement>("#notice-gig");
const noticeAnother = document.querySelector<HTMLButtonElement>("#notice-another");
const noticeClose = document.querySelector<HTMLButtonElement>("#notice-close");
const rail = document.querySelector<HTMLElement>("#rail");
const foundrySteps = document.querySelector<HTMLElement>("#foundry-steps");
const gigForm = document.querySelector<HTMLFormElement>("#gig-form");
const gigTitle = document.querySelector<HTMLInputElement>("#gig-title");
const gigDetails = document.querySelector<HTMLTextAreaElement>("#gig-details");
const gigFoundry = document.querySelector<HTMLSelectElement>("#gig-foundry");
const gigSave = document.querySelector<HTMLButtonElement>("#gig-save");
const gigStatus = document.querySelector<HTMLElement>("#gig-status");
const foundryShell = document.querySelector<HTMLElement>("#foundry-shell");
const stageEl = document.querySelector<HTMLElement>(".stage");
const navAccount = document.querySelector<HTMLElement>("#nav-account");
const navDisconnect = document.querySelector<HTMLButtonElement>("#nav-disconnect");
const fieldCaption = document.querySelector<HTMLElement>("#field-caption");
const railTitle = document.querySelector<HTMLElement>("#rail-title");
const ctaTitle = document.querySelector<HTMLElement>("#cta-title");
const modeFoundryBtn = document.querySelector<HTMLButtonElement>("#mode-foundry");
const modeGigBtn = document.querySelector<HTMLButtonElement>("#mode-gig");

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
let gigSigning = false;
let deployError = "";
let walletLive = false;
let mode: "foundry" | "gig" = "foundry";
let notice: Notice | null = null;
let gigDraft: GigDraft = loadGigDraft(localStorage);
let foundryRows: FoundryRow[] = [];
let gigRows: GigRow[] = [];
let recordsFor = "";
let recordsGen = 0;
let recordsState: "idle" | "loading" | "ready" | "error" = "idle";
let freshFoundryId = "";
let freshGigId = "";
let preferredFoundry = gigDraft.foundry;

interface FoundryRow {
  id: string;
  name: string;
  account: string;
  job: string;
  listing: string;
  recordedAt: string;
}

interface GigRow {
  id: string;
  title: string;
  details: string;
  foundry: string;
  account: string;
  recordedAt: string;
}

type Notice =
  | { kind: "foundry-saved"; id: string; account: string; text: string }
  | { kind: "gig-saved"; title: string; foundry: string; text: string };

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
  if (state.phase === "edit") deployError = "";
  if (!id) notice = null;
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
    quiet.textContent = "Press and hold. A preview prints here.";
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
  return canHold(state) && accountView === "present" && foundryId().length > 0 && !idAlreadySaved();
}

function recordText(id: string, account: string): string {
  return `Foundry: ${id}\nReceiver: ${account}\nListing: pending`;
}

function renderDeploy(): void {
  if (!deployPanel || !deployLead || !deployCommandEl || !deployNote) return;
  const failed = state.phase === "rehearsed" && !signing && !notice;
  const show = Boolean(notice) || signing || gigSigning || failed;
  deployPanel.hidden = !show;
  if (!show) return;
  if (signing) {
    deployLead.textContent = "Confirm the foundry in the wallet.";
    deployCommandEl.textContent = "";
    deployNote.textContent = "The signature stays in the wallet. This page does not take a key.";
  } else if (gigSigning) {
    deployLead.textContent = "Confirm the gig in the wallet.";
    deployCommandEl.textContent = "";
    deployNote.textContent = "No payment is sent. This page does not send a chain transaction.";
  } else if (notice?.kind === "foundry-saved") {
    deployLead.textContent = `Foundry ${notice.id} is saved for ${notice.account}. Listing stays pending. No payment was sent. This did not post a gig.`;
    deployCommandEl.textContent = notice.text;
    deployNote.textContent = "No agent id was assigned. No payment was sent. This page did not send a chain transaction.";
  } else if (notice?.kind === "gig-saved") {
    deployLead.textContent = `Gig “${notice.title}” is saved on ${notice.foundry}. No payment was sent. This is not a chain job.`;
    deployCommandEl.textContent = notice.text;
    deployNote.textContent = "No payment was sent. This page did not send a chain transaction.";
  } else {
    deployLead.textContent = deployError || "The foundry was not saved. Your wallet is still connected.";
    deployCommandEl.textContent = "";
    deployNote.textContent = "Nothing was saved.";
  }
  if (copyBtn) copyBtn.hidden = notice?.kind !== "foundry-saved" && notice?.kind !== "gig-saved";
  if (retryBtn) retryBtn.hidden = !failed || signing || deployError === "That foundry id is already recorded.";
  deployCommandEl.hidden = (deployCommandEl.textContent || "").length === 0;
  if (noticeGig) noticeGig.hidden = notice?.kind !== "foundry-saved";
  if (noticeAnother) noticeAnother.hidden = notice?.kind !== "gig-saved";
  if (noticeClose) noticeClose.hidden = !notice;
}

function ownedFoundries(): FoundryRow[] {
  const account = state.values.account.trim();
  return foundryRows.filter((row) => showGigControl(row.account, account));
}

function idAlreadySaved(): boolean {
  const id = foundryId();
  const account = state.values.account.trim();
  return id.length > 0 && foundryRows.some((row) => row.id === id && row.account === account);
}

function signFailure(error: unknown, fallback: string): string {
  const text = publicWalletError(error);
  if (text === "The wallet did not connect." || /reject|cancel|dismiss/i.test(text)) return fallback;
  return text;
}

function syncRecords(): void {
  const account = state.values.account.trim();
  if (!walletLive || accountView !== "present" || !account) {
    recordsFor = "";
    if (!walletLive) {
      recordsState = "idle";
      foundryRows = [];
      gigRows = [];
    }
    return;
  }
  if (recordsFor === account) return;
  recordsFor = account;
  void loadRecords(account);
}

async function loadRecords(account: string): Promise<void> {
  const gen = ++recordsGen;
  recordsState = "loading";
  renderUi();
  try {
    const [foundryRes, gigRes] = await Promise.all([
      fetch(`/api/foundry?account=${encodeURIComponent(account)}`),
      fetch(`/api/gig?account=${encodeURIComponent(account)}`),
    ]);
    if (gen !== recordsGen) return;
    const foundryBody = await foundryRes.json() as { foundries?: unknown };
    const gigBody = await gigRes.json() as { gigs?: unknown };
    if (!foundryRes.ok || !gigRes.ok) throw new Error("load");
    foundryRows = readFoundryRows(foundryBody.foundries).filter((row) => row.account === account);
    gigRows = readGigRows(gigBody.gigs).filter((row) => row.account === account);
    recordsState = "ready";
  } catch {
    if (gen !== recordsGen) return;
    recordsState = "error";
  } finally {
    if (gen === recordsGen) renderUi();
  }
}

function readFoundryRows(value: unknown): FoundryRow[] {
  if (!Array.isArray(value)) return [];
  const rows: FoundryRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<FoundryRow>;
    if (typeof row.id !== "string" || typeof row.account !== "string") continue;
    rows.push({
      id: row.id,
      name: typeof row.name === "string" ? row.name : "",
      account: row.account,
      job: typeof row.job === "string" ? row.job : "",
      listing: "pending",
      recordedAt: typeof row.recordedAt === "string" ? row.recordedAt : "",
    });
  }
  return rows;
}

function readGigRows(value: unknown): GigRow[] {
  if (!Array.isArray(value)) return [];
  const rows: GigRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<GigRow>;
    if (typeof row.id !== "string" || typeof row.account !== "string" || typeof row.foundry !== "string") continue;
    rows.push({
      id: row.id,
      title: typeof row.title === "string" ? row.title : "",
      details: typeof row.details === "string" ? row.details : "",
      foundry: row.foundry,
      account: row.account,
      recordedAt: typeof row.recordedAt === "string" ? row.recordedAt : "",
    });
  }
  return rows;
}

function savedOn(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? `Saved ${value.slice(0, 10)}` : "";
}

function mounts(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

function setMountText(selector: string, text: string): void {
  for (const node of mounts(selector)) node.textContent = text;
}

function recordsStatus(connected: boolean): string {
  if (!connected) {
    if (!walletLive) return "Connect a wallet to see foundries you created and gigs you posted.";
    if (accountView === "absent") return "That account is not on testnet yet.";
    return "Checking the account on testnet.";
  }
  if (recordsState === "error") return "Your records did not load. Your wallet is still connected.";
  return "Loading your records.";
}

function renderRecords(): void {
  const account = state.values.account.trim();
  const connected = walletLive && accountView === "present";
  const foundryMounts = mounts("[data-foundry-list]");
  const gigMounts = mounts("[data-gig-list]");
  setMountText("[data-records-sub]", connected ? `Saved for ${account}.` : "");
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-records-retry]")) {
    button.hidden = recordsState !== "error";
  }
  const waiting = !connected
    || recordsState === "error"
    || ((recordsState === "loading" || recordsState === "idle") && foundryRows.length === 0 && gigRows.length === 0);
  if (waiting) {
    for (const mount of foundryMounts) mount.replaceChildren();
    for (const mount of gigMounts) mount.replaceChildren();
    setMountText("[data-records-status]", recordsStatus(connected));
    return;
  }
  setMountText("[data-records-status]", "");
  for (const mount of foundryMounts) fillFoundries(mount, account);
  for (const mount of gigMounts) fillGigs(mount, account);
}

function fillFoundries(mount: HTMLElement, account: string): void {
  mount.replaceChildren();
  if (foundryRows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No foundry yet. A foundry is a signed note. It does not post a gig and it does not move USDC.";
    mount.append(empty);
    return;
  }
  for (const row of foundryRows) mount.append(foundryCard(row, account));
}

function fillGigs(mount: HTMLElement, account: string): void {
  mount.replaceChildren();
  if (gigRows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = foundryRows.length === 0
      ? "No gig yet. Save a foundry before you post a gig. No payment is sent."
      : "No gig yet. A gig is a signed note with a title, details, and a foundry. No payment is sent.";
    mount.append(empty);
    return;
  }
  for (const row of gigRows) {
    if (row.account !== account) continue;
    mount.append(gigCard(row));
  }
}

function foundryCard(row: FoundryRow, account: string): HTMLElement {
  const card = document.createElement("article");
  card.className = "record-card";
  const id = document.createElement("p");
  id.className = "record-id";
  id.textContent = row.id;
  const name = document.createElement("p");
  name.className = "record-name";
  name.textContent = row.name;
  const job = document.createElement("p");
  job.textContent = `What it will do: ${row.job}`;
  const listing = document.createElement("p");
  listing.className = "hint";
  listing.textContent = freshFoundryId === row.id ? "Listing pending. No agent id. Just saved." : "Listing pending. No agent id.";
  card.append(id, name, job, listing);
  const when = savedOn(row.recordedAt);
  if (when) {
    const date = document.createElement("p");
    date.className = "hint";
    date.textContent = when;
    card.append(date);
  }
  const actions = document.createElement("div");
  actions.className = "record-actions";
  if (showGigControl(row.account, account)) {
    const post = document.createElement("button");
    post.type = "button";
    post.textContent = "Post a gig";
    post.addEventListener("click", () => {
      preferredFoundry = row.id;
      setMode("gig");
      gigForm?.scrollIntoView({ block: "nearest" });
      gigTitle?.focus();
    });
    actions.append(post);
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy note";
  copy.addEventListener("click", () => {
    void copyText(recordText(row.id, row.account), copy);
  });
  actions.append(copy);
  card.append(actions);
  return card;
}

function gigCard(row: GigRow): HTMLElement {
  const card = document.createElement("article");
  card.className = "record-card";
  const title = document.createElement("p");
  title.className = "record-name";
  title.textContent = row.title;
  const details = document.createElement("p");
  details.textContent = row.details;
  const offered = document.createElement("p");
  offered.className = "record-id";
  offered.textContent = `Offered by ${row.foundry}`;
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = freshGigId === row.id
    ? "Signed note. Not a chain job. Just saved. No payment was sent."
    : "Signed note. Not a chain job. No payment was sent.";
  card.append(title, details, offered, note);
  const when = savedOn(row.recordedAt);
  if (when) {
    const date = document.createElement("p");
    date.className = "hint";
    date.textContent = when;
    card.append(date);
  }
  const actions = document.createElement("div");
  actions.className = "record-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy note";
  copy.addEventListener("click", () => {
    void copyText(`Title: ${row.title}\nDetails: ${row.details}\nFoundry: ${row.foundry}\nNo payment was sent.`, copy);
  });
  actions.append(copy);
  card.append(actions);
  return card;
}

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  const previous = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select the note and copy it";
  }
  window.setTimeout(() => {
    button.textContent = previous;
  }, 1600);
}

function renderGig(): void {
  if (!gigSave || !gigFoundry) return;
  const owned = ownedFoundries();
  const selected = gigFoundry.value;
  const keep = preferredFoundry || selected || gigDraft.foundry;
  gigFoundry.replaceChildren();
  for (const row of owned) {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = `${row.name} — ${row.id}`;
    gigFoundry.append(option);
  }
  if (owned.some((row) => row.id === keep)) gigFoundry.value = keep;
  else if (owned[0] && recordsState === "ready") gigFoundry.value = owned[0].id;
  if (gigFoundry.value) preferredFoundry = gigFoundry.value;
  const label = gigSaveLabel({
    connected: walletLive,
    title: gigDraft.title,
    details: gigDraft.details,
    ownedCount: owned.length,
    foundryId: gigFoundry.value,
    signing: gigSigning,
    loading: walletLive && accountView === "present" && recordsState !== "ready" && recordsState !== "error",
  });
  gigSave.textContent = label;
  gigSave.disabled = gigSigning || !gigSaveEnabled(label);
  if (gigTitle && document.activeElement !== gigTitle) gigTitle.value = gigDraft.title;
  if (gigDetails && document.activeElement !== gigDetails) gigDetails.value = gigDraft.details;
  if (gigStatus && !gigSigning) {
    if (!notice && !gigStatus.dataset.sticky) gigStatus.textContent = "";
  }
}

function setMode(next: "foundry" | "gig"): void {
  if (signing || gigSigning || state.phase === "holding") return;
  mode = next;
  if (next === "gig") notice = notice?.kind === "gig-saved" ? notice : null;
  renderUi();
  if (next === "gig") gigTitle?.focus();
  else focusStep(state.active);
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
    if (next) {
      const ready = state.active === step && continuation(state) !== null;
      next.setAttribute("aria-disabled", ready ? "false" : "true");
    }
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
  holdBtn.disabled = mode === "gig" || rehearsed || (!holding && !armed);
  holdBtn.classList.toggle("is-hot", holding);
  holdBtn.classList.toggle("is-done", rehearsed);
  if (signing) holdLabel.textContent = "Confirm in the wallet";
  else if (holding || rehearsed || armed) holdLabel.textContent = holdCue(state);
  else if (canHold(state) && accountView !== "present") holdLabel.textContent = "Account, then hold";
  else if (canHold(state) && idAlreadySaved()) holdLabel.textContent = "Foundry, then hold";
  else if (canHold(state) && foundryId().length === 0) holdLabel.textContent = "Foundry, then hold";
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
    disconnectBtn.disabled = holding || connecting || signing || gigSigning;
  }
  if (navAccount) {
    navAccount.hidden = !walletLive || !hasAccount;
    navAccount.textContent = hasAccount ? state.values.account.trim() : "";
  }
  if (navDisconnect) {
    navDisconnect.hidden = !walletLive;
    navDisconnect.disabled = holding || connecting || signing || gigSigning;
  }
  if (checkBtn) {
    checkBtn.hidden = !hasAccount || accountView === "present" || accountView === "idle";
    checkBtn.disabled = holding || connecting;
  }

  const savedOnBoard = walletLive && accountView === "present" && (foundryRows.length > 0 || gigRows.length > 0);
  stageEl?.classList.toggle("has-records", savedOnBoard);
  field.setAgentLabel(drawingLabel(state.values.name, savedOnBoard ? (foundryRows.length || gigRows.length) : 0));
  field.setSteps({
    name: stepMark("name"),
    account: stepMark("account"),
    foundry: stepMark("foundry"),
    job: stepMark("job"),
  });
  if (fieldState) {
    if (signing || gigSigning) fieldState.textContent = "Confirm in the wallet";
    else fieldState.textContent = fieldStatus(state);
    fieldState.classList.toggle("is-locked", rehearsed || signing || gigSigning);
  }
  if (railNote) {
    if (signing) {
      railNote.textContent = "Confirm the foundry in the wallet.";
    } else if (!holding && !rehearsed && canHold(state) && accountView === "absent") {
      railNote.textContent = "That account is not on testnet yet.";
    } else if (!holding && !rehearsed && canHold(state) && accountView !== "present") {
      railNote.textContent = "The account check did not answer.";
    } else if (!holding && !rehearsed && idAlreadySaved()) {
      railNote.textContent = "You already saved this id. Type a different one.";
    } else if (!holding && !rehearsed && canHold(state) && foundryId().length === 0) {
      railNote.textContent = "Use a letter first, then letters or numbers.";
    } else {
      railNote.textContent = railStatus(state, reduced());
    }
  }
  if (foundryShell) {
    const typed = state.values.foundry.trim();
    const id = foundryId();
    if (!typed) foundryShell.textContent = "";
    else if (!id) foundryShell.textContent = "Use a letter first, then letters or numbers.";
    else foundryShell.textContent = `Saves as ${id}.`;
  }
  const gigMode = mode === "gig";
  rail?.classList.toggle("is-gig", gigMode);
  if (foundrySteps) foundrySteps.hidden = gigMode;
  if (gigForm) gigForm.hidden = !gigMode;
  if (modeFoundryBtn) {
    modeFoundryBtn.setAttribute("aria-pressed", gigMode ? "false" : "true");
    modeFoundryBtn.disabled = holding || signing || gigSigning;
  }
  if (modeGigBtn) {
    modeGigBtn.setAttribute("aria-pressed", gigMode ? "true" : "false");
    modeGigBtn.disabled = holding || signing || gigSigning;
  }
  if (railTitle) railTitle.textContent = gigMode ? "New gig" : "New foundry";
  if (fieldCaption) {
    if (gigMode) {
      fieldCaption.textContent = "The drawing is the foundry. A gig is a note beside it. Saved gigs are listed on this board.";
    } else if (savedOnBoard && state.values.name.trim().length === 0) {
      fieldCaption.textContent = "This drawing is the new foundry. Saved foundries and gigs are listed here.";
    } else {
      fieldCaption.textContent = "The drawing fills in as you complete each step.";
    }
  }
  if (ctaTitle) ctaTitle.textContent = walletLive ? "Ready to record another?" : "Ready to record a foundry?";
  renderDeploy();
  renderGig();
  syncRecords();
  renderRecords();
  saveGigDraft(gigDraft, localStorage);
  saveFlow({ state, recorded: null }, localStorage);
}

function advanceAccountIfReady(): void {
  if (state.active === "account" && accountView === "present" && canFinish(state)) {
    state = finish(state);
  }
}

function commitField(): void {
  const input = document.querySelector<HTMLInputElement>(`[data-step="${state.active}"] input`);
  if (!input || input.dataset.field !== state.active) return;
  if (input.value === state.values[state.active]) return;
  state = setValue(state, state.active, input.value);
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

function continueDeck(): void {
  commitField();
  const move = continuation(state);
  if (move === "finish") {
    tryFinish();
    return;
  }
  if (!move) {
    if (state.active === "account") focusStep("account");
    return;
  }
  state = selectStep(state, move);
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
  if (step !== state.active && step === nextStep(state)) {
    commitField();
    const move = continuation(state);
    if (move === "finish" || move === step) {
      continueDeck();
      return;
    }
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
  if (signing || state.phase !== "rehearsed") return;
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
  notice = null;
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
      const message = typeof body.error === "string" ? body.error : "The foundry was not saved. Your wallet is still connected.";
      deployError = message;
      if (message === "That foundry id is already recorded.") state = selectStep(state, "foundry");
      return;
    }
    freshFoundryId = body.record.id;
    notice = {
      kind: "foundry-saved",
      id: body.record.id,
      account: body.record.account,
      text: recordText(body.record.id, body.record.account),
    };
    foundryRows = [{
      id: body.record.id,
      name: fields.name,
      account: body.record.account,
      job: fields.job,
      listing: "pending",
      recordedAt: new Date().toISOString(),
    }, ...foundryRows.filter((row) => row.id !== body.record?.id)];
    state = anotherRound(state);
    recordsFor = "";
    deployError = "";
  } catch (error) {
    deployError = signFailure(error, "The wallet did not sign. Nothing was saved.");
  } finally {
    signing = false;
    renderUi();
    if (deployError === "That foundry id is already recorded.") focusStep("foundry");
    else if (!deployError && state.active === "name") focusStep("name");
  }
}

async function saveGig(): Promise<void> {
  if (gigSigning || signing || !gigSave) return;
  const account = state.values.account.trim();
  const title = gigDraft.title.trim();
  const details = gigDraft.details.trim();
  const foundry = gigFoundry?.value || "";
  const owner = ownedFoundries().find((row) => row.id === foundry)?.account ?? "";
  if (!showGigControl(owner, account) || !title || !details) return;
  const id = gigPublicId({ title, details, foundry, account });
  if (!id) return;
  gigSigning = true;
  notice = null;
  if (gigStatus) {
    gigStatus.dataset.sticky = "1";
    gigStatus.textContent = "Confirm the gig in the wallet.";
  }
  renderUi();
  try {
    const signed = await wallets.sign(gigMessage({ title, details, foundry, account, id }), account);
    const response = await fetch("/api/gig", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        details,
        foundry,
        account,
        publicKey: signed.publicKey,
        signature: signed.signature,
        nonce: signed.nonce,
        callbackUrl: window.location.href,
      }),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; record?: { id: string; foundry: string; title: string } };
    if (!response.ok || !body.record) {
      throw new Error(typeof body.error === "string" ? body.error : "The gig was not saved. Your wallet is still connected.");
    }
    freshGigId = body.record.id;
    notice = {
      kind: "gig-saved",
      title,
      foundry: body.record.foundry || foundry,
      text: `Title: ${title}\nDetails: ${details}\nFoundry: ${foundry}\nNo payment was sent.`,
    };
    gigRows = [{
      id: body.record.id,
      title,
      details,
      foundry,
      account,
      recordedAt: new Date().toISOString(),
    }, ...gigRows.filter((row) => row.id !== body.record?.id)];
    gigDraft = { title: "", details: "", foundry };
    preferredFoundry = foundry;
    recordsFor = "";
    if (gigStatus) {
      delete gigStatus.dataset.sticky;
      gigStatus.textContent = "";
    }
  } catch (error) {
    const message = signFailure(error, "The wallet did not sign. The gig was not saved.");
    if (gigStatus) {
      gigStatus.dataset.sticky = "1";
      gigStatus.textContent = message;
    }
  } finally {
    gigSigning = false;
    renderUi();
  }
}

copyBtn?.addEventListener("click", () => {
  if (!notice || !copyBtn) return;
  void copyText(notice.text, copyBtn);
});

retryBtn?.addEventListener("click", () => {
  void recordFoundry();
});

noticeClose?.addEventListener("click", () => {
  notice = null;
  deployError = "";
  renderUi();
});

noticeGig?.addEventListener("click", () => {
  if (notice?.kind === "foundry-saved") preferredFoundry = notice.id;
  setMode("gig");
});

noticeAnother?.addEventListener("click", () => {
  notice = null;
  gigDraft = { title: "", details: "", foundry: preferredFoundry };
  setMode("gig");
  gigTitle?.focus();
});

modeFoundryBtn?.addEventListener("click", () => setMode("foundry"));
modeGigBtn?.addEventListener("click", () => setMode("gig"));
document.querySelector("#nav-new")?.addEventListener("click", () => setMode("foundry"));
document.querySelector("#cta-go")?.addEventListener("click", () => setMode("foundry"));
navDisconnect?.addEventListener("click", () => disconnectBtn?.click());

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-records-retry]")) {
  button.addEventListener("click", () => {
    recordsFor = "";
    recordsState = "idle";
    renderUi();
  });
}

function rememberGigDraft(): void {
  gigDraft = {
    title: gigTitle?.value ?? "",
    details: gigDetails?.value ?? "",
    foundry: gigFoundry?.value || preferredFoundry,
  };
  if (gigDraft.foundry) preferredFoundry = gigDraft.foundry;
  if (gigStatus) delete gigStatus.dataset.sticky;
  renderUi();
}

gigTitle?.addEventListener("input", rememberGigDraft);
gigDetails?.addEventListener("input", rememberGigDraft);
gigFoundry?.addEventListener("change", rememberGigDraft);
gigForm?.addEventListener("submit", (event) => event.preventDefault());

gigSave?.addEventListener("click", () => {
  const label = gigSave.textContent || "";
  if (label === "Connect a wallet") {
    connectBtn?.click();
    return;
  }
  if (label === "Save a foundry first") {
    setMode("foundry");
    return;
  }
  void saveGig();
});

document.querySelectorAll<HTMLAnchorElement>(".nav-menu a").forEach((link) => {
  link.addEventListener("click", () => {
    const menu = link.closest("details");
    if (menu) menu.open = false;
  });
});

document.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
  input.addEventListener("input", () => {
    if (!isStep(input.dataset.field)) return;
    state = setValue(state, input.dataset.field, input.value);
    if (state.phase === "edit") deployError = "";
    renderUi();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    continueDeck();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-next]").forEach((button) => {
  button.addEventListener("click", () => {
    const step = button.closest<HTMLElement>("[data-step]")?.dataset.step;
    if (step !== state.active) return;
    continueDeck();
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
  if (continuation(state)) {
    continueDeck();
    return;
  }
  if (!holdBtn.disabled) holdBtn.focus();
});

const saved = loadFlow(localStorage);
if (saved) {
  state = saved.state.phase === "rehearsed" && saved.recorded
    ? anotherRound(saved.state)
    : saved.state;
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
