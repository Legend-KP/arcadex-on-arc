# ArcadeX on Arc

**A multi-game Web3 arcade — live on [Arc mainnet](https://docs.arc.io), with USDC for gas and on-chain gameplay payments.**

| | |
| --- | --- |
| **Live app** | [https://arcx.trenchverse.com](https://arcx.trenchverse.com) |
| **Chain** | Arc mainnet (`5042`) |
| **Gas / payments** | Native USDC + Arc ERC-20 USDC (`0x3600…0000`) |
| **Explorer** | [explorer.arc.io](https://explorer.arc.io) |

ArcadeX wraps Unity WebGL games in a Next.js shell: wallet connect, sparks (energy), daily streaks, leaderboards, and USDC micropayments — all settled on Arc.

---

## Why Arc?

Arc is a stablecoin-native L1 where **USDC is gas**. ArcadeX is built around that:

- Players pay small **USDC fees** on-chain to refill sparks, submit scores, and unlock infinite sparks
- Daily **streak check-ins** and reward spins run through verified Arc contracts
- No separate gas token UX — the same USDC players hold is what powers the arcade

---

## Features

- **Game catalog** — Unity WebGL titles hosted in an iframe shell with a postMessage bridge
- **Wallet sessions** — Injected wallet (e.g. MetaMask) + signed challenge → JWT-style session
- **Sparks economy** — Spend sparks to play; refill or go infinite via on-chain USDC payments
- **Daily streak** — On-chain check-ins via `ArcadeXRewards`
- **Leaderboards** — Per-game rankings with paid score submit on Arc
- **Admin portal** — Catalog management at `/admin`

---

## Arc mainnet contracts

All contracts below are **deployed and verified** on Arc mainnet. Deployment metadata lives in [`deployments/`](./deployments).

| Contract | Address | Role |
| --- | --- | --- |
| **SparkRefill** | [`0x07FB…5f0E`](https://explorer.arc.io/address/0x07FBF1bC8DF68C057fD4d7D1D7F57fADee6A5f0E) | Pay USDC to refill sparks |
| **ScoreSubmit** | [`0x393A…8501`](https://explorer.arc.io/address/0x393A322846Cb9b95E9aFC6521e727Cf6C8af8501) | Pay USDC to submit a leaderboard score |
| **InfiniteSpark** | [`0x54Cf…0a35`](https://explorer.arc.io/address/0x54CfCe40CaeF51b986DAf9abbc0C6dea0fA40a35) | Pay USDC for unlimited sparks |
| **ArcadeXTxHub** | [`0x5282…47aa`](https://explorer.arc.io/address/0x5282cbB845006F9ecE9d042153A6C4Dc806347aa) | Sign-in + payment hub |
| **ArcadeXRewards** | [`0x10E6…049c`](https://explorer.arc.io/address/0x10E69E455BCA4606B8820d342d3e52c01C17049c) | Streak check-ins / rewards |

Solidity sources: [`contracts/`](./contracts) and [`contract-deploy/contracts/`](./contract-deploy/contracts).

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript |
| Chain | [viem](https://viem.sh) + [wagmi](https://wagmi.sh) → Arc (`5042`) |
| Backend | Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare) |
| Player data | Cloudflare D1 (+ Firebase/RTDB where configured) |
| Games | Unity WebGL + `postMessage` bridge |

---

## Quick start (local)

```bash
git clone https://github.com/Legend-KP/arcadex-on-arc.git
cd arcadex-on-arc
npm install
cp .env.example .env.local
# Fill in Firebase + WALLET_SESSION_SECRET (see .env.example)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Useful scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Local Next.js dev server |
| `npm run build` | Production Next.js build |
| `npm run deploy:preview` | Build + deploy Cloudflare preview Worker |
| `npm run deploy:production` | Build + deploy production Worker |

Contract deploy tooling lives under [`contract-deploy/`](./contract-deploy) (Hardhat).

---

## Architecture (high level)

```
Browser (ArcadeX shell)
  ├─ wagmi / viem  →  Arc RPC (USDC txs, check-ins)
  ├─ /api/*        →  Cloudflare Worker (sessions, sparks, leaderboards)
  └─ Game iframe   →  Unity WebGL ↔ postMessage bridge
```

Key libraries:

- [`lib/arc-chain.ts`](./lib/arc-chain.ts) — Arc chain definition + USDC + fee floor
- [`lib/bridge.ts`](./lib/bridge.ts) — Unity ↔ shell message protocol
- [`lib/spark*.ts`](./lib) / [`lib/arcadex-rewards*.ts`](./lib) — on-chain payment + streak flows

---

## Environment variables

Copy [`.env.example`](./.env.example) → `.env.local`. Required for a working local/prod stack:

- Firebase client + Admin credentials (catalog / legacy paths)
- `WALLET_SESSION_SECRET` — required for wallet-authenticated API routes
- Arc contract addresses (defaults match mainnet deployments above)
- `PRIVATE_KEY` — only for Hardhat deploys (never commit)

Secrets (`.env`, `.env.local`, `.dev.vars`) are gitignored.

---

## Repo layout

```
app/                 Next.js App Router (pages + API routes)
components/          UI (home, game shell, wallet, sparks, admin)
lib/                 Arc clients, payments, sparks, sessions, bridge
contracts/           Solidity sources (Arc USDC fees)
contract-deploy/     Hardhat deploy + verify scripts
deployments/         Mainnet addresses + explorer / Sourcify links
unity-bridge/        Unity C# + jslib bridge + developer guide
public/              Thumbnails, static assets
```

Unity integration: copy `unity-bridge/ArcadeXBridge.cs` and `ArcadeXBridge.jslib` into your Unity WebGL project. See [`unity-bridge/DEVELOPER_GUIDE.md`](./unity-bridge/DEVELOPER_GUIDE.md).

---

## Demo for judges

1. Open **[https://arcx.trenchverse.com](https://arcx.trenchverse.com)**
2. Connect an injected wallet on **Arc mainnet** (chain id `5042`) with a little USDC for gas + fees
3. Play a game (sparks), try a refill / score submit, or daily check-in
4. Confirm txs on [Arc Explorer](https://explorer.arc.io)

---

## License

MIT — see [LICENSE](./LICENSE).
