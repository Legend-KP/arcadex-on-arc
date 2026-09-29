import {
  formatEther,
  formatUnits,
  getAddress,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import {
  formatChainError,
  getArcNativeBalance,
  readArcContract,
  readArcContractValue,
  waitForArcTransactionReceipt,
} from "@/lib/arc-public-client";
import {
  ARC_DEFAULT_TRANSFER_GAS,
  ARC_MIN_NATIVE_GAS_WEI,
  prepareArcWalletAccount,
  sendArcUsdcTransfer,
} from "@/lib/arc-send";
import {
  ARC_USDC_TOKEN_ADDRESS,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";

async function readErc20Balance(
  token: Address,
  account: Address
): Promise<bigint> {
  return readArcContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

/**
 * Payment amount uses ERC-20 USDC (6 decimals).
 * Separately require native eth_getBalance (18 decimals) for gas.
 */
async function requireBalancesForPayment(
  account: Address,
  fee: bigint
): Promise<SparkRefillPaymentToken> {
  const [erc20Balance, nativeGas] = await Promise.all([
    readErc20Balance(ARC_USDC_TOKEN_ADDRESS, account),
    getArcNativeBalance(account),
  ]);

  if (nativeGas < ARC_MIN_NATIVE_GAS_WEI) {
    throw new Error(
      `Not enough native USDC for gas (need ~0.02, have ${formatEther(nativeGas)}). Fund Arc Mainnet gas.`
    );
  }

  if (erc20Balance < fee) {
    const needed = formatUnits(fee, STABLECOIN_DECIMALS);
    throw new Error(
      `Insufficient ERC-20 USDC for payment. You need $${needed} USDC (6 decimals).`
    );
  }

  return "USDC";
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
    requireBalancesForPayment(account, fee)
  );

  let payHash: Hash;
  try {
    const sent = await sendArcUsdcTransfer({
      token: getAddress(ARC_USDC_TOKEN_ADDRESS),
      to: getAddress(contractAddress),
      amount: fee,
      gas: ARC_DEFAULT_TRANSFER_GAS,
    });
    payHash = sent.txHash;
  } catch (error) {
    throw toFriendlyError(
      error,
      `${failError} Switch your wallet to Arc Mainnet (5042) and try again.`
    );
  }

  const payReceipt = await runStage("receipt", () =>
    waitForArcTransactionReceipt(payHash)
  );

  if (payReceipt.status !== "success") {
    throw new Error(
      `${failError} The transfer was rejected on-chain. Keep a little extra native USDC for gas.`
    );
  }

  return { txHash: payHash, token };
}
