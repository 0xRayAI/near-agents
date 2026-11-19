import { isTestnetAccount } from "./account.ts";

export type AccountView = "idle" | "present" | "absent" | "unknown";

const SAFE_ID = /^[a-z][a-z0-9-]{1,30}$/;

export function shellId(value: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (!SAFE_ID.test(id)) return "";
  return id;
}

export function nearFromYocto(amount: string): string {
  if (!/^\d+$/.test(amount)) return "";
  const padded = amount.padStart(25, "0");
  const whole = padded.slice(0, -24).replace(/^0+/, "") || "0";
  const frac = padded.slice(-24).slice(0, 4).replace(/0+$/, "");
  const shown = frac ? `${whole}.${frac}` : whole;
  if (amount !== "0" && shown === "0") return "under 0.0001";
  return shown;
}

interface RpcBody {
  result?: { amount?: unknown };
  error?: { cause?: { name?: unknown } };
}

export async function readTestnetAccount(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ view: AccountView; near: string }> {
  if (!isTestnetAccount(id)) return { view: "unknown", near: "" };
  try {
    const response = await fetchImpl("https://rpc.testnet.near.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "account",
        method: "query",
        params: {
          request_type: "view_account",
          finality: "final",
          account_id: id,
        },
      }),
    });
    if (!response.ok) return { view: "unknown", near: "" };
    const body = (await response.json()) as RpcBody;
    const amount = body.result?.amount;
    if (typeof amount === "string" && /^\d+$/.test(amount)) {
      return { view: "present", near: nearFromYocto(amount) };
    }
    if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return { view: "absent", near: "" };
    return { view: "unknown", near: "" };
  } catch {
    return { view: "unknown", near: "" };
  }
}
