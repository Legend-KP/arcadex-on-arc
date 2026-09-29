import {
  createPublicClient,
  hexToBigInt,
  http,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import {
  ARC_MIN_MAX_FEE_PER_GAS_WEI,
  arcChain,
} from "@/lib/arc-chain";
import {
  getArcUpstreamRpcUrls,
  getBrowserArcRpcUrl,
} from "@/lib/arc-rpc";

function getRpcUrls(): string[] {
  return getArcUpstreamRpcUrls();
}

const publicClientConfig = {
  chain: arcChain,
  batch: { multicall: false },
  cacheTime: 0,
} as const;

function createHttpClient(rpcUrl: string) {
  return createPublicClient({
    ...publicClientConfig,
    transport: http(rpcUrl, { timeout: 12_000 }),
  });
}

type ArcPublicClient = ReturnType<typeof createHttpClient>;

let browserClient: ArcPublicClient | null = null;
let browserClientIndex = 0;

function createBrowserPublicClient(): ArcPublicClient {
  // Always hit same-origin /api/rpc so ad blockers cannot kill Arc reads.
  return createHttpClient(getBrowserArcRpcUrl());
}

/** Public client for browser-side chain reads (payments, balances). */
export function getArcPublicClient(): ArcPublicClient {
  if (typeof window !== "undefined") {
    browserClient ??= createBrowserPublicClient();
    return browserClient;
  }

  return createHttpClient(getRpcUrls()[0]!);
}

/** Reset cached browser client (proxy is sticky; index kept for server failover helpers). */
export function resetArcPublicClient(): void {
  browserClient = null;
  const urls = getRpcUrls();
  if (urls.length > 0) {
    browserClientIndex = (browserClientIndex + 1) % urls.length;
  }
}

function collectErrorText(error: unknown): string {
  if (error instanceof Error) {
    const parts: string[] = [error.message];
    let cause: unknown = error.cause;
    while (cause instanceof Error) {
      parts.push(cause.message);
      cause = cause.cause;
    }
    return parts.join(" ");
  }

  if (typeof error === "string") return error;

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof record.message === "string" && record.message.trim()) {
      parts.push(record.message.trim());
    }
    if (typeof record.reason === "string" && record.reason.trim()) {
      parts.push(record.reason.trim());
    }
    if (typeof record.details === "string" && record.details.trim()) {
      parts.push(record.details.trim());
    }
    if (typeof record.shortMessage === "string" && record.shortMessage.trim()) {
      parts.push(record.shortMessage.trim());
    }
    if (typeof record.code === "number" || typeof record.code === "string") {
      parts.push(`code ${record.code}`);
    }
    if (record.data && typeof record.data === "object") {
      const data = record.data as Record<string, unknown>;
      if (typeof data.message === "string" && data.message.trim()) {
        parts.push(data.message.trim());
      }
    }

    if (parts.length > 0) return parts.join(" | ");

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown wallet error";
    }
  }

  return String(error);
}

export function isBlockOutOfRangeError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("block is out of range") ||
    message.includes("header not found") ||
    message.includes("invalid block tag")
  );
}

function isTransientRpcError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isBlockOutOfRangeError(error) ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("http request failed") ||
    message.includes("failed to fetch") ||
    message.includes("blocked_by_client") ||
    message.includes("err_blocked")
  );
}

function isTransactionFailureError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  // Do NOT match "version: viem" — almost every viem error includes that footer
  // and was incorrectly shown as a generic "Transaction failed".
  return (
    message.includes("execution reverted") ||
    message.includes("transaction failed") ||
    message.includes("intrinsic gas too low") ||
    message.includes("insufficient funds for gas")
  );
}

