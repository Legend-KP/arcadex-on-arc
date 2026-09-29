import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import { ARC_MIN_MAX_FEE_PER_GAS_WEI, arcChain } from "@/lib/arc-chain";
import {
  formatChainError,
  getArcMaxFeePerGas,
  readArcContract,
  readArcContractValue,
  waitForArcTransactionReceipt,
} from "@/lib/arc-public-client";
import {
  createInjectedWalletClient,
  getInjectedProvider,
  prepareWalletForArcTx,
} from "@/lib/wallet";
import {
  ARC_USDC_TOKEN_ADDRESS,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";

/** Fixed gas limit for ERC-20 transfer into payment contracts. */
const TRANSFER_GAS_LIMIT = BigInt(120_000);

/** Small EIP-1559 tip — Arc accepts 0; 1 Gwei improves inclusion. */
const ARC_PRIORITY_FEE_WEI = BigInt(1_000_000_000);

/** Set true only while diagnosing payment failures. */
const DEBUG_PAYMENTS = false;

/**
 * MetaMask QUANTITY padding — even hex digit count avoids -32602 on some builds.
 */
function toRpcQuantity(value: bigint): `0x${string}` {
  if (value === BigInt(0)) return "0x0";
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return `0x${hex}`;
}

function assertTxHash(txHash: unknown): Hash {
  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error("Wallet did not return a transaction hash.");
  }
  return txHash as Hash;
}

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return readArcContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

async function requireUsdcBalance(
  account: Address,
  fee: bigint
): Promise<SparkRefillPaymentToken> {
  const usdcBalance = await readBalance(ARC_USDC_TOKEN_ADDRESS, account);

  if (usdcBalance >= fee) return "USDC";

  const needed = formatUnits(fee, STABLECOIN_DECIMALS);
  throw new Error(`Insufficient USDC balance. You need $${needed} USDC.`);
}

type ViemLikeError = {
  message?: string;
  shortMessage?: string;
  details?: string;
  metaMessages?: string[];
  cause?: unknown;
  code?: string | number;
  name?: string;
  walk?: (fn?: (err: unknown) => boolean) => unknown;
};

function asViemError(error: unknown): ViemLikeError | null {
  if (typeof error === "object" && error !== null) {
    return error as ViemLikeError;
  }
  return null;
}

function getRootCause(error: unknown): unknown {
  const viemErr = asViemError(error);
  if (typeof viemErr?.walk === "function") {
    try {
      return viemErr.walk();
    } catch {
      /* fall through */
    }
  }

  let cause: unknown = error;
  let depth = 0;
  while (
    cause &&
    typeof cause === "object" &&
    "cause" in cause &&
    (cause as ViemLikeError).cause &&
    depth < 10
  ) {
    cause = (cause as ViemLikeError).cause;
    depth += 1;
  }
  return cause;
}

