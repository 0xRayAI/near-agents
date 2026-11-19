export function gigSaveLabel(input: {
  connected: boolean;
  title: string;
  details: string;
  ownedCount: number;
  foundryId: string;
  signing: boolean;
  loading?: boolean;
  loadError?: boolean;
}): string {
  if (input.signing) return "Confirm in the wallet";
  if (!input.connected) return "Connect a wallet";
  if (input.loading) return "Loading your records";
  if (input.loadError) return "Check again";
  if (input.title.trim().length === 0) return "Add a title";
  if (input.details.trim().length === 0) return "Add details";
  if (input.ownedCount === 0) return "Save a foundry first";
  if (input.foundryId.trim().length === 0) return "Choose a foundry";
  return "Sign and save gig";
}

export function gigSaveEnabled(label: string): boolean {
  return label === "Sign and save gig"
    || label === "Save a foundry first"
    || label === "Connect a wallet"
    || label === "Check again";
}

/** A gig control is only for a foundry this account recorded. */
export function showGigControl(ownerAccount: string, connectedAccount: string): boolean {
  return ownerAccount.length > 0 && ownerAccount === connectedAccount;
}
