/**
 * Seed ArcadeX games catalog into arcadex-on-arc Firestore from the live Celo catalog.
 * Usage: node scripts/seed-arc-games.mjs
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env");
  const text = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v.replace(/\\n/g, "\n");
  }
  return env;
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign
    .sign(privateKey)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function encodeFields(data) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") fields[key] = { stringValue: value };
    else if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else if (Number.isInteger(value))
      fields[key] = { integerValue: String(value) };
    else if (typeof value === "number") fields[key] = { doubleValue: value };
  }
  return fields;
}

function normalizePath(p) {
  if (!p || typeof p !== "string") return "";
  return p.replace(/\\/g, "/");
}

function gamePayload(game) {
  const payload = {
    name: game.name,
    thumbnail: normalizePath(game.thumbnail || ""),
    url: game.url,
    plays: String(game.plays ?? "0"),
    fallbackImage: normalizePath(game.fallbackImage || ""),
    active: game.active !== false,
    isTest: game.isTest === true,
    live: game.live !== false,
    hasLeaderboard: game.hasLeaderboard !== false,
    contestLive: game.contestLive === true,
    sortOrder:
      typeof game.sortOrder === "number" ? game.sortOrder : Number(game.sortOrder) || 0,
    createdAt:
      typeof game.createdAt === "number" ? game.createdAt : Date.now(),
  };
  if (game.logo) payload.logo = normalizePath(game.logo);
  if (typeof game.contestDurationDays === "number")
    payload.contestDurationDays = game.contestDurationDays;
  if (game.contestTask) payload.contestTask = game.contestTask;
  if (typeof game.contestStartedAt === "number")
    payload.contestStartedAt = game.contestStartedAt;
  if (typeof game.contestEndsAt === "number")
    payload.contestEndsAt = game.contestEndsAt;
  if (typeof game.newArrivalAt === "number")
    payload.newArrivalAt = game.newArrivalAt;
  return payload;
}

async function upsertGame(projectId, token, game) {
  const fields = encodeFields(gamePayload(game));
  const fieldPaths = Object.keys(fields);
  const mask = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/games/${game.id}?${mask}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${game.name} (${game.id}): ${res.status} ${text.slice(0, 300)}`);
  }
  return true;
}

async function main() {
  const env = loadEnv();
  const projectId = env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY in .env");
  }

  const catalogPath = path.join(__dirname, "celo-games-catalog.json");
  let games = [];
  if (fs.existsSync(catalogPath)) {
    const raw = fs.readFileSync(catalogPath, "utf8").replace(/^\uFEFF/, "");
    try {
      const parsed = JSON.parse(raw);
      games = Array.isArray(parsed) ? parsed : parsed.games || [];
    } catch {
      games = [];
    }
  }
  if (!Array.isArray(games) || games.length === 0) {
    console.log("Refreshing catalog from live Celo…");
    const live = await (
      await fetch("https://arcadex.trenchverse.com/api/games")
    ).json();
    games = live.games || [];
    fs.writeFileSync(catalogPath, JSON.stringify(games, null, 2));
  }

  console.log(`Seeding ${games.length} games into Firestore project ${projectId}…`);
  const token = await getAccessToken(clientEmail, privateKey);

  for (const game of games) {
    await upsertGame(projectId, token, game);
    console.log(`  ✓ ${game.name} (${game.id}) live=${game.live !== false}`);
  }

  // Admin login + reconcile D1/RTDB gating flags
  const adminHost =
    process.env.ADMIN_BASE ||
    `https://${(env.NEXT_PUBLIC_ADMIN_HOST || "admin.arcx.trenchverse.com").replace(/^https?:\/\//, "")}`;
  const password = env.ADMIN_PASSWORD || env.NEXT_PUBLIC_ADMIN_PASSWORD;
  console.log(`\nReconciling game flags via ${adminHost}…`);

  const loginRes = await fetch(`${adminHost}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const loginBody = await loginRes.text();
  if (!loginRes.ok) {
    console.warn(`Admin login failed (${loginRes.status}): ${loginBody}`);
    console.warn("Games are in Firestore; run reconcile from admin portal.");
    return;
  }
  const cookie = loginRes.headers.getSetCookie?.()?.join("; ") ||
    loginRes.headers.get("set-cookie") ||
    "";

  const recon = await fetch(`${adminHost}/api/admin/reconcile-game-flags?repair=1`, {
    method: "POST",
    headers: {
      Cookie: cookie.split(",").map((c) => c.split(";")[0].trim()).join("; "),
    },
  });
  const reconText = await recon.text();
  console.log(`Reconcile ${recon.status}: ${reconText.slice(0, 500)}`);

  const list = await fetch(`https://${(env.NEXT_PUBLIC_APP_URL || "arcx.trenchverse.com").replace(/^https?:\/\//, "")}/api/games`);
  const listed = await list.json();
  console.log(`\nPublic /api/games count: ${(listed.games || []).length}`);
  for (const g of listed.games || []) {
    console.log(`  - ${g.name} (${g.id})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
