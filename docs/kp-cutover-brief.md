# KP cutover brief — ArcadeX onto Arc

Date: 28 September 2026
Owner: KP
Live product: [Legend-KP/arcadex-celo](https://github.com/Legend-KP/arcadex-celo) `f00de79` (28 Sep 2026)
This repo: [Legend-KP/arcadex-on-arc](https://github.com/Legend-KP/arcadex-on-arc) `b1d4cd1` (“Arc on ArcadeX”, 26 Sep 2026)

ArcadeX still runs on Celo mainnet (chain id 42220) inside MiniPay. This repository is the Arc destination, and it is still the Celo app. The cutover is a rebase onto the live Celo tree, then a chain swap, then a new Worker. DNS moves last.

## Start from the live Celo tree

`arcadex-on-arc` is a 26 Sep snapshot. `arcadex-celo` has moved since then. Cut over from `arcadex-celo` `f00de79`, then apply the Arc changes on top. Shipping this snapshot would drop work that is already in production:

- 30-day streak ladder and campaign id default `4` (`lib/streak-ladder-config.ts`, `lib/streak-rewards.ts`, `deployments/arcadex-rewards-streak-campaign-4.json`)
- Server-paid USDT claim path (`app/api/streak/usdt`, `lib/streak-usdt-payout.ts`, `migrations/0003_streak_usdt_pending.sql`)
- Check-in campaign mismatch fix (`f00de79`)
- Activity leaderboard panel, game visibility, UI overlay gate

On live Celo, `ArcadeXRewards` `0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF` runs STREAK campaign **4** (30 days, off-chain rewards, USDT paid by the app). This snapshot still defaults campaign **1**.

## Target chain

From [Connect to Arc](https://docs.arc.io/integrate/connect-to-arc) and [Contract addresses](https://docs.arc.io/arc/references/contract-addresses), fetched 28 Sep 2026. `viem` already ships the chain as `arc`.

| | Arc mainnet | Arc testnet |
| --- | --- | --- |
| Chain id | 5042 | 5042002 |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| Gas token | USDC | USDC |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` | same address |

Native USDC is 18 decimals (`eth_getBalance`, `msg.value`). The ERC-20 interface at `0x3600…0000` is 6 decimals (`balanceOf`, `transfer`, `transferFrom`) and is the same balance. Divide native amounts by `10^12` for display. Keep contract fees in 6-decimal units and pay them with `transferFrom` on `0x3600…0000`.

The mempool drops any transaction whose `maxFeePerGas` is under 20 Gwei, with no receipt. Set that floor on every Arc send.

Prove the path on testnet first. Before any mainnet deploy, confirm `eth_chainId` on `https://rpc.mainnet.arc.io` returns `0x13b2` (5042). Circle’s agent index still says “testnet only” in one place; the connect page is the source used here.

There is no USDT in the Arc contract list. EURC exists (`0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` on mainnet) and is a different product.

## What stays on Celo

These deployments stay where they are. Arc env vars must not point at them.

| Contract | Address | Notes |
| --- | --- | --- |
| ArcadeXRewards | `0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF` | Campaign 4 live; campaign 1 still in this snapshot’s JSON |
| ArcadeXTxHub | `0x7D0fc71785B25d7878f83c4bf0E125DD89470FEc` | Free `signIn` + USDT/USDC pay |
| ScoreSubmit | `0x7EE96ddeabB9a7A93cd4A66A32aC45622028555F` | Fee `50000` (0.05) |
| SparkRefill | `0xD7EA6F0212b5b54a9fA4fc2d805CE63426A48B18` | Fee `50000` |
| InfiniteSpark | `0x2a9f38b41035a900d5038D1972955011fb3278E7` | Fee `100000` (0.10) |

Deployer and rewards owner: `0x11015f39Ac7389201aEc778Be8e3D84f2aF44A70`.

Celo USDT `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` and Celo USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` are hardcoded in `ArcadeXRewards`, `ArcadeXTxHub`, `ScoreSubmit`, `SparkRefill`, and `InfiniteSpark` (both `contracts/` and `contract-deploy/contracts/`). CIP-64 fee-currency adapters in `lib/spark-refill.ts` are Celo-only. `@celo/attribution-tags` and `celo_9ycuxgyv` in `lib/attribution.ts` are Celo-only.

On-chain check-ins, pay counts, and treasury balances stay on Celo. They do not replay on Arc.

## Code that has to change

Chain client, in one place, then every caller:

- `lib/wagmi-config.ts` — `chains: [celo]`, transport `https://forno.celo.org`
- `lib/celo-public-client.ts` — Forno / Ankr / 1RPC, plus `eth_gasPrice` with a CIP-64 `feeCurrency` param
- `lib/minipay.ts`, `lib/arcadex-rewards-check-in.ts`, `lib/arcadex-rewards-spin.ts`, `lib/arcadex-tx-hub.ts`, `lib/stablecoin-direct-pay.ts`, `lib/shuffle-sign.ts` — `chain: celo` and `chainId: celo.id`
- `contract-deploy/hardhat.config.cjs` and every deploy/verify script — `chainId: 42220`

Payments:

- Drop CIP-64 `feeCurrency` from `lib/stablecoin-direct-pay.ts`. Gas is native USDC.
- Point fee `transferFrom` at Arc USDC `0x3600…0000` (6 decimals). Keep the existing fee integers (`50000`, `100000`).
- Remove the USDT pay buttons until an Arc USDT exists. The live streak USDT claim (`streak_usdt_pending`, payout key `STREAK_USDT_PAYOUT_PRIVATE_KEY`) needs the same decision: pay that ladder in USDC, or leave USDT claims on the Celo Worker.
- Stop appending the Celo attribution suffix in `lib/stablecoin-direct-pay.ts`.

Wallet — this is the user-facing blocker:

- `lib/walletAuth.ts` refuses any provider where `ethereum.isMiniPay` is false (“Open ArcadeX inside MiniPay to continue.”).
- MiniPay is the Celo wallet. Arc sign-in needs an injected wallet (MetaMask, Coinbase Wallet, Rabby) or WalletConnect, with `wagmi` chain `arc` from `viem/chains`.
- Session signing (`/api/auth/challenge`) can stay. Daily check-in stays an Arc `checkIn` transaction, verified against the Arc RPC.

Contracts:

- Replace the USDT/USDC constants and redeploy all five contracts. Solidity 0.8.20 with viaIR can stay.
- `transferFrom` collection matches Arc’s ERC-20 USDC interface. Do not mix `msg.value` (18 decimals) with `balanceOf` (6 decimals).
- Arc forbids native-value sends to `address(0)` and drops txs under the 20 Gwei `maxFeePerGas` floor. These payment contracts do not send native value; the client must still set the gas floor.
- New campaign id on the new rewards contract. Do not reuse campaign 4. Off-chain streak rows are keyed by wallet + campaign id, and campaign 4 means the Celo 30-day ladder.

Workers:

- `wrangler.jsonc` names are `arcadex-celo`, `arcadex-celo-preview`, D1 `arcadex-celo-prod` / `arcadex-celo-preview`. New names (`arcadex-arc`, `arcadex-arc-preview`) so a preview deploy cannot overwrite the live Celo Worker.
- `lib/cors.ts` allows hostnames containing `arcadex-celo`. Add the Arc worker host before preview.

## Data

Firebase (game catalog) and the Unity `GAME_*` bridge are chain-agnostic. Copying the catalog forward is fine. Game CDN URLs stay.

D1 player sparks, progress, and names can be copied forward. Payment guards cannot be trusted across chains as written: `guardPrimaryKey` is `${kind}:${txHash}` with no chain id (`lib/d1-server.ts`). Add the chain id to that key before the Arc Worker shares a database with Celo, or give Arc its own D1 and run `migrations/` there (including `0003_streak_usdt_pending.sql` and `0003_user_xp.sql` from the live tree).

RTDB markers `sparkPayments/{txHash}`, `scorePayments/{txHash}`, `checkInTxs/{txHash}`, and `streakGrants/{txHash}` stay. Verification must read the Arc receipt. A Celo hash will fail that check, which is the correct outcome.

Streak progress for campaign 4 stays a Celo record. Arc starts a new campaign id so those rows are left untouched.

## Order of work

1. Decide the three open items below.
2. Rebase this repo onto `arcadex-celo` `f00de79`.
3. Retarget chain, RPC, USDC address, gas floor, and wallet gate.
4. Deploy the five contracts to Arc testnet (5042002). Write `deployments/*-arc-testnet.json`. Configure a new STREAK campaign (30-day, off-chain, new id).
5. New preview Worker and its own D1. Run migrations. Point `NEXT_PUBLIC_*` contract addresses and the RPC at testnet.
6. Smoke, inside a wallet that is on chain 5042002: open app, sign session, daily check-in, spark refill of 0.05 USDC, score submit, shuffle, leaderboard. Confirm a sub-20-Gwei tx is not what we send.
7. Repeat the deploy on mainnet 5042 only after `eth_chainId` matches. Fund the rewards contract with ERC-20 USDC if any on-chain USDC reward mode is turned on. The live ladder is off-chain, so the treasury funding matches whatever the USDT decision becomes.
8. Production Worker, then DNS. Leave `arcadex-celo` deployed.

## Rollback

Point DNS back at the `arcadex-celo` Worker. Celo contracts and campaign 4 keep working. Arc transactions already mined stay mined. Leave the Celo USDT/USDC treasuries in place until the Arc preview has cleared the smoke list.

## Decisions still open

1. **Wallet.** Which Arc wallet replaces MiniPay for the shell (injected only, or WalletConnect as well)?
2. **USDT.** Arc has USDC and EURC, and no USDT in the published address list. Pay the streak ladder and the refill/score/shuffle fees in USDC only, or keep USDT claims on the Celo Worker?
3. **Streaks.** New Arc campaign with progress starting at day 0, or a read-only display of Celo campaign 4 history? Grants and claims follow the new campaign either way.
