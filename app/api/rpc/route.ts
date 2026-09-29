import { NextResponse } from "next/server";
import {
  getArcUpstreamRpcHeaders,
  getArcUpstreamRpcUrls,
} from "@/lib/arc-rpc";

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

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function forwardToUpstream(
  bodyText: string
): Promise<
  | { ok: true; text: string; upstream: string }
  | { ok: false; error: string; statusHints: number[] }
> {
  const urls = getArcUpstreamRpcUrls();
  const headers = getArcUpstreamRpcHeaders();
  const statusHints: number[] = [];
  let lastError = "No Arc RPC upstream configured";

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: bodyText,
        cache: "no-store",
      });

      const text = await res.text();
      statusHints.push(res.status);

      if (res.ok) {
        return { ok: true, text, upstream: hostOf(url) };
      }

      // Permissioned / rate-limited — try next provider.
      if (
        res.status === 401 ||
        res.status === 403 ||
        res.status === 429 ||
        res.status >= 500
      ) {
        lastError = `Upstream ${hostOf(url)} returned ${res.status}`;
        continue;
      }

      // Other 4xx with JSON-RPC body — return it (method/params errors).
      if (text) {
        return { ok: true, text, upstream: hostOf(url) };
      }

      lastError = `Upstream ${hostOf(url)} returned ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, error: lastError, statusHints };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Payload too large" },
      },
      { status: 413 }
    );
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 }
    );
  }

  if (!bodyText || bodyText.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid request" },
      },
      { status: 400 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as JsonRpcBody | JsonRpcBody[];
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 }
    );
  }

  const methodError = assertAllowedMethods(parsed);
  if (methodError) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32601, message: methodError },
      },
      { status: 400 }
    );
  }

  const result = await forwardToUpstream(bodyText);
  if (!result.ok) {
    const hint = result.statusHints.includes(401) || result.statusHints.includes(403)
      ? " (RPC may require ARC_RPC_API_KEY / ARC_RPC_URL)"
      : result.statusHints.includes(429)
        ? " (rate limited — set ARC_RPC_URL to a dedicated provider)"
        : "";
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: `Arc RPC unavailable: ${result.error}${hint}`,
        },
      },
      { status: 502 }
    );
  }

  return new NextResponse(result.text, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-arc-rpc-upstream": result.upstream,
    },
  });
}

/** Health — probes upstream eth_chainId without exposing secrets. */
export async function GET() {
  const probe = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_chainId",
    params: [],
  });
  const result = await forwardToUpstream(probe);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        chain: "arc",
        chainId: 5042,
        proxy: true,
        error: result.error,
        statusHints: result.statusHints,
      },
      { status: 502 }
    );
  }

  let chainIdHex: string | null = null;
  try {
    const body = JSON.parse(result.text) as { result?: string };
    chainIdHex = body.result ?? null;
  } catch {
    // ignore
  }

  return NextResponse.json({
    ok: true,
    chain: "arc",
    chainId: 5042,
    chainIdHex,
    proxy: true,
    upstream: result.upstream,
  });
}
