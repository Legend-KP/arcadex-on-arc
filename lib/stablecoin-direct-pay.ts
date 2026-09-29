/**
 * Stablecoin payments for SparkRefill / InfiniteSpark / ScoreSubmit.
 *
 * Contract flow (matches Solidity):
 *   1) USDC.approve(paymentContract, fee)   — skip if allowance already enough
 *   2) paymentContract.payWithUSDC()        — pulls fee via transferFrom, emits EntryPaid
 *
 * value must always be 0x0 (receive/fallback reject native value).
 */

import {
  formatEther,
  formatUnits,
  getAddress,
  maxUint256,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import {
  formatChainError,
  getArcNativeBalance,
  getArcPublicClient,
  readArcContract,
  readArcContractValue,
  waitForArcTransactionReceipt,
} from "@/lib/arc-public-client";
import {
  ARC_DEFAULT_CALL_GAS,
  ARC_DEFAULT_TRANSFER_GAS,
  ARC_MIN_NATIVE_GAS_WEI,
  prepareArcWalletAccount,
  sendArcContractWrite,
} from "@/lib/arc-send";
import {
  ARC_USDC_TOKEN_ADDRESS,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

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

async function readAllowance(
  owner: Address,
  spender: Address
): Promise<bigint> {
  return (await getArcPublicClient().readContract({
    address: ARC_USDC_TOKEN_ADDRESS,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
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
 * Approve USDC (if needed) then call payWithUSDC() on the payment contract.
 * Returns the payWithUSDC tx hash (EntryPaid) for server verification.
 */
export async function purchaseStablecoinFeeOnChain(options: {
  contractAddress: Address;
  contractAbi: Abi;
  connectError: string;
  failError: string;
}): Promise<{ txHash: Hash; token: SparkRefillPaymentToken }> {
  const { contractAddress, contractAbi, connectError, failError } = options;

  if (!ARC_USDC_TOKEN_ADDRESS || !contractAddress) {
    throw new Error(
      connectError ||
        "Payment contract is not configured. Set NEXT_PUBLIC_*_CONTRACT build vars."
    );
  }

  const paymentContract = getAddress(contractAddress);
  const usdc = getAddress(ARC_USDC_TOKEN_ADDRESS);

  let account: Address;
  try {
    account = await prepareArcWalletAccount();
  } catch (error) {
    throw toFriendlyError(error, connectError);
  }

  const paused = await runStage("paused", () =>
    readArcContractValue<boolean>({
      address: paymentContract,
      abi: contractAbi,
      functionName: "paused",
    })
  );
  if (paused) {
    throw new Error("Payments are paused. Please try again later.");
  }

  const fee = await runStage("fee", () =>
    readArcContract({
      address: paymentContract,
      abi: contractAbi,
      functionName: "fee",
    })
  );

  const token = await runStage("balance", () =>
    requireBalancesForPayment(account, fee)
  );

  // 1) Approve if allowance < fee (one wallet confirmation when needed).
  const allowance = await runStage("allowance", () =>
    readAllowance(account, paymentContract)
  );

  if (allowance < fee) {
    try {
      const { txHash: approveHash } = await sendArcContractWrite({
        address: usdc,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        // Approve max so future refills skip this step; fee-exact also works.
        args: [paymentContract, maxUint256],
        gas: ARC_DEFAULT_TRANSFER_GAS,
      });
      const approveReceipt = await waitForArcTransactionReceipt(approveHash);
      if (approveReceipt.status !== "success") {
        throw new Error("USDC approve failed on-chain.");
      }
    } catch (error) {
      throw toFriendlyError(
        error,
        `${failError} Approve USDC for the payment contract, then try again.`
      );
    }
  }

  // 2) payWithUSDC() — transferFrom + EntryPaid. value must be 0.
  let payHash: Hash;
  try {
    const sent = await sendArcContractWrite({
      address: paymentContract,
      abi: contractAbi,
      functionName: "payWithUSDC",
      args: [],
      gas: ARC_DEFAULT_CALL_GAS,
    });
    payHash = sent.txHash;
  } catch (error) {
    throw toFriendlyError(
      error,
      `${failError} Switch to Arc Mainnet (5042) and try again.`
    );
  }

  const payReceipt = await runStage("receipt", () =>
    waitForArcTransactionReceipt(payHash)
  );

  if (payReceipt.status !== "success") {
    throw new Error(
      `${failError} payWithUSDC was rejected on-chain. Keep native USDC for gas and ERC-20 USDC for the fee.`
    );
  }

  return { txHash: payHash, token };
}
