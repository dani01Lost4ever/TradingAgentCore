# Testing the Long-Term Trading Flow

Step-by-step recipe to verify the slow / long-term mode actually works end-to-end. Run this once after setup; do not wait 12 hours for a cycle to fire naturally.

## Why you didn't see anything earlier

Three things need to be true before a long-term cycle produces a trade you can see:

1. The wallet's **active** flag is on (the agent only cycles the active wallet per user).
2. The wallet's **assets** list contains symbols. Running discovery alone does NOT add candidates — it just lists them. You have to *adopt* them. (Now there's an "ADOPT SELECTED" button for that.)
3. A cycle has actually fired. Long-term mode is 720-minute cycles, so the next natural cycle is 12 hours away. **Use the "RUN CYCLE NOW" button** to fire one immediately.

A fourth subtle issue: if the Anthropic key configured under your user in MongoDB is stale/wrong, every cycle fails with a 401 and no trades are produced. The dashboard's API Keys section is the authority — the `.env` value is only a fallback.

## Hard refresh first

The theme migration was just shipped. **Ctrl+Shift+R** (or Cmd+Shift+R) in the dashboard to clear cached JS and trigger the one-time theme reset. You should see the electric-lime Aurora Dark theme — distinctive 108px equity number at the top, hairline borders, no rounded cards. If you still see the old dark theme with rounded cards, do a second hard reload.

## The 9-step recipe

### 1. Confirm API keys

`http://localhost:3000` → log in as admin → `/settings` → **API KEYS** section.

- `anthropic_api_key`: paste your real key from https://console.anthropic.com
- `alpaca_api_key` + `alpaca_api_secret`: paper credentials from https://alpaca.markets
- Save.

The agent's API calls read from the DB key first, env key second. A wrong DB key will mask a correct env key.

### 2. Create / pick a wallet

`/settings` → wallet section.

- Either pick an existing wallet, or create a new one:
  - Name: `long-term-test`
  - Exchange: `alpaca`
  - Mode: `paper`
  - Paste the same Alpaca paper keys.
- Click activate so the wallet shows `(active)`.

### 3. Set the trading mode

Same page, **PER-WALLET TRADING** section.

- Trading mode: `long_term`
- Cycle minutes: `720` (or `0` to use mode default)
- Assets: leave blank for now — we'll fill it via discovery
- Max trades/day: `2`
- Min holding minutes: `4320` (3 days)
- Save.

### 4. Set the cost guardrails

Same page, **COSTS & TAX** section.

- Fee model: `percent`
- Fee value: `0.6` (typical for stocks via IBKR — adjust for Alpaca's actual fees)
- Tax rate: `26` (Italian capital gains)
- Min net profit %: `0.5`
- Save.

### 5. Run discovery

`/discovery` → confirm the right wallet is selected in the dropdown → click **RUN DISCOVERY NOW**.

You should see ~20 S&P 500 candidates appear within 2–5 seconds (LLM-ranked if `DISCOVERY_LLM=true` in `.env`, otherwise sampled with score 0.5).

### 6. Adopt the top candidates

In the discovery results, tick the boxes next to the top 5–8 symbols you want to trade (e.g. SPY, VOO, AAPL, MSFT, NVDA). Click **ADOPT SELECTED**.

This merges the selected symbols into the wallet's `assets` array (deduped, capped at 20). You'll see a toast confirming N symbols added.

### 7. Trigger a cycle manually

Click **RUN CYCLE NOW** (right next to ADOPT SELECTED).

The agent immediately runs a cycle for the active wallet:
- Fetches market snapshots for all assets in the universe
- Runs the LLM (or rule strategy) for a decision per asset
- Applies cost guardrails (rejects trades with expected net < 0.5%)
- Logs each decision

### 8. Watch the "LAST DECISION PER ASSET" panel

That panel above the discovery results auto-polls every 15s. Within 30 seconds you should see one row per asset:

- **HOLD** (gray) — the AI saw the asset and decided not to act. Reasoning shows why (e.g. "RSI 52, neutral momentum, no strong signal").
- **BUY** (lime) — a buy signal. If `autoApprove` is off, it's pending your approval. Click into `/` (Overview) → PENDING APPROVAL section → APPROVE.
- **SELL** (red) — only fires if you already hold the asset.

If you see no rows at all after a minute:
- Check `/audit` for a `discovery.run` or `wallet.cycle.manual_trigger` entry — both should be there.
- Check the live logs panel on Overview for `[engine:...] runCycle failed: ...` lines. The most common cause is a 401 on Anthropic (wrong stored key — see step 1).

### 9. Approve a trade + watch it execute

Overview → pending card → APPROVE.

- The agent submits the order to Alpaca paper.
- Within seconds the trade appears in the **decision log** with status `EXECUTED`.
- The position shows up in **OPEN POSITIONS**.
- Equity curve and per-asset P&L recompute on the next 60s tick.

If you want fully-automated paper testing, toggle **AUTO-TRADE ON** in the top bar — all future cycles will execute without approval prompts.

## Sanity-check the slow cadence

After the manual cycle, the next scheduled cycle is 720 minutes away. You'll see the `nextCycleAt` timestamp on `/admin/engines` (admin only) or via `GET /api/agent/status` — it should be ~12h in the future. For long-term, that's correct. If you want a faster test loop, lower the wallet's `cycleMinutes` temporarily to 5 — but remember to put it back, or the AI will churn positions and violate the min-holding-minutes guardrail.

## What "working long-term" looks like over a day

- 2 cycles fire (morning + afternoon, depending on cycle alignment to UTC).
- Each cycle sees 5–10 assets, decides hold/buy/sell on each.
- 0–2 trades execute per day.
- Positions held for days, not minutes.
- The decision log accumulates a lot of HOLDs and few BUY/SELL — that's the intended behavior.

If you see the AI making 10+ trades/day on a long_term wallet, something's wrong — most likely `maxTradesPerDay` got overridden or the mode is set to `scalp`.
