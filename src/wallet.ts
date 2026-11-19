import { NearConnector, type Account, type NearWalletBase } from "@hot-labs/near-connect";
import { isTestnetAccount } from "./account.ts";
import { buildClaim, outcomeFailure } from "./jobs.ts";

export function createWalletSession(onAccount: (id: string | null) => void): {
  connect: () => Promise<string>;
  disconnect: () => Promise<void>;
  resume: () => Promise<string | null>;
  sign: (message: string, account: string) => Promise<{
    accountId: string;
    publicKey: string;
    signature: string;
    nonce: string;
  }>;
  claim: (account: string, jobId: number) => Promise<void>;
} {
  let connector: NearConnector | null = null;
  let wallet: NearWalletBase | null = null;
  let returned = "";

  const take = (accounts: Account[] | undefined): string => {
    const id = accounts?.[0]?.accountId ?? "";
    if (!isTestnetAccount(id)) return "";
    returned = id;
    onAccount(id);
    return id;
  };

  const ensure = (): NearConnector => {
    if (connector) return connector;
    connector = new NearConnector({
      network: "testnet",
      autoConnect: false,
      features: { testnet: true },
      providers: { testnet: ["https://rpc.testnet.near.org"] },
    });
    connector.on("wallet:signIn", (event) => {
      take(event.accounts);
    });
    connector.on("wallet:signOut", () => {
      wallet = null;
      returned = "";
      onAccount(null);
    });
    return connector;
  };

  return {
    async connect() {
      const current = ensure();
      await current.whenManifestLoaded;
      const connected = await current.connect();
      wallet = connected;
      const fromList = take(await connected.getAccounts());
      const id = fromList || returned;
      if (!isTestnetAccount(id)) {
        throw new Error("That wallet did not return a testnet account.");
      }
      onAccount(id);
      return id;
    },
    async resume() {
      try {
        const current = ensure();
        await current.whenManifestLoaded;
        const connected = await current.getConnectedWallet();
        wallet = connected.wallet;
        const id = take(connected.accounts);
        if (!isTestnetAccount(id)) {
          wallet = null;
          return null;
        }
        return id;
      } catch {
        return null;
      }
    },
    async disconnect() {
      const current = wallet;
      wallet = null;
      returned = "";
      try {
        if (connector && current) await connector.disconnect(current);
      } finally {
        onAccount(null);
      }
    },
    async sign(message: string, account: string) {
      if (!wallet) throw new Error("Connect a wallet first.");
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const signed = await wallet.signMessage({
        message,
        recipient: "near-agents.0xray",
        nonce,
        signerId: account,
      });
      if (!isTestnetAccount(signed.accountId) || signed.accountId !== account) {
        throw new Error("That wallet did not return a testnet account.");
      }
      let binary = "";
      nonce.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return {
        accountId: signed.accountId,
        publicKey: signed.publicKey,
        signature: signed.signature,
        nonce: btoa(binary),
      };
    },
    async claim(account: string, jobId: number) {
      if (!wallet) throw new Error("Connect a wallet first.");
      if (!isTestnetAccount(account) || !account.endsWith(".testnet")) {
        throw new Error("That wallet did not return a testnet account.");
      }
      const claim = buildClaim(jobId);
      const outcome = await wallet.signAndSendTransaction({
        signerId: account,
        receiverId: claim.receiverId,
        actions: [claim.action],
      });
      const failure = outcomeFailure(outcome);
      if (failure) throw new Error(failure);
    },
  };
}
