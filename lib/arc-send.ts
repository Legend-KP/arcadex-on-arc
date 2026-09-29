/**
 * Shared Arc wallet writes — EIP-6963 provider, preflight getCode/eth_call,
 * explicit gas, native (18-dec) gas balance check, RPC receipt confirmation.
 */

import {
  createWalletClient,
  custom,
  encodeFunctionData,
  formatEther,
  getAddress,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
  type WalletClient,
} from "viem";
import {
  ARC_CHAIN_ID,
  ARC_MIN_MAX_FEE_PER_GAS_WEI,
  arcChain,
} from "@/lib/arc-chain";
import {
  formatChainError,
  getArcMaxFeePerGas,
  getArcPublicClient,
  getArcNativeBalance,
} from "@/lib/arc-public-client";
import {
  ensureArcChain,
  getPreferredInjectedProvider,
  setActiveProvider,
  type InjectedProvider,
} from "@/lib/arc-wallet";

const ARC_PRIORITY_FEE_WEI = BigInt(1_000_000_000);

/** Minimum native USDC (18 decimals) kept for gas — ~$0.02 at typical fees. */
export const ARC_MIN_NATIVE_GAS_WEI = BigInt(20_000_000_000_000_000); // 0.02 USDC

/** Safe default gas when estimate fails (contract call). */
export const ARC_DEFAULT_CALL_GAS = BigInt(350_000);

/** Safe default gas for ERC-20 transfer. */
export const ARC_DEFAULT_TRANSFER_GAS = BigInt(120_000);

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

function createWalletClientFromProvider(
  provider: InjectedProvider
): WalletClient {
  return createWalletClient({
    chain: arcChain,
    transport: custom(provider as EIP1193Provider),
  });
}

async function requireProviderAndArc(): Promise<{
  provider: InjectedProvider;
  walletClient: WalletClient;
  account: Address;
}> {
  const provider = getPreferredInjectedProvider();
  if (!provider?.request) {
    throw new Error(
      "Connect a wallet (Rainbow, MetaMask, Coinbase, Rabby, OKX, or Brave) to continue."
    );
  }

  setActiveProvider(provider);
  await ensureArcChain(provider);

  const chainId = (await provider.request({
    method: "eth_chainId",
  })) as string;
  const numeric = Number.parseInt(chainId, 16);
  if (numeric === 5042002) {
    throw new Error(
      "Your wallet is on Arc Testnet. Switch to Arc Mainnet (chain 5042)."
    );
  }
  if (numeric !== ARC_CHAIN_ID) {
    throw new Error(
      "Your wallet is not on Arc Mainnet (5042). Switch network, then try again."
    );
  }

  const walletClient = createWalletClientFromProvider(provider);

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
      throw new Error(
        "No wallet account available. Unlock your wallet and try again."
      );
    }
    accounts = [getAddress(requested[0])];
  }

  const account = getAddress(accounts[0]);
  await requireNativeGasForTx(account);

  return { provider, walletClient, account };
}

/** Native gas uses eth_getBalance (18 decimals). Never use ERC-20 6-dec math here. */
export async function requireNativeGasForTx(account: Address): Promise<void> {
  const balance = await getArcNativeBalance(account);
  if (balance >= ARC_MIN_NATIVE_GAS_WEI) return;

  const have = formatEther(balance);
  throw new Error(
    `Not enough native USDC for gas (need ~0.02, have ${have}). Fund Arc Mainnet gas, then try again.`
  );
}

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

async function preflightContractWrite(options: {
  account: Address;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  data: Hex;
}): Promise<bigint> {
  const client = getArcPublicClient();
  const code = await client.getBytecode({ address: options.address });
  if (!code || code === "0x") {
    throw new Error(
      `No contract at ${options.address} on Arc Mainnet (5042). Check deployment addresses — not testnet.`
    );
  }

  try {
    await client.simulateContract({
      account: options.account,
      address: options.address,
      abi: options.abi,
      functionName: options.functionName,
      args: options.args as never,
    });
  } catch (err) {
    throw new Error(
      formatChainError(err) ||
        "This transaction would fail on-chain (eth_call reverted). Check campaign/config and try again."
    );
  }

  try {
    const estimated = await client.estimateGas({
      account: options.account,
      to: options.address,
      data: options.data,
    });
    // 20% buffer
    return (estimated * BigInt(120)) / BigInt(100);
  } catch {
    return ARC_DEFAULT_CALL_GAS;
  }
}

/**
 * Encode + send a contract write through the connected Arc wallet.
 * Always attaches an explicit gas limit so wallets don't choke on estimate failure.
 */
export async function sendArcContractWrite(options: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  gas?: bigint;
  preferFeeFloor?: boolean;
}): Promise<{ txHash: Hash; account: Address }> {
  const { provider, walletClient, account } = await requireProviderAndArc();

  const to = getAddress(options.address);
  const data = encodeFunctionData({
    abi: options.abi,
    functionName: options.functionName,
    args: options.args as never,
  });

  const estimatedGas = await preflightContractWrite({
    account,
    address: to,
    abi: options.abi,
    functionName: options.functionName,
    args: options.args,
    data,
  });

  const gas =
    options.gas != null && options.gas > estimatedGas
      ? options.gas
      : estimatedGas;

  const networkFee = await getArcMaxFeePerGas().catch(
    () => ARC_MIN_MAX_FEE_PER_GAS_WEI
  );
  const maxFee =
    networkFee > ARC_MIN_MAX_FEE_PER_GAS_WEI
      ? networkFee
      : ARC_MIN_MAX_FEE_PER_GAS_WEI;
  const maxPriority =
    ARC_PRIORITY_FEE_WEI < maxFee ? ARC_PRIORITY_FEE_WEI : maxFee;

  const baseTx = {
    from: account,
    to,
    data,
    value: "0x0",
    gas: toRpcQuantity(gas),
  };

  // 1) Explicit gas only (wallet fills fees from its Arc RPC).
  try {
    const txHash = await sendRawTx(provider, baseTx);
    return { txHash, account };
  } catch (err) {
    rejectionOrContinue(err);
  }

  // 2) EIP-1559 with Arc ≥20 Gwei floor (no chainId/type/nonce).
  try {
    const txHash = await sendRawTx(provider, {
      ...baseTx,
      maxFeePerGas: toRpcQuantity(maxFee),
      maxPriorityFeePerGas: toRpcQuantity(maxPriority),
    });
    return { txHash, account };
  } catch (err) {
    rejectionOrContinue(err);
  }

  // 3) Minimal without gas — last wallet-compatible attempt.
  try {
    const txHash = await sendRawTx(provider, {
      from: account,
      to,
      data,
      value: "0x0",
    });
    return { txHash, account };
  } catch (err) {
    rejectionOrContinue(err);
  }

  // 4) viem writeContract with same provider + explicit gas + fee floor.
  try {
    const hash = await walletClient.writeContract({
      account,
      chain: null,
      address: to,
      abi: options.abi,
      functionName: options.functionName,
      args: options.args as never,
      gas,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: maxPriority,
    });
    return { txHash: hash, account };
  } catch (err) {
    rejectionOrContinue(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid parameters|invalid params|-32602/i.test(msg)) {
      throw new Error(
        "Your wallet rejected the transaction. Switch to Arc Mainnet (5042), unlock, and try again."
      );
    }
    throw err instanceof Error
      ? err
      : new Error("Transaction failed. Switch to Arc Mainnet and try again.");
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
    gas: options.gas ?? ARC_DEFAULT_TRANSFER_GAS,
    preferFeeFloor: true,
  });
}

export type { Hex };
