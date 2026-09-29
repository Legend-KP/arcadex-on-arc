import { NextResponse } from "next/server";
import { getArcUpstreamRpcUrls } from "@/lib/arc-rpc";

const ALLOWED_METHOD =
  /^(eth_|net_|web3_clientVersion$|web3_sha3$)/i;

const MAX_BODY_BYTES = 256_000;

type JsonRpcBody = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowedMethods(payload: unknown): string | null {
  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length === 0) return "Empty JSON-RPC body";
  if (items.length > 40) return "Too many batched RPC calls";

  for (const item of items) {
    if (!isRecord(item)) return "Invalid JSON-RPC item";
    const method = item.method;
    if (typeof method !== "string" || !ALLOWED_METHOD.test(method)) {
      return `RPC method not allowed: ${String(method)}`;
    }
  }
  return null;
}

async function forwardToUpstream(
  bodyText: string
): Promise<{ ok: true; text: string; status: number } | { ok: false; error: string }> {
  const urls = getArcUpstreamRpcUrls();
  let lastError = "No Arc RPC upstream configured";

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: bodyText,
        // Cloudflare / edge: avoid caching JSON-RPC
        cache: "no-store",
      });

      const text = await res.text();
      if (res.ok) {
        return { ok: true, text, status: res.status };
      }

      // Upstream 4xx/5xx — try next URL unless it's a JSON-RPC application error (200 only usually)
      lastError = `Upstream ${url} returned ${res.status}`;
      if (res.status >= 500 || res.status === 429) continue;
      // Non-retryable HTTP from upstream — still return body if present
      if (text) return { ok: true, text, status: res.status };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, error: lastError };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Payload too large" } },
      { status: 413 }
    );
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  if (!bodyText || bodyText.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
      { status: 400 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as JsonRpcBody | JsonRpcBody[];
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const methodError = assertAllowedMethods(parsed);
  if (methodError) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32601, message: methodError } },
      { status: 400 }
    );
  }

  const result = await forwardToUpstream(bodyText);
  if (!result.ok) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: `Arc RPC unavailable: ${result.error}`,
        },
      },
      { status: 502 }
    );
  }

  return new NextResponse(result.text, {
    // Always 200 so viem/wallets parse JSON-RPC errors in-body (not as HTTP failures).
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

/** Health / discovery — browsers should POST JSON-RPC. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    chain: "arc",
    chainId: 5042,
    proxy: true,
  });
}