/** Pull the revert name/string viem puts on the line under its header. */
function readContractRevertDetail(error: unknown): string | null {
  const raw = collectErrorText(error);
  const reasonLine = raw.match(
    /reverted with the following (?:reason|signature):\s*\n+\s*([^\n]+)/i
  );
  const fromLine = reasonLine?.[1]?.trim() ?? "";
  if (
    fromLine &&
    !/^version:/i.test(fromLine) &&
    !/^docs:/i.test(fromLine) &&
    !/^details:/i.test(fromLine)
  ) {
    return fromLine.replace(/\(\)$/, "");
  }

  const custom = raw.match(/Error:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (custom?.[1] && custom[1] !== "Error") return custom[1];

  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const record = current as Record<string, unknown>;
    if (
      typeof record.reason === "string" &&
      record.reason.trim() &&
      record.reason.trim().toLowerCase() !== "execution reverted"
    ) {
      return record.reason.trim();
    }
    const data = record.data;
    if (data && typeof data === "object") {
      const errorName = (data as { errorName?: unknown }).errorName;
      if (typeof errorName === "string" && errorName && errorName !== "Error") {
        return errorName;
      }
    }
    current = record.cause;
  }

  return null;
}

function friendlyContractRevert(detail: string): string {
  const key = detail.replace(/\(\)$/, "").trim();
  const lower = key.toLowerCase();

  if (lower === "spintoosoon" || lower === "toosoon") {
    return "Already shuffled today. Come back after 00:00 UTC.";
  }
  if (lower === "claimpending") {
    return "Claim your pending prize before shuffling again.";
  }
  if (lower === "invalidspinsignature" || lower === "spinsignerequired") {
    return "This shuffle could not be verified. Close the popup and try again.";
  }
  if (
    lower === "invalidspinnonce" ||
    lower === "signaturealreadyused" ||
    lower === "spinexpired"
  ) {
    return "This shuffle expired. Close the popup and try again.";
  }
  if (lower === "exceedsmaxpayout" || lower === "insufficienttreasury") {
    return "The prize pool can't cover this result. Try again.";
  }
  if (lower === "pausederror") {
    return "Shuffles are paused right now. Try again later.";
  }
  if (lower === "maxclaimsreached") {
    return "Today's prize claims are used up. Try again tomorrow.";
  }
  if (lower.includes("no native value")) {
    return "The wallet attached native value to this shuffle. Close the wallet and try again.";
  }
  if (lower === "campaigninactive" || lower === "campaigniscancelled") {
    return "The daily jackpot is not active right now.";
  }
  if (lower === "campaignnotstarted") {
    return "The daily jackpot has not started yet.";
  }
  if (lower === "campaignended") {
    return "The daily jackpot has ended.";
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `Shuffle failed (${key}). Please try again.`;
  }
  return key.length > 160 ? `${key.slice(0, 157)}...` : key;
}

function shortChainErrorMessage(error: unknown): string | null {
  const raw = collectErrorText(error);
  if (!raw || raw === "[object Object]") return null;

  const revertDetail = readContractRevertDetail(error);
  if (revertDetail) return friendlyContractRevert(revertDetail);

  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  const withoutViemFooter = firstLine
    .replace(/\s*Version: viem.*$/i, "")
    .replace(/\s*Details:.*$/i, "")
    .replace(/\s*\|\s*code\s+-?\d+\s*$/i, "")
    .trim();

  if (
    withoutViemFooter &&
    withoutViemFooter.length > 0 &&
    withoutViemFooter.length <= 180 &&
    !withoutViemFooter.toLowerCase().includes("rpc request failed") &&
    !withoutViemFooter.toLowerCase().includes("http request failed") &&
    !/reverted with the following (?:reason|signature):\s*$/i.test(withoutViemFooter)
  ) {
    return withoutViemFooter;
  }

  return null;
}

