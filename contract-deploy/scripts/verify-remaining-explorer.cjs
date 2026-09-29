/**
 * Verify remaining Arc contracts on explorer.arc.io via Sourcify sources + Blockscout APIs.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const CONTRACTS = [
  {
    name: "ScoreSubmit",
    address: "0x393A322846Cb9b95E9aFC6521e727Cf6C8af8501",
    ctor: "",
  },
  {
    name: "InfiniteSpark",
    address: "0x54CfCe40CaeF51b986DAf9abbc0C6dea0fA40a35",
    ctor: "",
  },
  {
    name: "ArcadeXTxHub",
    address: "0x5282cbB845006F9ecE9d042153A6C4Dc806347aa",
    ctor: "",
  },
  {
    name: "ArcadeXRewards",
    address: "0x10E69E455BCA4606B8820d342d3e52c01C17049c",
    ctor: "00000000000000000000000011015f39ac7389201aec778be8e3d84f2af44a70",
  },
];

function request(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ArcadeXVerify/1.0",
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: data, headers: res.headers })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const get = (url) => request("GET", url);

function postMultipart(url, files) {
  const boundary = "----ArcVerify" + Date.now();
  const parts = [];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
    );
    parts.push(Buffer.from(f.content));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return request("POST", url, {
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length,
    },
    body,
  });
}

async function checkVerified(address) {
  const r = await get(`https://explorer.arc.io/api/v2/addresses/${address}`);
  if (r.status !== 200) return { ok: false, raw: r.body.slice(0, 200) };
  const j = JSON.parse(r.body);
  return {
    ok: Boolean(j.is_verified),
    viaSourcify: j.is_verified_via_sourcify,
    viaEth: j.is_verified_via_eth_bytecode_db,
  };
}

async function loadSourcifyFiles(address) {
  for (const matchType of ["full_match", "partial_match", "match"]) {
    // Sourcify v2 "match" folder naming differs; try API first for file list
  }

  const api = await get(
    `https://sourcify.dev/server/v2/contract/5042/${address}?fields=all`
  );
  if (api.status !== 200) {
    throw new Error(`Sourcify API ${api.status}: ${api.body.slice(0, 200)}`);
  }
  const data = JSON.parse(api.body);
  const files = [];

  // Prefer stdJsonInput / sources from API
  const sources =
    data.stdJsonInput?.sources ||
    data.compilation?.sources ||
    data.sources ||
    {};

  if (data.stdJsonInput) {
    files.push({
      name: "metadata.json",
      content: JSON.stringify(
        {
          compiler: { version: data.compilation?.compilerVersion || data.compilerVersion },
          language: "Solidity",
          output: { abi: data.abi || [] },
          settings: data.stdJsonInput.settings || {},
          sources: data.stdJsonInput.sources || {},
        },
        null,
        2
      ),
    });
    for (const [srcPath, info] of Object.entries(data.stdJsonInput.sources || {})) {
      if (info.content) {
        files.push({
          name: srcPath.replace(/^.*\//, ""),
          content: info.content,
        });
      }
    }
  } else {
    // Fallback: repo metadata
    for (const matchType of ["full_match", "partial_match"]) {
      const meta = await get(
        `https://repo.sourcify.dev/contracts/${matchType}/5042/${address}/metadata.json`
      );
      if (meta.status !== 200) continue;
      const metadata = JSON.parse(meta.body);
      files.push({ name: "metadata.json", content: meta.body });
      for (const [srcPath, info] of Object.entries(metadata.sources || {})) {
        let content = info.content;
        if (!content) {
          const r = await get(
            encodeURI(
              `https://repo.sourcify.dev/contracts/${matchType}/5042/${address}/sources/${srcPath}`
            )
          );
          if (r.status === 200) content = r.body;
        }
        if (content) {
          files.push({
            name: srcPath.replace(/^.*\//, ""),
            content,
          });
        }
      }
      break;
    }
  }

  if (!files.length) throw new Error("No Sourcify source files found");
  return { files, match: data.match };
}

function findBuildInfo(solFile) {
  const dir = path.join(__dirname, "../artifacts/build-info");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of files) {
    const b = JSON.parse(fs.readFileSync(f, "utf8"));
    if (b.input?.sources?.[solFile]) return b;
  }
  return null;
}

async function verifyStandardJson(c) {
  const sol = `contracts/${c.name}.sol`;
  const build = findBuildInfo(sol);
  if (!build) {
    console.log("  no build-info for", sol);
    return false;
  }
  const compiler = build.solcLongVersion.startsWith("v")
    ? build.solcLongVersion
    : `v${build.solcLongVersion}`;
  const params = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    contractaddress: c.address,
    sourceCode: JSON.stringify(build.input),
    codeformat: "solidity-standard-json-input",
    contractname: `${sol}:${c.name}`,
    compilerversion: compiler,
    optimizationUsed: "1",
    runs: "200",
    constructorArguements: c.ctor || "",
    licenseType: "3",
  });
  const body = params.toString();
  const submit = await request("POST", "https://explorer.arc.io/api", {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });
  console.log("  standard-json:", submit.status, submit.body.slice(0, 250));
  if (submit.status === 403 || submit.body.includes("Just a moment")) {
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(submit.body);
  } catch {
    return false;
  }
  if (parsed.status !== "1") return false;
  const guid = parsed.result;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await get(
      `https://explorer.arc.io/api?module=contract&action=checkverifystatus&guid=${guid}`
    );
    let j;
    try {
      j = JSON.parse(st.body);
    } catch {
      console.log("  status poll non-json", st.status);
      continue;
    }
    console.log("  status:", j.result || j.message);
    if (j.status === "1") return true;
    if (String(j.result || "").toLowerCase().includes("fail")) return false;
  }
  return false;
}

async function verifyOne(c) {
  console.log(`\n=== ${c.name} ${c.address} ===`);
  const before = await checkVerified(c.address);
  if (before.ok) {
    console.log("  already verified on explorer");
    return true;
  }

  // 1) Sourcify multipart to Blockscout
  try {
    const { files, match } = await loadSourcifyFiles(c.address);
    console.log(`  sourcify match=${match} files=${files.map((f) => f.name).join(",")}`);
    const res = await postMultipart(
      `https://explorer.arc.io/api/v2/smart-contracts/${c.address}/verification/via/sourcify`,
      files
    );
    console.log("  sourcify multipart:", res.status, res.body.slice(0, 300));
  } catch (err) {
    console.log("  sourcify multipart error:", err.message);
  }

  await new Promise((r) => setTimeout(r, 2000));
  let after = await checkVerified(c.address);
  if (after.ok) {
    console.log("  verified via sourcify upload");
    return true;
  }

  // 2) Classic standard-json (may hit CF)
  const ok = await verifyStandardJson(c);
  after = await checkVerified(c.address);
  if (ok || after.ok) {
    console.log("  verified via standard-json");
    return true;
  }

  console.log("  still unverified on explorer");
  return false;
}

async function main() {
  let ok = 0;
  for (const c of CONTRACTS) {
    if (await verifyOne(c)) ok += 1;
  }
  console.log(`\nVerified on explorer: ${ok}/${CONTRACTS.length}`);
  process.exitCode = ok === CONTRACTS.length ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
