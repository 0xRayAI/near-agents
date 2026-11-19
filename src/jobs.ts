import { isTestnetAccount } from "./account.ts";

export const MAILBOX = "xraymail1119.testnet";
export const TESTNET_RPC = "https://rpc.testnet.near.org";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface MailJob {
  id: number;
  buyer: string;
  brief: string;
  status: string;
  amount: string;
  escrow_id: number | null;
  expiresAt: string;
}

export function claimWindowOpen(expiresAt: string, nowNs: bigint): boolean {
  if (!/^\d+$/.test(expiresAt)) return false;
  try {
    return BigInt(expiresAt) >= nowNs;
  } catch {
    return false;
  }
}

export function usdcLabel(amount: string): string {
  if (!/^\d+$/.test(amount)) return "";
  const digits = amount.replace(/^0+/, "") || "0";
  if (digits === "0") return "0";
  const whole = digits.length > 6 ? digits.slice(0, -6) : "0";
  const frac = (digits.length > 6 ? digits.slice(-6) : digits.padStart(6, "0")).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < bytes.length ? bytes[i + 1] ?? 0 : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] ?? 0 : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64[(triple >> 18) & 63];
    out += B64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[triple & 63] : "=";
  }
  return out;
}

function mailboxOrThrow(mailbox: string): void {
  if (!mailbox.endsWith(".testnet") || !isTestnetAccount(mailbox)) {
    throw new Error("The mailbox is not a testnet account.");
  }
}

export function buildJobsQuery(mailbox: string): {
  jsonrpc: "2.0";
  id: "jobs";
  method: "query";
  params: {
    request_type: "call_function";
    finality: "final";
    account_id: string;
    method_name: "get_jobs";
    args_base64: string;
  };
} {
  mailboxOrThrow(mailbox);
  const args = JSON.stringify({ status: null, from: 0, limit: 20 });
  return {
    jsonrpc: "2.0",
    id: "jobs",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: mailbox,
      method_name: "get_jobs",
      args_base64: bytesToBase64(new TextEncoder().encode(args)),
    },
  };
}

function integerAmount(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function asJob(item: unknown): MailJob | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const amount = integerAmount(row.amount);
  if (typeof row.id !== "number" || !Number.isInteger(row.id)) return null;
  if (typeof row.brief !== "string" || typeof row.status !== "string" || !amount) return null;
  return {
    id: row.id,
    buyer: typeof row.buyer === "string" ? row.buyer : "",
    brief: row.brief,
    status: row.status,
    amount,
    escrow_id: typeof row.escrow_id === "number" && Number.isInteger(row.escrow_id) ? row.escrow_id : null,
    expiresAt: typeof row.expires_at === "string" && /^\d+$/.test(row.expires_at) ? row.expires_at : "",
  };
}

export function parseJobBytes(bytes: ArrayLike<number>): MailJob[] {
  const text = new TextDecoder().decode(Uint8Array.from(bytes));
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("The job list was not readable.");
  const jobs: MailJob[] = [];
  for (const item of parsed) {
    const job = asJob(item);
    if (job) jobs.push(job);
  }
  return jobs;
}

export function parseJobsPayload(payload: unknown): MailJob[] {
  if (!payload || typeof payload !== "object") throw new Error("The job list was not readable.");
  const result = (payload as { result?: { result?: unknown } }).result?.result;
  if (!Array.isArray(result) || result.some((byte) => typeof byte !== "number")) {
    throw new Error("The job list was not readable.");
  }
  return parseJobBytes(result);
}

export async function readMailboxJobs(
  mailbox: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MailJob[]> {
  const request = buildJobsQuery(mailbox);
  let response: Response;
  try {
    response = await fetchImpl(TESTNET_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error("The job list did not answer.");
  }
  if (!response.ok) throw new Error("The job list did not answer.");
  try {
    return parseJobsPayload(await response.json());
  } catch (error) {
    if (error instanceof Error && error.message === "The job list was not readable.") throw error;
    throw new Error("The job list did not answer.");
  }
}

export function buildClaim(jobId: number): {
  receiverId: string;
  action: {
    type: "FunctionCall";
    params: {
      methodName: "claim_job";
      args: { id: number };
      gas: "30000000000000";
      deposit: "0";
    };
  };
} {
  if (!Number.isInteger(jobId) || jobId < 0) throw new Error("That job is not posted.");
  return {
    receiverId: MAILBOX,
    action: {
      type: "FunctionCall",
      params: {
        methodName: "claim_job",
        args: { id: jobId },
        gas: "30000000000000",
        deposit: "0",
      },
    },
  };
}

export function outcomeFailure(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== "object") return null;
  const status = (outcome as { status?: unknown }).status;
  if (!status || typeof status !== "object" || !("Failure" in status)) return null;
  const failure = (status as { Failure?: unknown }).Failure;
  if (typeof failure === "string") return failure;
  try {
    return JSON.stringify(failure);
  } catch {
    return "The claim was not sent.";
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

export function mentionsOnlyFoundry(message: string): boolean {
  if (/only the foundry/i.test(message)) return true;
  const words = message.toLowerCase().match(/[a-z]+/g) ?? [];
  const rest = words.filter((word) => !["the", "only", "a", "an", "this", "that"].includes(word));
  return rest.length > 0 && rest.every((word) => word === "foundry");
}

export function publicClaimError(error: unknown): string {
  const raw = errorText(error);
  if (mentionsOnlyFoundry(raw)) return "This account cannot claim that job.";
  if (/job has expired/i.test(raw)) return "The claim window has passed.";
  if (!raw || raw.length > 160) return "The claim was not sent.";
  if (/ed25519:|seed|private|secret/i.test(raw)) return "The claim was not sent.";
  if (/[0-9a-f]{32,}/i.test(raw)) return "The claim was not sent.";
  return raw;
}
