/**
 * Verify all ArcadeX Arc mainnet deployments on Sourcify (+ mark deployments/*.json).
 * Usage: node scripts/verify-all-arc.cjs
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const CHAIN_ID = 5042;
const ROOT = path.resolve(__dirname, "../..");

const CONTRACTS = [
  {
    name: "SparkRefill",
    file: "spark-refill-arc-mainnet.json",
    identifier: "contracts/SparkRefill.sol:SparkRefill",
  },
  {
    name: "ScoreSubmit",
    file: "score-submit-arc-mainnet.json",
    identifier: "contracts/ScoreSubmit.sol:ScoreSubmit",
  },
  {
    name: "InfiniteSpark",
    file: "infinite-spark-arc-mainnet.json",
    identifier: "contracts/InfiniteSpark.sol:InfiniteSpark",
  },
  {
    name: "ArcadeXTxHub",
    file: "arcadex-tx-hub-arc-mainnet.json",
    identifier: "contracts/ArcadeXTxHub.sol:ArcadeXTxHub",
  },
  {
    name: "ArcadeXRewards",
    file: "arcadex-rewards-arc-mainnet.json",
    identifier: "contracts/ArcadeXRewards.sol:ArcadeXRewards",
  },
];

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      url,
      {
        method,
        headers: data
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(data),
            }
          : undefined,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            /* keep string */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const getJson = (url) => request("GET", url).then((r) => r.body);
const postJson = (url, body) => request("POST", url, body);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBuildInfo(solFile) {
  const buildInfoDir = path.resolve(__dirname, "../artifacts/build-info");
  const files = fs
    .readdirSync(buildInfoDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(buildInfoDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  for (const file of files) {
    const buildInfo = JSON.parse(fs.readFileSync(file, "utf8"));
    if (buildInfo.input?.sources?.[solFile]) return buildInfo;
  }
  throw new Error(`No build-info for ${solFile}`);
}

function isSuccessMatch(status) {
  const match = status?.contract?.match || status?.match;
  const job = status?.status;
  const code = status?.error?.customCode || status?.customCode;
  if (code === "already_verified") return true;
  return (
    match === "perfect" ||
    match === "partial" ||
    match === "exact_match" ||
    match === "match" ||
    job === "perfect" ||
    job === "partial" ||
    job === "exact_match" ||
    job === "match" ||
    job === "completed"
  );
}

async function lookupSourcify(address) {
  const res = await request(
    "GET",
    `https://sourcify.dev/server/v2/contract/${CHAIN_ID}/${address}`
  );
  if (res.status === 200 && isSuccessMatch(res.body)) return res.body;
  return null;
}

async function verifyOnSourcify(address, txHash, identifier) {
  const existing = await lookupSourcify(address);
  if (existing) {
    console.log("  Already on Sourcify:", existing.match || existing.runtimeMatch);
    return true;
  }

  const solFile = identifier.split(":")[0];
  const buildInfo = findBuildInfo(solFile);
  const submit = await postJson(
    `https://sourcify.dev/server/v2/verify/${CHAIN_ID}/${address}`,
    {
      stdJsonInput: buildInfo.input,
      compilerVersion: buildInfo.solcLongVersion,
      contractIdentifier: identifier,
      creationTransactionHash: txHash,
    }
  );

  if (submit.status === 409 && submit.body?.customCode === "already_verified") {
    console.log("  Already verified on Sourcify.");
    return true;
  }

  if (submit.status !== 200 && submit.status !== 202) {
    throw new Error(`Sourcify submit failed (${submit.status}): ${JSON.stringify(submit.body)}`);
  }

  const verificationId = submit.body.verificationId;
  if (!verificationId) {
    if (isSuccessMatch(submit.body)) return true;
    throw new Error(`Unexpected Sourcify response: ${JSON.stringify(submit.body)}`);
  }

  console.log("  Sourcify job:", verificationId);
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    const status = await getJson(
      `https://sourcify.dev/server/v2/verify/${verificationId}`
    );
    if (isSuccessMatch(status)) {
      console.log("  Verified on Sourcify.");
      return true;
    }
    if (status?.status === "failed" && status?.error?.customCode !== "already_verified") {
      throw new Error(JSON.stringify(status));
    }
    if (status?.error?.customCode === "already_verified") {
      console.log("  Already verified on Sourcify.");
      return true;
    }
  }
  throw new Error("Sourcify verification timed out");
}

async function refreshBlockscout(address) {
  // Ask Blockscout to pull verified source (Sourcify sync endpoint when available).
  const urls = [
    `https://explorer.arc.io/api/v2/smart-contracts/${address}`,
    `https://explorer.arc.io/api?module=contract&action=getsourcecode&address=${address}`,
  ];
  for (const url of urls) {
    try {
      const res = await request("GET", url);
      const body = res.body;
      const verified =
        body?.is_verified === true ||
        body?.result?.[0]?.SourceCode ||
        (typeof body?.result?.[0]?.ABI === "string" &&
          body.result[0].ABI !== "Contract source code not verified");
      if (verified) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function saveDeployment(file, deployment, sourcifyOk, explorerOk) {
  const updated = {
    ...deployment,
    verified: Boolean(sourcifyOk),
    verifiedAt: new Date().toISOString(),
    verification: {
      sourcify: `https://sourcify.dev/#/lookup/${CHAIN_ID}/${deployment.address}`,
      explorer: `https://explorer.arc.io/address/${deployment.address}#code`,
      explorerVerified: Boolean(explorerOk),
    },
  };
  fs.writeFileSync(file, JSON.stringify(updated, null, 2) + "\n");
}

async function main() {
  let failures = 0;
  for (const c of CONTRACTS) {
    const file = path.join(ROOT, "deployments", c.file);
    const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(`\n=== ${c.name} ${deployment.address} ===`);
    if (!deployment.address || !deployment.txHash) {
      console.error("  Missing address/txHash in deployment file");
      failures += 1;
      continue;
    }
    try {
      const sourcifyOk = await verifyOnSourcify(
        deployment.address,
        deployment.txHash,
        c.identifier
      );
      const explorerOk = await refreshBlockscout(deployment.address);
      console.log(
        explorerOk
          ? "  Explorer shows verified source."
          : "  Explorer may still show unverified (Sourcify sync can lag)."
      );
      saveDeployment(file, deployment, sourcifyOk, explorerOk);
    } catch (err) {
      failures += 1;
      console.error("  FAILED:", err.message || err);
    }
  }

  console.log(failures ? `\nDone with ${failures} failure(s).` : "\nAll contracts verified on Sourcify.");
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