/** Map low-level RPC / wallet errors to short user-facing messages. */
export function formatChainError(error: unknown): string {
  const text = collectErrorText(error);

  // Debug stage payloads from purchaseStablecoinFeeOnChain (DEBUG_PAYMENTS).
  if (/^\[[a-zA-Z0-9_:-]+\]\s/.test(text)) {
    return text.length > 420 ? `${text.slice(0, 417)}...` : text;
  }

  if (
    text.includes("Insufficient balance") ||
    text.includes("Connect your wallet") ||
    text.includes("No wallet") ||
    text.includes("approval failed") ||
    text.includes("payment failed") ||
    text.includes("Payments are paused") ||
    text.includes("Almost enough") ||
    text.includes("network fee") ||
    text.includes("Payment cancelled") ||
    text.includes("Wallet did not return") ||
    text.includes("Connect a wallet")
  ) {
    // Prefer the first recognizable sentence from our own errors.
    const match = text.match(
      /((?:Insufficient balance|Connect your wallet|No wallet|Almost enough|Payments are paused|Payment cancelled|Wallet did not return|Connect a wallet|[^|]*)[^.]*\.?)/
    );
    const candidate = (match?.[1] ?? text).trim();
    if (candidate && candidate !== "[object Object]") {
      return candidate.length > 180 ? `${candidate.slice(0, 177)}...` : candidate;
    }
  }

  if (isUserFacingRejection(error)) {
    return "Payment cancelled in wallet.";
  }

  const lower = text.toLowerCase();
  if (
    lower.includes("invalid parameters were provided") ||
    lower.includes("invalid params") ||
    (lower.includes("invalid parameters") && lower.includes("rpc"))
  ) {
    return "Your wallet rejected the transaction. Switch to Arc (chain 5042) and try again.";
  }
  if (
    lower.includes("http request failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("blocked_by_client") ||
    lower.includes("err_blocked") ||
    lower.includes("load failed")
  ) {
    return "Could not reach Arc. Disable ad blockers for this site and try again.";
  }

  const short = shortChainErrorMessage(error);
  if (short) return short;

  if (isTransactionFailureError(error)) {
    return "Transaction failed. Please try again.";
  }

  if (text.toLowerCase().includes("unknown rpc error")) {
    return "Wallet could not prepare the payment. Please close and try again.";
  }

  if (isTransientRpcError(error)) {
    return "The network is temporarily unavailable. Please wait a moment and try again.";
  }

  if (text && text !== "[object Object]" && text.length <= 180) {
    return text;
  }

  if (
    text.includes("RPC Request failed") ||
    text.includes("Request body") ||
    text.length > 180
  ) {
    return "Could not reach the Arc network. Please try again.";
  }

  return "Something went wrong. Please try again.";
}

function isUserFacingRejection(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (typeof (error as { code?: unknown }).code === "number" ||
      typeof (error as { code?: unknown }).code === "string")
      ? Number((error as { code: number | string }).code)
      : null;

  return (
    code === 4001 ||
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request") ||
    message.includes("request rejected")
  );
}

type ReadContractParams = Parameters<ArcPublicClient["readContract"]>[0];

const RETRY_DELAYS_MS = [0, 400, 900];

async function withArcRpcRetry<T>(fn: (client: ArcPublicClient) => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      resetArcPublicClient();
    }

    try {
      return await fn(getArcPublicClient());
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  for (const rpcUrl of getRpcUrls()) {
    try {
      return await fn(createHttpClient(rpcUrl));
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not reach the Arc network. Please try again.");
}

export async function readArcContract(
  params: ReadContractParams
): Promise<bigint> {
  return withArcRpcRetry(async (client) => {
    return (await client.readContract({
      ...params,
      blockTag: "latest",
    })) as bigint;
  });
}

/** Retry-safe contract read for non-bigint returns (e.g. paused()). */
export async function readArcContractValue<T>(
  params: ReadContractParams
): Promise<T> {
  return withArcRpcRetry(async (client) => {
    return (await client.readContract({
      ...params,
      blockTag: "latest",
    })) as T;
  });
}

/**
 * Suggested maxFeePerGas for Arc sends — never below the 20 Gwei mempool floor.
 * Gas is paid in native USDC (18 decimals); CIP-64 feeCurrency is not used.
 */
export async function getArcMaxFeePerGas(): Promise<bigint> {
  return withArcRpcRetry(async (client) => {
    const priceHex = (await client.request({
      method: "eth_gasPrice",
    })) as `0x${string}`;
    const network = hexToBigInt(priceHex);
    return network > ARC_MIN_MAX_FEE_PER_GAS_WEI
      ? network
      : ARC_MIN_MAX_FEE_PER_GAS_WEI;
  });
}

/**
 * Native Arc balance via eth_getBalance — **18 decimals** (gas currency).
 * Do NOT confuse with ERC-20 USDC at 0x3600… which uses 6 decimals.
 */
export async function getArcNativeBalance(address: Address): Promise<bigint> {
  return withArcRpcRetry(async (client) => {
    return client.getBalance({ address, blockTag: "latest" });
  });
}

/**
 * Confirm a tx via eth_getTransactionReceipt on our RPC proxy/upstreams.
 * Do not rely on explorer.arc.io (may be gated / delayed).
 */
export async function confirmArcTxViaRpc(
  hash: Hash
): Promise<TransactionReceipt | null> {
  for (const rpcUrl of [
    typeof window !== "undefined" ? getBrowserArcRpcUrl() : getRpcUrls()[0]!,
    ...getRpcUrls(),
  ]) {
    try {
      const receipt = await createHttpClient(rpcUrl).getTransactionReceipt({
        hash,
      });
      if (receipt) return receipt;
    } catch {
      // try next
    }
  }
  return null;
}

/** @deprecated CIP-64 fee currency is Celo-only; returns Arc maxFeePerGas floor. */
export async function getCeloFeeCurrencyGasPrice(
  _feeCurrency?: Address
): Promise<bigint> {
  return getArcMaxFeePerGas();
}

/** Retry-safe nonce from public RPC so the wallet is not asked for eth_getTransactionCount. */
export async function getArcTransactionCount(address: Address): Promise<number> {
  return withArcRpcRetry(async (client) => {
    return client.getTransactionCount({ address, blockTag: "pending" });
  });
}

const RECEIPT_RETRY_DELAYS_MS = [0, 500, 1200, 2500, 4000];

function isTransientReceiptError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isTransientRpcError(error) ||
    message.includes("could not be found") ||
    message.includes("not found") ||
    message.includes("timed out") ||
    message.includes("wait for transaction")
  );
}

/**
 * Wait for a tx receipt with RPC rotation. Prefer this right after the wallet
 * confirms a write — a single RPC flake otherwise traps users mid-sign-in.
 */
export async function waitForArcTransactionReceipt(
  hash: Hash,
  opts?: { confirmations?: number; timeoutMs?: number }
): Promise<TransactionReceipt> {
  let lastError: unknown;
  const timeout = opts?.timeoutMs ?? 45_000;
  const confirmations = opts?.confirmations ?? 1;

  for (let attempt = 0; attempt < RECEIPT_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RECEIPT_RETRY_DELAYS_MS[attempt])
      );
      resetArcPublicClient();
    }

    try {
      return await getArcPublicClient().waitForTransactionReceipt({
        hash,
        confirmations,
        timeout,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  for (const rpcUrl of getRpcUrls()) {
    try {
      return await createHttpClient(rpcUrl).waitForTransactionReceipt({
        hash,
        confirmations,
        timeout: Math.min(timeout, 20_000),
      });
    } catch (error) {
      lastError = error;
      if (!isTransientReceiptError(error)) throw error;
    }
  }

  // Last resort: poll getTransactionReceipt across RPCs (do not rely on explorer).
  const polled = await confirmArcTxViaRpc(hash);
  if (polled) return polled;

  throw lastError instanceof Error
    ? lastError
    : new Error(
        "Could not confirm the transaction via Arc RPC (explorer is not required). Wait a few seconds and refresh."
      );
}


/** @deprecated Use getArcPublicClient */
export const getCeloPublicClient = getArcPublicClient;
/** @deprecated Use resetArcPublicClient */
export const resetCeloPublicClient = resetArcPublicClient;
/** @deprecated Use readArcContract */
export const readCeloContract = readArcContract;
/** @deprecated Use readArcContractValue */
export const readCeloContractValue = readArcContractValue;
/** @deprecated Use getArcTransactionCount */
export const getCeloTransactionCount = getArcTransactionCount;
/** @deprecated Use waitForArcTransactionReceipt */
export const waitForCeloTransactionReceipt = waitForArcTransactionReceipt;