function serializeRawError(error: unknown): string {
  try {
    if (error instanceof Error) {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    }
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function summarizeRawError(error: unknown): string {
  const top = asViemError(error);
  const root = getRootCause(error);
  const rootObj = asViemError(root);

  const parts = [
    top?.shortMessage && `short:${top.shortMessage}`,
    top?.details && `details:${top.details}`,
    top?.metaMessages?.length && `meta:${top.metaMessages.join(";")}`,
    top?.code != null && `code:${top.code}`,
    rootObj?.message && `root:${rootObj.message}`,
    rootObj?.shortMessage && `rootShort:${rootObj.shortMessage}`,
    rootObj?.details && `rootDetails:${rootObj.details}`,
    rootObj?.code != null && `rootCode:${rootObj.code}`,
    rootObj?.name && `rootName:${rootObj.name}`,
  ].filter(Boolean) as string[];

  if (parts.length === 0) {
    const fallback = formatChainError(error) || serializeRawError(error);
    return fallback.length > 320 ? `${fallback.slice(0, 317)}...` : fallback;
  }

  const combined = parts.join(" | ");
  return combined.length > 360 ? `${combined.slice(0, 357)}...` : combined;
}

function logRawError(stage: string, error: unknown): void {
  if (!DEBUG_PAYMENTS) return;

  const top = asViemError(error);
  const root = getRootCause(error);
  const rootObj = asViemError(root);

  console.error(`[pay:${stage}] message:`, top?.message ?? String(error));
  console.error(`[pay:${stage}] shortMessage:`, top?.shortMessage);
  console.error(`[pay:${stage}] details:`, top?.details);
  console.error(`[pay:${stage}] metaMessages:`, top?.metaMessages);
  console.error(`[pay:${stage}] code:`, top?.code);
  console.error(
    `[pay:${stage}] walked:`,
    typeof top?.walk === "function" ? top.walk() : null
  );
  console.error(`[pay:${stage}] root cause:`, root);
  console.error(`[pay:${stage}] root cause message:`, rootObj?.message);
  console.error(`[pay:${stage}] root shortMessage:`, rootObj?.shortMessage);
  console.error(`[pay:${stage}] root details:`, rootObj?.details);
  console.error(`[pay:${stage}] RAW ERROR JSON:`, serializeRawError(error));
  console.error(`[pay:${stage}] ROOT JSON:`, serializeRawError(root));
}

function toFriendlyError(
  error: unknown,
  fallback: string,
  stage?: string
): Error {
  if (isUserRejection(error)) {
    return new Error("Payment cancelled in wallet.");
  }

  if (DEBUG_PAYMENTS) {
    const label = stage ? `[${stage}] ` : "";
    return new Error(`${label}${summarizeRawError(error) || fallback}`);
  }

  const formatted = formatChainError(error);
  if (
    formatted &&
    formatted !== "Something went wrong. Please try again." &&
    !formatted.toLowerCase().includes("unknown rpc error")
  ) {
    return new Error(formatted);
  }

  if (error instanceof Error && error.message.trim()) {
    const cleaned = error.message
      .split("\n")[0]
      ?.replace(/\s*Version: viem.*$/i, "")
      .trim();
    if (cleaned && cleaned.length <= 160) return new Error(cleaned);
  }

  return new Error(fallback);
}

function isUserRejection(error: unknown): boolean {
  const message = formatChainError(error).toLowerCase();
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code: unknown }).code)
      : null;

  return (
    code === 4001 ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request")
  );
}

async function runStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logRawError(stage, error);
    throw toFriendlyError(error, `Payment failed during ${stage}.`, stage);
  }
}

/**
 * Send USDC transfer via the injected wallet.
 * Prefer viem writeContract; fall back to a MetaMask-safe eth_sendTransaction
 * (no chainId/type/nonce — those trigger "Invalid parameters" on many builds).
 */
