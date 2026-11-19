const IMPLICIT = /^[0-9a-f]{64}$/;
const PART = /^[a-z\d]+(?:[-_][a-z\d]+)*$/;

export function publicWalletError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (!raw || raw.length > 160) return "The wallet did not connect.";
  if (/ed25519:|seed|private|secret/i.test(raw)) return "The wallet did not connect.";
  if (/[0-9a-f]{32,}/i.test(raw)) return "The wallet did not connect.";
  return raw;
}

/** A testnet named account, or a 64-hex implicit account from the testnet connector. */
export function isTestnetAccount(id: string): boolean {
  if (id.length < 2 || id.length > 64) return false;
  if (id.endsWith(".near")) return false;
  if (IMPLICIT.test(id)) return true;
  if (!id.endsWith(".testnet")) return false;
  return id.split(".").every((part) => part.length >= 2 && PART.test(part));
}
