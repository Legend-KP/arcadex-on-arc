import {
  formatUnits,
  getAddress,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import {
  formatChainError,
  readArcContract,
  readArcContractValue,
  waitForArcTransactionReceipt,
} from "@/lib/arc-public-client";
import {
  prepareArcWalletAccount,
  sendArcUsdcTransfer,
} from "@/lib/arc-send";
import {
  ARC_USDC_TOKEN_ADDRESS,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";

/** Fixed gas limit for ERC-20 transfer into payment contracts. */
const TRANSFER_GAS_LIMIT = BigInt(120_000);

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

function toFriendlyError(error: unknown, fallback: string): Error {
  if (isUserRejection(error)) {
    return new Error("Payment cancelled in wallet.");
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
    if (cleaned && cleaned.length <= 180) return new Error(cleaned);
  }

  return new Error(fallback);
}

async function runStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toFriendlyError(error, `Payment failed during ${stage}.`);
  }
}

/**
 * One wallet confirmation: ERC-20 USDC `transfer(fee)` into the payment contract.
 * Uses the shared Arc send path (Rainbow, MetaMask, Coinbase, …).
 */
export async function purchaseStablecoinFeeOnChain(options: {
  contractAddress: Address;
  contractAbi: Abi;
  connectError: string;
  failError: string;
}): Promise<{ txHash: Hash; token: SparkRefillPaymentToken }> {
  const { contractAddress, contractAbi, connectError, failError } = options;

  if (!ARC_USDC_TOKEN_ADDRESS) {
    throw new Error(connectError);
  }

  let account: Address;
  try {
    account = await prepareArcWalletAccount();
  } catch (error) {
    throw toFriendlyError(error, connectError);
  }

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

  let payHash: Hash;
  try {
    const sent = await sendArcUsdcTransfer({
      token: getAddress(ARC_USDC_TOKEN_ADDRESS),
      to: getAddress(contractAddress),
      amount: fee,
      gas: TRANSFER_GAS_LIMIT,
    });
    payHash = sent.txHash;
  } catch (error) {
    throw toFriendlyError(
      error,
      `${failError} Switch your wallet to Arc (chain 5042) and try again.`
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