async function sendUsdcTransfer(options: {
  walletClient: NonNullable<ReturnType<typeof createInjectedWalletClient>>;
  account: Address;
  tokenAddr: Address;
  recipient: Address;
  fee: bigint;
  data: `0x${string}`;
  maxFeePerGas: bigint;
}): Promise<Hash> {
  const maxFee =
    options.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS_WEI
      ? options.maxFeePerGas
      : ARC_MIN_MAX_FEE_PER_GAS_WEI;
  const maxPriority =
    ARC_PRIORITY_FEE_WEI < maxFee ? ARC_PRIORITY_FEE_WEI : maxFee;

  try {
    const hash = await options.walletClient.writeContract({
      account: options.account,
      chain: arcChain,
      address: options.tokenAddr,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [options.recipient, options.fee],
      gas: TRANSFER_GAS_LIMIT,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: maxPriority,
    });
    return hash;
  } catch (writeError) {
    logRawError("writeContract", writeError);
    if (isUserRejection(writeError)) {
      throw new Error("Payment cancelled in wallet.");
    }
  }

  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("Connect a wallet to continue.");
  }

  // Attempt 1: absolute minimal — wallet fills gas/fees (must already be on Arc).
  try {
    return assertTxHash(
      await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: options.account,
            to: options.tokenAddr,
            data: options.data,
            value: "0x0",
          } as never,
        ],
      })
    );
  } catch (minimalError) {
    logRawError("eth_sendTransaction_minimal", minimalError);
    if (isUserRejection(minimalError)) {
      throw new Error("Payment cancelled in wallet.");
    }
  }

  // Attempt 2: EIP-1559 fees, no chainId/type/nonce.
  try {
    return assertTxHash(
      await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: options.account,
            to: options.tokenAddr,
            data: options.data,
            value: "0x0",
            gas: toRpcQuantity(TRANSFER_GAS_LIMIT),
            maxFeePerGas: toRpcQuantity(maxFee),
            maxPriorityFeePerGas: toRpcQuantity(maxPriority),
          } as never,
        ],
      })
    );
  } catch (feeError) {
    logRawError("eth_sendTransaction_fees", feeError);
    if (isUserRejection(feeError)) {
      throw new Error("Payment cancelled in wallet.");
    }
    throw toFriendlyError(
      feeError,
      "Payment failed. Switch MetaMask to Arc (5042) and try again.",
      "eth_sendTransaction"
    );
  }
}

/**
 * One wallet confirmation: ERC-20 USDC `transfer(fee)` into the payment contract.
 */
export async function purchaseStablecoinFeeOnChain(options: {
  contractAddress: Address;
  contractAbi: Abi;
  connectError: string;
  failError: string;
}): Promise<{ txHash: Hash; token: SparkRefillPaymentToken }> {
  const { contractAddress, contractAbi, connectError, failError } = options;

  const walletClient = createInjectedWalletClient();
  if (!walletClient) {
    throw new Error(connectError);
  }

  await prepareWalletForArcTx();

  const [rawAccount] = await walletClient.requestAddresses().catch(async () => {
    return walletClient.getAddresses();
  });
  if (!rawAccount) {
    throw new Error("No wallet account available.");
  }
  const account = getAddress(rawAccount);

  const paused = await runStage("paused", () =>
    readArcContractValue<boolean>({
      address: contractAddress,
      abi: contractAbi,
      functionName: "paused",
    })
  );
  if (paused) {
    throw new Error("Payments are paused. Please try again later.");
  }

  const fee = await runStage("fee", () =>
    readArcContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "fee",
    })
  );

  const token = await runStage("balance", () =>
    requireUsdcBalance(account, fee)
  );
  const tokenAddr = getAddress(ARC_USDC_TOKEN_ADDRESS);
  const recipient = getAddress(contractAddress);

  const maxFeePerGas = await runStage("gasPrice", () => getArcMaxFeePerGas());

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipient, fee],
  });

  if (DEBUG_PAYMENTS) {
    console.info("[pay:prepare]", {
      account,
      token,
      tokenAddr,
      recipient,
      fee: fee.toString(),
      gas: TRANSFER_GAS_LIMIT.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      note: "Arc USDC transfer; MetaMask-safe params",
    });
  }

  let payHash: Hash;
  try {
    payHash = await sendUsdcTransfer({
      walletClient,
      account,
      tokenAddr,
      recipient,
      fee,
      data,
      maxFeePerGas,
    });
  } catch (error) {
    throw toFriendlyError(
      error,
      `${failError} Switch to Arc in your wallet and try again.`,
      "send"
    );
  }

  const payReceipt = await runStage("receipt", () =>
    waitForArcTransactionReceipt(payHash)
  );

  if (payReceipt.status !== "success") {
    throw new Error(
      `${failError} The transfer was rejected on-chain. Keep a little extra USDC for network fees.`
    );
  }

  return { txHash: payHash, token };
}
