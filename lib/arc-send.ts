/**
 * Shared Arc wallet writes for every product tx (check-in, play, pay, shuffle).
 * Uses the user-selected injected provider and a MetaMask/Rainbow-safe payload:
 * eth_sendTransaction with only { from, to, data, value } — no chainId/type/nonce/fees.
 * Wallets estimate gas on Arc themselves (must already be on chain 5042).
 */

import {
  encodeFunctionData,
  getAddress,
  type Abi,
  type Account,
  type Address,
  type Hash,
  type Hex,
  type WalletClient,
} from "viem";
import { ARC_CHAIN_ID, ARC_MIN_MAX_FEE_PER_GAS_WEI } from "@/lib/arc-chain";
import { getArcMaxFeePerGas } from "@/lib/arc-public-client";
import {
  ensureArcChain,
  getPreferredInjectedProvider,
  type InjectedProvider,
} from "@/lib/arc-wallet";
import { createInjectedWalletClient, getInjectedProvider } from "@/lib/wallet";

const ARC_PRIORITY_FEE_WEI = BigInt(1_000_000_000);

function toRpcQuantity(value: bigint): `0x${string}` {
  if (value === BigInt(0)) return "0x0";
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return `0x${hex}`;
}

function assertTxHash(txHash: unknown): Hash {
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]+$/.test(txHash)) {
    throw new Error("Wallet did not return a transaction hash.");
  }
  return txHash as Hash;
}

function isUserRejection(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code: unknown }).code)
      : null;
  return (
    code === 4001 ||
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

function rejectionOrContinue(error: unknown): void {
  if (isUserRejection(error)) {
    throw new Error("Transaction cancelled in wallet.");
  }
}

async function requireProviderAndArc(): Promise<{
  provider: InjectedProvider;
  walletClient: WalletClient;
  account: Address;
}> {
  const provider = getInjectedProvider() ?? getPreferredInjectedProvider();
  if (!provider?.request) {
    throw new Error(
      "Connect a wallet (Rainbow, MetaMask, Coinbase, Rabby, OKX, or Brave) to continue."
    );
  }

  await ensureArcChain(provider);

  const chainId = (await provider.request({
    method: "eth_chainId",
  })) as string;
  const onArc =
    chainId?.toLowerCase() === `0x${ARC_CHAIN_ID.toString(16)}`.toLowerCase();
  if (!onArc) {
    throw new Error(
      "Your wallet is not on Arc yet. Open your wallet, switch to Arc (chain 5042), then try again."
    );
  }

  const walletClient = createInjectedWalletClient();
  if (!walletClient) {
    throw new Error("Could not create a wallet connection. Refresh and try again.");
  }

  let accounts: readonly Address[] = [];
  try {
    accounts = await walletClient.requestAddresses();
  } catch {
    accounts = await walletClient.getAddresses();
  }
  if (!accounts[0]) {
    const requested = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[] | undefined;
    if (!requested?.[0]) {
      throw new Error("No wallet account available. Unlock your wallet and try again.");
    }
    accounts = [getAddress(requested[0])];
  }

  return {
    provider,
    walletClient,
    account: getAddress(accounts[0]),
  };
}

/** Switch to Arc + return the connected checksum address. */
export async function prepareArcWalletAccount(): Promise<Address> {
  const { account } = await requireProviderAndArc();
  return account;
}

async function sendRawTx(
  provider: InjectedProvider,
  tx: Record<string, string>
): Promise<Hash> {
  return assertTxHash(
    await provider.request({
      method: "eth_sendTransaction",
      params: [tx as never],
    })
  );
}

/**
 * Encode + send a contract write through the connected Arc wallet.
 * Returns tx hash (caller waits for receipt / syncs with API as needed).
 */
export async function sendArcContractWrite(options: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  /** Optional gas limit (hex quantity). Prefer omit for wallet estimate. */
  gas?: bigint;
  /** When true, attach Arc EIP-1559 floor fees (only after minimal send fails). */
  preferFeeFloor?: boolean;
}): Promise<{ txHash: Hash; account: Address }> {
  const { provider, walletClient, account } = await requireProviderAndArc();

  const to = getAddress(options.address);
  const data = encodeFunctionData({
    abi: options.abi,
    functionName: options.functionName,
    args: options.args as never,
  });

  const baseTx = {
    from: account,
    to,
    data,
    value: "0x0",
  };

  // 1) Minimal — works on Rainbow / MetaMask / Coinbase when already on Arc.
  try {
    const txHash = await sendRawTx(provider, baseTx);
    return { txHash, account };
  } catch (err) {
    rejectionOrContinue(err);
  }

  // 2) Minimal + gas limit only.
  if (options.gas != null) {
    try {
      const txHash = await sendRawTx(provider, {
        ...baseTx,
        gas: toRpcQuantity(options.gas),
      });
      return { txHash, account };
    } catch (err) {
      rejectionOrContinue(err);
    }
  }

  // 3) EIP-1559 with Arc 20 Gwei floor (no chainId / type / nonce).
  try {
    const networkFee = await getArcMaxFeePerGas().catch(
      () => ARC_MIN_MAX_FEE_PER_GAS_WEI
    );
    const maxFee =
      networkFee > ARC_MIN_MAX_FEE_PER_GAS_WEI
        ? networkFee
        : ARC_MIN_MAX_FEE_PER_GAS_WEI;
    const maxPriority =
      ARC_PRIORITY_FEE_WEI < maxFee ? ARC_PRIORITY_FEE_WEI : maxFee;
    const feeTx: Record<string, string> = {
      ...baseTx,
      maxFeePerGas: toRpcQuantity(maxFee),
      maxPriorityFeePerGas: toRpcQuantity(maxPriority),
    };
    if (options.gas != null) {
      feeTx.gas = toRpcQuantity(options.gas);
    }
    const txHash = await sendRawTx(provider, feeTx);
    return { txHash, account };
  } catch (err) {
    rejectionOrContinue(err);
  }

  // 4) Last resort — viem writeContract without fee overrides (wallet estimates).
  try {
    const hash = await walletClient.writeContract({
      account: account as Account,
      // Explicit null — avoids injecting chainId into wallet payloads (Rainbow/MM).
      chain: null,
      address: to,
      abi: options.abi,
      functionName: options.functionName,
      args: options.args as never,
      ...(options.gas != null ? { gas: options.gas } : {}),
    });
    return { txHash: hash, account };
  } catch (err) {
    rejectionOrContinue(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid parameters|invalid params|-32602/i.test(msg)) {
      throw new Error(
        "Your wallet rejected the transaction. Switch to Arc (chain 5042), unlock the wallet, and try again."
      );
    }
    throw err instanceof Error
      ? err
      : new Error("Transaction failed. Switch to Arc and try again.");
  }
}

export async function sendArcUsdcTransfer(options: {
  token: Address;
  to: Address;
  amount: bigint;
  gas?: bigint;
}): Promise<{ txHash: Hash; account: Address }> {
  const erc20TransferAbi = [
    {
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    },
  ] as const satisfies Abi;

  return sendArcContractWrite({
    address: options.token,
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [getAddress(options.to), options.amount],
    gas: options.gas,
    preferFeeFloor: true,
  });
}

export type { Hex };
