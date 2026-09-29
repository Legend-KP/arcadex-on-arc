import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  toHex,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import {
  ARC_CHAIN_ID,
  ARC_MIN_MAX_FEE_PER_GAS_WEI,
  arcChain,
} from "@/lib/arc-chain";
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
 * Fully-prepared eth_sendTransaction — wallet only signs/sends.
 * Gas is native USDC on Arc; CIP-64 feeCurrency is not used.
 * maxFeePerGas is floored at 20 Gwei (Arc mempool drop threshold).
 *
 * Do NOT pre-fill nonce — MetaMask often returns
 * "Invalid parameters were provided to the RPC method" when dapps supply it.
 */
async function sendViaInjectedProvider(options: {
  account: Address;
  tokenAddr: Address;
  data: `0x${string}`;
  maxFeePerGas: bigint;
}): Promise<Hash> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("Connect a wallet to continue.");
  }

  const maxFee =
    options.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS_WEI
      ? options.maxFeePerGas
      : ARC_MIN_MAX_FEE_PER_GAS_WEI;
  const maxPriority =
    ARC_PRIORITY_FEE_WEI < maxFee ? ARC_PRIORITY_FEE_WEI : maxFee;

  const tx = {
    from: options.account,
    to: options.tokenAddr,
    data: options.data,
    value: "0x0",
    chainId: toHex(ARC_CHAIN_ID),
    type: "0x2",
    gas: toHex(TRANSFER_GAS_LIMIT),
    maxFeePerGas: toHex(maxFee),
    maxPriorityFeePerGas: toHex(maxPriority),
  };

  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [tx as never],
  });

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error("Wallet did not return a transaction hash.");
  }

  return txHash as Hash;
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

  const [rawAccount] = await walletClient.getAddresses();
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
  const tokenAddr = ARC_USDC_TOKEN_ADDRESS;
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
      note: "Arc USDC-only; wallet fills nonce",
    });
  }

  let payHash: Hash;
  let providerError: unknown;

  try {
    payHash = await sendViaInjectedProvider({
      account,
      tokenAddr,
      data,
      maxFeePerGas,
    });
  } catch (error) {
    providerError = error;
    logRawError("eth_sendTransaction", error);
    if (isUserRejection(error)) {
      throw new Error("Payment cancelled in wallet.");
    }

    // Retry once with a leaner payload (no type/chainId) — some wallets reject extras.
    try {
      const provider = getInjectedProvider();
      if (!provider) throw error;
      const maxFee =
        maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS_WEI
          ? maxFeePerGas
          : ARC_MIN_MAX_FEE_PER_GAS_WEI;
      const maxPriority =
        ARC_PRIORITY_FEE_WEI < maxFee ? ARC_PRIORITY_FEE_WEI : maxFee;
      const leanHash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: tokenAddr,
            data,
            value: "0x0",
            gas: toHex(TRANSFER_GAS_LIMIT),
            maxFeePerGas: toHex(maxFee),
            maxPriorityFeePerGas: toHex(maxPriority),
          } as never,
        ],
      });
      if (typeof leanHash !== "string" || !leanHash.startsWith("0x")) {
        throw new Error("Wallet did not return a transaction hash.");
      }
      payHash = leanHash as Hash;
    } catch (leanError) {
      logRawError("eth_sendTransaction_lean", leanError);
      if (isUserRejection(leanError)) {
        throw new Error("Payment cancelled in wallet.");
      }

      try {
        const feeCap =
          maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS_WEI
            ? maxFeePerGas
            : ARC_MIN_MAX_FEE_PER_GAS_WEI;
        const tip =
          ARC_PRIORITY_FEE_WEI < feeCap ? ARC_PRIORITY_FEE_WEI : feeCap;
        payHash = await walletClient.writeContract({
          account,
          chain: arcChain,
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [recipient, fee],
          gas: TRANSFER_GAS_LIMIT,
          maxFeePerGas: feeCap,
          maxPriorityFeePerGas: tip,
        });
      } catch (writeError) {
        logRawError("writeContract", writeError);
        throw toFriendlyError(
          writeError ?? leanError ?? providerError,
          `${failError} Wallet could not open the payment sheet.`,
          "writeContract"
        );
      }
    }
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
